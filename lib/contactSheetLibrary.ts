/**
 * Saved contact-sheet library, backed by a tab called CONTACT_SHEETS in the
 * same spreadsheet that holds the icon catalog. Auto-creates the tab on first
 * save (same approach as lib/comments.ts) so nothing has to be set up by hand.
 *
 * Sheet layout:
 *   A: ID
 *   B: Created At (ISO 8601)
 *   C: Created By (email)
 *   D: Label
 *   E: Theme
 *   F: Count
 *   G: Render Logo (TRUE/FALSE)
 *   H: Render Category (TRUE/FALSE)
 *   I: Icons (JSON array of {slug,name,pngFileId})
 *
 * A saved sheet stores the icon selection + toggles, so reopening it via
 * /contact-sheet?load=<id> rebuilds the exact sheet for re-export or tweaking.
 */

import { getSheetsClient } from "./google";

const TAB = "CONTACT_SHEETS";
const HEADER_ROW = [
  "ID",
  "Created At",
  "Created By",
  "Label",
  "Theme",
  "Count",
  "Render Logo",
  "Render Category",
  "Icons",
];

export type SavedIcon = { slug: string; name: string; pngFileId: string };

export type SavedSheet = {
  id: string;
  createdAt: string;
  createdBy: string;
  label: string;
  theme: string;
  count: number;
  renderLogo: boolean;
  renderCategory: boolean;
  icons: SavedIcon[];
};

/** Everything needed to save a sheet (id + createdAt are assigned on write). */
export type NewSavedSheet = Omit<SavedSheet, "id" | "createdAt">;

function requireSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID environment variable is required.");
  return id;
}

function parseBool(v: unknown): boolean {
  return String(v ?? "").trim().toUpperCase() === "TRUE";
}

function parseIcons(raw: unknown): SavedIcon[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && typeof i === "object")
      .map((i) => ({
        slug: String(i.slug ?? ""),
        name: String(i.name ?? ""),
        pngFileId: String(i.pngFileId ?? ""),
      }))
      .filter((i) => i.slug && i.pngFileId);
  } catch {
    return [];
  }
}

/** All saved sheets, newest first. Returns [] if the tab doesn't exist yet. */
export async function listSavedSheets(): Promise<SavedSheet[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A2:I5000`,
    });
    const rows = resp.data.values || [];
    const out: SavedSheet[] = rows
      .filter((r) => r && (r[0] || "").toString().trim() !== "")
      .map((r) => ({
        id: String(r[0] || ""),
        createdAt: String(r[1] || ""),
        createdBy: String(r[2] || ""),
        label: String(r[3] || ""),
        theme: String(r[4] || ""),
        count: Number.parseInt(String(r[5] || "0"), 10) || 0,
        renderLogo: parseBool(r[6]),
        renderCategory: parseBool(r[7]),
        icons: parseIcons(r[8]),
      }));
    out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return out;
  } catch {
    // Tab missing (or read error) — treat as an empty library.
    return [];
  }
}

export async function getSavedSheet(id: string): Promise<SavedSheet | null> {
  if (!id) return null;
  const all = await listSavedSheets();
  return all.find((s) => s.id === id) || null;
}

/** Append a saved sheet, creating the tab + header on first call. */
export async function saveSheet(input: NewSavedSheet): Promise<SavedSheet> {
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();
  const id = `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  await ensureTab(sheets, spreadsheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TAB}!A:I`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          id,
          createdAt,
          input.createdBy,
          input.label,
          input.theme,
          String(input.count),
          input.renderLogo ? "TRUE" : "FALSE",
          input.renderCategory ? "TRUE" : "FALSE",
          JSON.stringify(input.icons),
        ],
      ],
    },
  });

  return { ...input, id, createdAt };
}

/** Delete the saved sheet whose ID column matches. No-op if not found. */
export async function deleteSheet(id: string): Promise<void> {
  if (!id) throw new Error("Missing id.");
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const tab = (meta.data.sheets || []).find(
    (s) => s.properties?.title === TAB
  );
  const sheetId = tab?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return; // no tab -> nothing to delete

  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A2:A5000`,
  });
  const ids: string[][] = (valuesResp.data.values as string[][]) || [];
  const indexInValues = ids.findIndex((r) => (r[0] || "") === id);
  if (indexInValues < 0) return;

  // Row 1 (header) is sheet index 0, so value index 0 lives at sheet index 1.
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
}

async function ensureTab(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
  spreadsheetId: string
): Promise<void> {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A1:I1`,
    });
    return; // tab exists
  } catch {
    // Tab missing — create it below.
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: TAB, gridProperties: { frozenRowCount: 1 } },
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!A1:I1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER_ROW] },
  });
}
