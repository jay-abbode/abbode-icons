/**
 * caption-icons.mjs — one-time (resumable) visual captioning pass.
 *
 * For every ACTIVE icon it downloads the PNG, asks Claude to describe what it
 * actually looks like (subject, material, colors, pattern), and writes the
 * result to a VISUAL_INDEX tab in the icon sheet:
 *
 *   A: PNG File ID   B: Name   C: Description   D: Captioned At
 *
 * The lookbook matcher reads that tab, so themes like "stripes", "wood", or
 * "navy" start finding the right icons even when the pattern/material isn't in
 * the icon's name.
 *
 * Run:  node scripts/caption-icons.mjs        (or double-click caption-icons.bat)
 *
 * Credentials (same as the app uses locally):
 *   - Google: reads google-credentials.json from the repo root — the file the
 *     app already uses for local dev. (Falls back to GOOGLE_SERVICE_ACCOUNT_EMAIL
 *     / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars if that file isn't there.)
 *   - .env.local at the repo root needs only two lines:
 *       GOOGLE_SHEET_ID=...
 *       ANTHROPIC_API_KEY=sk-ant-...
 *
 * It's resumable: already-captioned icons are skipped, so you can stop/re-run
 * it any time, and run it again later to pick up newly added icons.
 */

import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

// ---- Config ----
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "MASTER";
const VISUAL_TAB = "VISUAL_INDEX";
// Sonnet reads patterns/materials most reliably. Switch to "claude-haiku-4-5-20251001"
// for a cheaper/faster pass if you prefer. (Do not add a temperature — Sonnet 5 rejects it.)
const CAPTION_MODEL = "claude-sonnet-5";
const CONCURRENCY = 8; // parallel captions per chunk; lower this if you hit rate limits
const MAX_ROW = 6000;

const CAPTION_SYSTEM =
  "You write ultra-concise visual search descriptions of embroidery patch icons.";
const CAPTION_PROMPT =
  "Describe this embroidery patch in 16 words or fewer, for search. State the main subject, its material(s) if clear (wood, metal, fabric, ceramic, leather, glass, plastic…), the dominant colors, and any surface pattern (striped, plaid, floral, polka-dot, checkered, or solid). Describe only what is visibly there. Reply with the description only — no lead-in, no quotes.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Load .env.local / .env into process.env ----
function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `\nMissing ${name}. Add it to .env.local at the repo root and re-run.`
    );
    process.exit(1);
  }
  return v;
}

// Same credential order as lib/google.ts: google-credentials.json first
// (local dev), then GOOGLE_SERVICE_ACCOUNT_* env vars (as on Vercel).
function getGoogleCredentials() {
  const localPath = path.join(process.cwd(), "google-credentials.json");
  if (fs.existsSync(localPath)) {
    const parsed = JSON.parse(fs.readFileSync(localPath, "utf8"));
    if (!parsed.client_email || !parsed.private_key) {
      console.error(
        "\ngoogle-credentials.json is missing client_email or private_key."
      );
      process.exit(1);
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && key) {
    return { client_email: email, private_key: key.replace(/\\n/g, "\n") };
  }
  console.error(
    "\nNo Google credentials found. Put google-credentials.json in the repo root " +
      "(the same file the app uses locally)."
  );
  process.exit(1);
}

function fileIdFromLink(link) {
  if (!link) return null;
  const m =
    link.match(/[?&]id=([A-Za-z0-9_-]+)/) || link.match(/\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function fileIdFromCell(cell) {
  if (!cell) return null;
  if (cell.hyperlink) {
    const id = fileIdFromLink(cell.hyperlink);
    if (id) return id;
  }
  const formula = cell.userEnteredValue?.formulaValue;
  if (typeof formula === "string" && /HYPERLINK/i.test(formula)) {
    const m = formula.match(/HYPERLINK\("([^"]+)"/i);
    if (m) return fileIdFromLink(m[1]);
  }
  return null;
}

async function main() {
  loadEnvFile();
  const SHEET_ID = requireEnv("GOOGLE_SHEET_ID");
  const API_KEY = requireEnv("ANTHROPIC_API_KEY");
  const creds = getGoogleCredentials();

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  // --- Read the catalog with hyperlinks so we can resolve each PNG file ID ---
  console.log(`Reading ${SHEET_TAB}…`);
  const grid = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    ranges: [`${SHEET_TAB}!C3:N${MAX_ROW}`],
    includeGridData: true,
    fields: "sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)",
  });
  const rows = grid.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const active = [];
  for (const row of rows) {
    const values = row.values || [];
    const name = values[0]?.formattedValue?.trim(); // C
    const status = values[5]?.formattedValue?.trim(); // H
    const fileId = fileIdFromCell(values[11]); // N (PNG)
    if (name && status && status.toUpperCase() === "ACTIVE" && fileId) {
      active.push({ name, fileId });
    }
  }

  await ensureVisualTab(sheets, SHEET_ID);
  const done = await readDone(sheets, SHEET_ID);
  const todo = active.filter((a) => !done.has(a.fileId));

  console.log(
    `${active.length} active icons · ${done.size} already captioned · ${todo.length} to do (model: ${CAPTION_MODEL})\n`
  );
  if (todo.length === 0) {
    console.log("Nothing to caption. Done.");
    return;
  }

  let completed = 0;
  let failed = 0;

  // Process in chunks so progress is saved incrementally (resumable).
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const chunk = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (icon) => {
        try {
          const b64 = await fetchPng(drive, icon.fileId);
          const desc = await caption(API_KEY, b64);
          return { icon, desc };
        } catch (e) {
          return { icon, error: e.message };
        }
      })
    );

    const toWrite = [];
    const now = new Date().toISOString();
    for (const r of results) {
      if (r.error || !r.desc) {
        failed++;
        console.log(`  ✗ ${r.icon.name}: ${r.error || "empty description"}`);
        continue;
      }
      completed++;
      toWrite.push([r.icon.fileId, r.icon.name, r.desc, now]);
      console.log(
        `  [${completed}/${todo.length}] ${r.icon.name} — ${r.desc}`
      );
    }
    if (toWrite.length) await appendRows(sheets, SHEET_ID, toWrite);
  }

  console.log(`\nDone. Captioned ${completed}, failed ${failed}.`);
  if (failed) console.log("Re-run to retry the failed ones (already-done icons are skipped).");
}

async function ensureVisualTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title)",
  });
  const exists = (meta.data.sheets || []).some(
    (s) => s.properties?.title === VISUAL_TAB
  );
  if (exists) return;
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
    requestBody: {
      values: [["PNG File ID", "Name", "Description", "Captioned At"]],
    },
  });
}

async function readDone(sheets, spreadsheetId) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${VISUAL_TAB}!A2:A${MAX_ROW}`,
    });
    return new Set(
      (resp.data.values || [])
        .map((r) => String(r[0] || "").trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

async function appendRows(sheets, spreadsheetId, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${VISUAL_TAB}!A:D`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function fetchPng(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data).toString("base64");
}

async function caption(apiKey, b64) {
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

  for (let attempt = 1; attempt <= 6; attempt++) {
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
      const data = await res.json();
      return (data.content || [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join(" ")
        .trim();
    }

    // Back off on rate limits / transient server errors and retry.
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      const wait =
        Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 1000 * 2 ** attempt);
      await sleep(wait);
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${text.slice(0, 160)}`);
  }
  throw new Error("Claude: too many retries (rate limited)");
}

main().catch((e) => {
  console.error("\nFailed:", e.message);
  process.exit(1);
});
