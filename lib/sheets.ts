import { getSheetsClient } from "./google";
import { parseThreadSlots } from "./threadPalette";

/**
 * Public shape of a single icon, as the rest of the app sees it.
 * Designed so the UI never has to know about column letters,
 * "Varies"/"N/A" string oddities, or hyperlink extraction.
 */
export interface IconSize {
  /** Human-readable size in inches, e.g. "1.5", "Varies", or null if N/A. */
  inches: string | null;
  /** Drive file ID for the OFM file at this size, or null if not available. */
  ofmFileId: string | null;
  /** Drive file ID for the DST file at this size, or null if not available. */
  dstFileId: string | null;
}

export interface Icon {
  /** Stable slug for routing/links — derived from name. */
  slug: string;
  name: string;
  category: string;
  hasColorVariation: boolean;
  status: string;
  notes: string | null;
  oldName: string | null;
  /** Drive file ID for the PNG, or null. */
  pngFileId: string | null;
  /**
   * Machine slot numbers for the Madeira spools used in this design,
   * in the order entered in the sheet (typically most-prominent first).
   * Empty array if the "Thread Colors" cell is blank for this row.
   */
  threadSlots: number[];
  sizes: {
    small: IconSize;
    medium: IconSize;
    large: IconSize;
  };
}

export interface IconCatalog {
  icons: Icon[];
  categories: string[];
  /** Total icons including those with status other than "Approved"/"Active". */
  totalCount: number;
  /** Timestamp this snapshot was fetched (used for cache headers). */
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Cache: avoid hitting Google's API on every single request.
// 60 seconds is short enough that sheet edits feel "instant" but long enough
// to keep response times fast at 500-2000 rows.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60 * 1000;
let cache: { catalog: IconCatalog; expiresAt: number } | null = null;

export async function getIconCatalog(
  options: { forceRefresh?: boolean } = {}
): Promise<IconCatalog> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.catalog;
  }

  const catalog = await fetchCatalogFromSheet();
  cache = { catalog, expiresAt: Date.now() + CACHE_TTL_MS };
  return catalog;
}

// ---------------------------------------------------------------------------
// Sheet-reading internals
// ---------------------------------------------------------------------------

async function fetchCatalogFromSheet(): Promise<IconCatalog> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tabName = process.env.GOOGLE_SHEET_TAB || "MASTER";

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is not set in .env.local");
  }

  const sheets = getSheetsClient();

  // Use spreadsheets.get (NOT spreadsheets.values.get) because we need the
  // hyperlinks attached to each cell, not just the display text.
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${tabName}!A1:AZ5000`],
    fields: "sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)",
  });

  const rowData = response.data.sheets?.[0]?.data?.[0]?.rowData;
  if (!rowData || rowData.length < 3) {
    throw new Error(
      `No data found in tab "${tabName}". The sheet should have a section header in row 1, ` +
        `column headers in row 2, and data starting in row 3.`
    );
  }

  // Row 0 = section headers ("ICON", "SIZES NEEDED", etc.) — ignored.
  // Row 1 = the actual column headers we care about.
  // Row 2+ = data.
  const headerRow = rowData[1].values || [];
  const headers = headerRow.map((cell) => (cell.formattedValue || "").trim());
  const col = buildColumnIndex(headers);

  const icons: Icon[] = [];
  const categorySet = new Set<string>();
  const seenSlugs = new Set<string>();

  for (let i = 2; i < rowData.length; i++) {
    const row = rowData[i].values;
    if (!row || row.length === 0) continue;

    const name = getCellText(row, col.icon);
    const category = getCellText(row, col.category);

    // Skip blank/incomplete rows.
    if (!name || !category) continue;

    const slug = makeSlug(name, seenSlugs);
    seenSlugs.add(slug);

    const icon: Icon = {
      slug,
      name,
      category,
      hasColorVariation: getCellText(row, col.colorVar).toUpperCase() === "YES",
      status: getCellText(row, col.status) || "Unknown",
      notes: getCellText(row, col.notes) || null,
      oldName: getCellText(row, col.oldName) || null,
      pngFileId: extractDriveFileId(getCellHyperlink(row, col.png)),
      threadSlots: parseThreadSlots(getCellText(row, col.threadColors)),
      sizes: {
        small: {
          inches: normalizeSizeValue(getCellText(row, col.smallInches)),
          ofmFileId: extractDriveFileId(getCellHyperlink(row, col.smallOfm)),
          dstFileId: extractDriveFileId(getCellHyperlink(row, col.smallDst)),
        },
        medium: {
          inches: normalizeSizeValue(getCellText(row, col.mediumInches)),
          ofmFileId: extractDriveFileId(getCellHyperlink(row, col.mediumOfm)),
          dstFileId: extractDriveFileId(getCellHyperlink(row, col.mediumDst)),
        },
        large: {
          inches: normalizeSizeValue(getCellText(row, col.largeInches)),
          ofmFileId: extractDriveFileId(getCellHyperlink(row, col.largeOfm)),
          dstFileId: extractDriveFileId(getCellHyperlink(row, col.largeDst)),
        },
      },
    };

    icons.push(icon);
    categorySet.add(category);
  }

  return {
    icons,
    categories: Array.from(categorySet).sort((a, b) => a.localeCompare(b)),
    totalCount: icons.length,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Header → column index mapping.
// Done by header NAME rather than fixed column letters, so reordering columns
// in the sheet won't break the app.
// ---------------------------------------------------------------------------
interface ColumnIndex {
  category: number;
  colorVar: number;
  icon: number;
  smallInches: number;
  mediumInches: number;
  largeInches: number;
  status: number;
  smallOfm: number;
  mediumOfm: number;
  largeOfm: number;
  notes: number;
  oldName: number;
  png: number;
  threadColors: number;
  smallDst: number;
  mediumDst: number;
  largeDst: number;
}

function buildColumnIndex(headers: string[]): ColumnIndex {
  const findHeader = (candidates: string[]): number => {
    for (const candidate of candidates) {
      const idx = headers.findIndex(
        (h) => h.toLowerCase() === candidate.toLowerCase()
      );
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // Two columns are literally named "STATUS" in the sheet — one for the section
  // header, one for the actual data column. We want the second occurrence.
  const findHeaderNth = (name: string, nth: number): number => {
    let found = 0;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].toLowerCase() === name.toLowerCase()) {
        if (found === nth) return i;
        found++;
      }
    }
    return -1;
  };

  const small = findHeader(["SMALL"]);
  const medium = findHeader(["MEDIUM"]);
  const large = findHeader(["LARGE"]);

  return {
    category: findHeader(["Category"]),
    colorVar: findHeader(["Col. Var.", "Col Var", "Color Variation"]),
    icon: findHeader(["Icon"]),
    smallInches: small,
    mediumInches: medium,
    largeInches: large,
    status: findHeader(["STATUS", "Status"]),
    smallOfm: findHeader(["SMALL OFM", "Small OFM"]),
    mediumOfm: findHeader(["MEDIUM OFM", "Medium OFM"]),
    largeOfm: findHeader(["LARGE OFM", "Large OFM"]),
    notes: findHeader(["NOTES", "Notes"]),
    oldName: findHeader(["OLD NAME", "Old Name"]),
    png: findHeader(["PNG"]),
    threadColors: findHeader(["Thread Colors", "THREAD COLORS", "Thread Color", "Threads"]),
    smallDst: findHeader(["SMALL DST", "Small DST"]),
    mediumDst: findHeader(["MEDIUM DST", "Medium DST"]),
    largeDst: findHeader(["LARGE DST", "Large DST"]),
  };
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

interface CellLike {
  formattedValue?: string | null;
  hyperlink?: string | null;
  userEnteredValue?: {
    stringValue?: string | null;
    formulaValue?: string | null;
  } | null;
}

function getCellText(row: CellLike[], colIndex: number): string {
  if (colIndex < 0) return "";
  const cell = row[colIndex];
  if (!cell) return "";
  return (cell.formattedValue || "").trim();
}

function getCellHyperlink(row: CellLike[], colIndex: number): string | null {
  if (colIndex < 0) return null;
  const cell = row[colIndex];
  if (!cell) return null;

  // Case 1: cell has a regular Insert→Link hyperlink.
  if (cell.hyperlink) return cell.hyperlink;

  // Case 2: cell uses a =HYPERLINK("url", "text") formula.
  const formula = cell.userEnteredValue?.formulaValue;
  if (formula && formula.toUpperCase().startsWith("=HYPERLINK")) {
    const match = formula.match(/=HYPERLINK\s*\(\s*"([^"]+)"/i);
    if (match) return match[1];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

function normalizeSizeValue(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Treat "N/A" (any case, with or without slash) as "this size doesn't exist".
  if (/^n\/?a$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Extracts a Drive file ID from common Drive URL shapes:
 *   https://drive.google.com/file/d/{ID}/view?usp=...
 *   https://drive.google.com/open?id={ID}
 *   https://docs.google.com/document/d/{ID}/edit
 *   https://drive.google.com/uc?id={ID}&export=download
 */
function extractDriveFileId(url: string | null): string | null {
  if (!url) return null;

  // /file/d/{id}/ or /document/d/{id}/ etc.
  const pathMatch = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (pathMatch) return pathMatch[1];

  // ?id={id} or &id={id}
  const queryMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (queryMatch) return queryMatch[1];

  return null;
}

// ---------------------------------------------------------------------------
// Access allowlist (for sign-in auth)
// ---------------------------------------------------------------------------
const ACCESS_CACHE_TTL_MS = 60 * 1000;
let accessCache: { emails: string[]; expiresAt: number } | null = null;

/**
 * Reads the ACCESS tab from the spreadsheet — a single column of email
 * addresses for external partners (3PLs etc.) who should be allowed in
 * even though they aren't on the company domain.
 *
 * Tab structure:
 *   Row 1:  Email | Name | Company   (header — ignored)
 *   Row 2+: someone@example.com | Jane Doe | Acme 3PL
 *
 * Returns an empty list if the tab doesn't exist (i.e. only domain users
 * will be allowed in).
 */
export async function getAllowedEmails(): Promise<string[]> {
  if (accessCache && accessCache.expiresAt > Date.now()) {
    return accessCache.emails;
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return [];

  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "ACCESS!A2:A1000",
    });
    const rows = response.data.values || [];
    const emails = rows
      .map((row) => (row[0] || "").toString().trim().toLowerCase())
      .filter((email) => email.includes("@"));

    accessCache = {
      emails,
      expiresAt: Date.now() + ACCESS_CACHE_TTL_MS,
    };
    return emails;
  } catch (err) {
    // Tab doesn't exist or other error — fall back to empty allowlist.
    // Domain users will still be allowed in via the auth callback.
    console.warn(
      "Could not read ACCESS tab. Only domain users will be allowed:",
      err instanceof Error ? err.message : err
    );
    accessCache = {
      emails: [],
      expiresAt: Date.now() + ACCESS_CACHE_TTL_MS,
    };
    return [];
  }
}

function makeSlug(name: string, seen: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "icon";

  if (!seen.has(base)) return base;
  // Disambiguate duplicate names with a numeric suffix.
  let n = 2;
  while (seen.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
