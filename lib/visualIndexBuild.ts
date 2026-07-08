import { getSheetsClient, getDriveClient } from "./google";
import { getIconCatalog } from "./sheets";

/**
 * Builds the VISUAL_INDEX tab by having Claude look at each active icon and
 * describe it (subject, material, colors, pattern). Runs in short, resumable
 * batches so it fits inside a serverless request: the client calls the
 * /api/contact-sheet/build-index endpoint repeatedly until `done` is true.
 *
 * State lives entirely in the sheet (an icon is "done" once its row exists),
 * so it's crash-safe, refresh-safe, and re-runnable to pick up new icons.
 */

const VISUAL_TAB = "VISUAL_INDEX";
const HEADER = ["PNG File ID", "Name", "Description", "Captioned At"];
const MAX_ROW = 6000;

// Sonnet reads patterns/materials most reliably. (No temperature — Sonnet 5 rejects it.)
const CAPTION_MODEL = "claude-sonnet-5";
const CAPTION_SYSTEM =
  "You write ultra-concise visual search descriptions of embroidery patch icons.";
const CAPTION_PROMPT =
  "Describe this embroidery patch in 16 words or fewer, for search. State the main subject, its material(s) if clear (wood, metal, fabric, ceramic, leather, glass, plastic…), the dominant colors, and any surface pattern (striped, plaid, floral, polka-dot, checkered, or solid). Describe only what is visibly there. Reply with the description only — no lead-in, no quotes.";

const GROUP_SIZE = 6; // icons captioned in parallel within a batch
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sheets = ReturnType<typeof getSheetsClient>;
type ActiveIcon = { name: string; pngFileId: string };

function requireSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID environment variable is required.");
  return id;
}

async function activeIcons(): Promise<ActiveIcon[]> {
  const catalog = await getIconCatalog();
  return catalog.icons
    .filter((i) => i.status.toUpperCase() === "ACTIVE" && i.pngFileId)
    .map((i) => ({ name: i.name, pngFileId: i.pngFileId as string }));
}

async function readDone(sheets: Sheets, spreadsheetId: string): Promise<Set<string>> {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${VISUAL_TAB}!A2:A${MAX_ROW}`,
    });
    return new Set(
      (resp.data.values || [])
        .map((r) => String(r?.[0] ?? "").trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

async function ensureTab(sheets: Sheets, spreadsheetId: string): Promise<void> {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${VISUAL_TAB}!A1:D1`,
    });
    return;
  } catch {
    // create below
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: VISUAL_TAB,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        },
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${VISUAL_TAB}!A1:D1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

async function fetchPngBase64(fileId: string): Promise<string> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as unknown as ArrayBuffer).toString("base64");
}

type CaptionResult = { desc: string | null; rateLimited: boolean };

async function caption(apiKey: string, b64: string): Promise<CaptionResult> {
  const body = {
    model: CAPTION_MODEL,
    max_tokens: 120,
    system: CAPTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: b64 },
          },
          { type: "text", text: CAPTION_PROMPT },
        ],
      },
    ],
  };

  // Two quick attempts; on a persistent 429 we bail out and let the client
  // pause before the next batch (keeps us inside the serverless time budget).
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (data.content || [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join(" ")
        .trim();
      return { desc: text || null, rateLimited: false };
    }

    if (res.status === 429) {
      if (attempt < 2) {
        await sleep(1500);
        continue;
      }
      return { desc: null, rateLimited: true };
    }
    if (res.status >= 500 && attempt < 2) {
      await sleep(1000);
      continue;
    }

    const errText = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${errText.slice(0, 160)}`);
  }
  return { desc: null, rateLimited: true };
}

export interface IndexStatus {
  captioned: number;
  total: number;
}

/** How many active icons already have a visual description. */
export async function getIndexStatus(): Promise<IndexStatus> {
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();
  const [done, active] = await Promise.all([
    readDone(sheets, spreadsheetId),
    activeIcons(),
  ]);
  const activeIds = new Set(active.map((a) => a.pngFileId));
  let captioned = 0;
  for (const id of done) if (activeIds.has(id)) captioned++;
  return { captioned, total: active.length };
}

export interface BatchResult extends IndexStatus {
  done: boolean;
  processed: number;
  rateLimited: boolean;
}

/**
 * Caption as many outstanding icons as fit inside `budgetMs`, write them, and
 * report progress. The client keeps calling this until `done` is true.
 */
export async function buildIndexBatch(budgetMs = 30000): Promise<BatchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy."
    );
  }

  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();
  await ensureTab(sheets, spreadsheetId);

  const [done, active] = await Promise.all([
    readDone(sheets, spreadsheetId),
    activeIcons(),
  ]);
  const activeIds = new Set(active.map((a) => a.pngFileId));
  let captioned = 0;
  for (const id of done) if (activeIds.has(id)) captioned++;

  const undone = active.filter((a) => !done.has(a.pngFileId));
  if (undone.length === 0) {
    return { captioned, total: active.length, done: true, processed: 0, rateLimited: false };
  }

  const start = Date.now();
  const rows: string[][] = [];
  let processed = 0;
  let rateLimited = false;

  for (
    let i = 0;
    i < undone.length && Date.now() - start < budgetMs && !rateLimited;
    i += GROUP_SIZE
  ) {
    const group = undone.slice(i, i + GROUP_SIZE);
    const now = new Date().toISOString();
    const results = await Promise.all(
      group.map(async (icon) => {
        try {
          const b64 = await fetchPngBase64(icon.pngFileId);
          const c = await caption(apiKey, b64);
          return { icon, ...c };
        } catch {
          return { icon, desc: null as string | null, rateLimited: false };
        }
      })
    );

    for (const r of results) {
      if (r.rateLimited) {
        rateLimited = true;
        continue;
      }
      if (!r.desc) continue; // hard failure — left undone, retried next run
      rows.push([r.icon.pngFileId, r.icon.name, r.desc, now]);
      processed++;
    }
  }

  if (rows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${VISUAL_TAB}!A:D`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }

  const newCaptioned = captioned + processed;
  return {
    captioned: newCaptioned,
    total: active.length,
    done: newCaptioned >= active.length,
    processed,
    rateLimited,
  };
}
