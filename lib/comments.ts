/**
 * Comments storage backed by a tab called COMMENTS in the same sheet that
 * holds the icon catalog. Auto-creates the tab on first write so the user
 * doesn't have to set anything up by hand.
 *
 * Sheet layout:
 *   A: Timestamp (ISO 8601)
 *   B: Author Email
 *   C: Author Name
 *   D: Icon Slug
 *   E: Icon Name
 *   F: Icon Category
 *   G: Comment Text
 *
 * Optional email notification via Resend is sent when both RESEND_API_KEY and
 * NOTIFICATION_EMAIL env vars are set. If they're not, comments still save —
 * just no email goes out.
 */

import { unstable_cache } from "next/cache";
import { getSheetsClient } from "./google";

const COMMENTS_TAB = "COMMENTS";
const HEADER_ROW = [
  "Timestamp",
  "Author Email",
  "Author Name",
  "Icon Slug",
  "Icon Name",
  "Icon Category",
  "Comment",
];

export type Comment = {
  timestamp: string;
  authorEmail: string;
  authorName: string;
  iconSlug: string;
  iconName: string;
  iconCategory: string;
  text: string;
};

export type NewComment = Omit<Comment, "timestamp">;

function requireSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID environment variable is required.");
  }
  return id;
}

/** Returns all comments, newest first. Returns [] if the tab doesn't exist yet. */
export async function getAllComments(): Promise<Comment[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();

  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${COMMENTS_TAB}!A2:G5000`,
    });
    const rows = resp.data.values || [];
    const out: Comment[] = rows
      .filter((r) => r && r.length > 0 && (r[6] || "").trim() !== "")
      .map((r) => ({
        timestamp: r[0] || "",
        authorEmail: r[1] || "",
        authorName: r[2] || "",
        iconSlug: r[3] || "",
        iconName: r[4] || "",
        iconCategory: r[5] || "",
        text: r[6] || "",
      }));
    // Sort newest first (in case the sheet rows aren't strictly ordered).
    out.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    return out;
  } catch (err: unknown) {
    // Tab missing is a 400-ish error from the API; treat any read error as
    // "no comments yet" so a brand-new sheet doesn't surface as broken.
    return [];
  }
}

// --------------------------------------------------------------------------
// Comment-count cache
// --------------------------------------------------------------------------
// Both the browse grid (per-icon badges) and the header (total badge) need
// counts on every page render. We use Next.js's unstable_cache so the data
// lives in the globally-shared cache (not in per-instance memory) and can
// be busted from any serverless invocation by revalidating the "comments"
// tag. The server actions call revalidateTag("comments") after every add
// or delete, so badges update on the very next request.

type CountSnapshot = { counts: Record<string, number>; total: number };

export const getCommentCounts = unstable_cache(
  async (): Promise<CountSnapshot> => {
    const comments = await getAllComments();
    const counts: Record<string, number> = {};
    for (const c of comments) {
      const slug = (c.iconSlug || "").trim();
      if (!slug) continue;
      counts[slug] = (counts[slug] || 0) + 1;
    }
    return { counts, total: comments.length };
  },
  ["comment-counts"],
  // 60-second safety TTL so a missed invalidation can't leave stale counts
  // around indefinitely; revalidateTag is what actually drives invalidation
  // in normal flow.
  { tags: ["comments"], revalidate: 60 },
);

/**
 * Append a new comment, creating the COMMENTS tab + header row on first call.
 * Also fires an optional email notification (failure of which doesn't block
 * the comment from being saved).
 */
export async function addComment(input: NewComment): Promise<Comment> {
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();
  const timestamp = new Date().toISOString();

  await ensureCommentsTab(sheets, spreadsheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${COMMENTS_TAB}!A:G`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          timestamp,
          input.authorEmail,
          input.authorName,
          input.iconSlug,
          input.iconName,
          input.iconCategory,
          input.text,
        ],
      ],
    },
  });

  const saved: Comment = { ...input, timestamp };

  // Counts cache invalidation is handled by the server action via
  // revalidateTag("comments") — works across all serverless instances.

  // Best-effort notification. Never let an email failure block save success.
  sendNotification(saved).catch((err) => {
    console.error("Notification email failed:", err);
  });

  return saved;
}

async function ensureCommentsTab(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
  spreadsheetId: string
): Promise<void> {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${COMMENTS_TAB}!A1:G1`,
    });
    return; // tab exists
  } catch {
    // Tab missing — create it.
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: COMMENTS_TAB,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${COMMENTS_TAB}!A1:G1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER_ROW] },
  });
}

/**
 * Delete the comment row whose Timestamp column matches `timestamp`.
 * No-op if the COMMENTS tab doesn't exist or the timestamp isn't found.
 * Throws on Sheets API errors (so the server action can surface them).
 */
export async function deleteComment(timestamp: string): Promise<void> {
  if (!timestamp) {
    throw new Error("Missing timestamp.");
  }
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();

  // Locate the COMMENTS tab's internal sheetId (the gid, not the tab name).
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const tab = (meta.data.sheets || []).find(
    (s) => s.properties?.title === COMMENTS_TAB
  );
  const sheetId = tab?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error("COMMENTS tab not found.");
  }

  // Find the row whose timestamp column matches. We read only column A,
  // starting at row 2 (row 1 is the header).
  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${COMMENTS_TAB}!A2:A5000`,
  });
  const timestamps: string[][] = (valuesResp.data.values as string[][]) || [];
  const indexInValues = timestamps.findIndex(
    (r) => (r[0] || "") === timestamp
  );
  if (indexInValues < 0) {
    throw new Error("Note not found — it may have already been deleted.");
  }

  // deleteDimension uses 0-based row indices into the entire sheet, where
  // row 1 (header) is index 0. Our value at indexInValues=0 lives at sheet
  // row 2, i.e. index 1.
  const rowIndexInSheet = indexInValues + 1;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndexInSheet,
              endIndex: rowIndexInSheet + 1,
            },
          },
        },
      ],
    },
  });

  // Counts cache invalidation is handled by the server action via
  // revalidateTag("comments") — works across all serverless instances.
}

// --------------------------------------------------------------------------
// Optional Resend email notification
// --------------------------------------------------------------------------

async function sendNotification(comment: Comment): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFICATION_EMAIL;
  if (!apiKey || !to) return; // not configured — silent no-op

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL ||
    "https://abbode-icons.vercel.app";
  const baseUrl = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 580px; padding: 12px;">
      <p style="margin: 0 0 12px; color: #432222;">
        New note on <strong>${escapeHtml(comment.iconName)}</strong>
        <span style="color: #888;">(${escapeHtml(comment.iconCategory)})</span>
      </p>
      <blockquote style="margin: 0 0 16px; padding: 12px 16px; background: #FFFCF7; border-left: 3px solid #BB3767; color: #432222; white-space: pre-wrap; font-style: normal;">
        ${escapeHtml(comment.text)}
      </blockquote>
      <p style="margin: 0 0 12px; font-size: 13px; color: #666;">
        From ${escapeHtml(comment.authorName)} &lt;${escapeHtml(comment.authorEmail)}&gt;<br>
        ${new Date(comment.timestamp).toLocaleString()}
      </p>
      <p style="margin: 16px 0 0; font-size: 13px;">
        <a href="${baseUrl}/comments" style="color: #BB3767;">View all notes</a>
      </p>
    </div>
  `;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Abbode Icons <onboarding@resend.dev>",
      to,
      subject: `New note on ${comment.iconName}`,
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${body.slice(0, 200)}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
