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
