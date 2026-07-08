import { getSheetsClient } from "./google";

/**
 * Visual descriptions for icons, produced by scripts/caption-icons.mjs (a
 * one-time vision pass) and stored in a VISUAL_INDEX tab keyed by PNG file ID:
 *
 *   A: PNG File ID   B: Name   C: Description   D: Captioned At
 *
 * The matcher folds these into the catalog so themes about material, color, or
 * pattern (stripes, wood, navy…) work — things that can't be read from a name.
 * Returns an empty map if the tab doesn't exist yet, so matching degrades
 * gracefully to name+category until the caption pass has been run.
 */

let cache: { at: number; map: Map<string, string> } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function loadVisualDescriptions(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const map = new Map<string, string>();
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (spreadsheetId) {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "VISUAL_INDEX!A2:C6000",
      });
      for (const row of resp.data.values || []) {
        const fileId = String(row?.[0] ?? "").trim();
        const desc = String(row?.[2] ?? "").trim();
        if (fileId && desc) map.set(fileId, desc);
      }
    }
  } catch {
    // Tab missing or unreadable — treat as "no visual data yet".
  }

  cache = { at: Date.now(), map };
  return map;
}
