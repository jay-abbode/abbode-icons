/**
 * PDF builder for the Suggested Category report — the edited list from
 * /reports/icons/compare, each row with the icon's actual PNG, its tag
 * (match / new / added / brand keep), and its order count, followed by a
 * record of what was cut from the current website category.
 *
 * Reuses the branded chrome from lib/iconDataPdf (fonts, palette, footer) so
 * the reports read as one family. Images arrive pre-fetched and pre-resized
 * (the API route normalizes them to small PNGs via sharp) — this module only
 * lays out.
 */

import { PDFImage } from "pdf-lib";
import { Report, C, drawSwatch } from "./iconDataPdf";

export type CategoryPdfItem = {
  icon: string;
  category: string;
  count: number;
  rank: number;
  /** "match" | "new" | "added" | "brand" — absent for cut rows. */
  tag?: string;
  hexes: string[];
  /** Normalized PNG bytes, when the icon has one. */
  imageBytes?: Uint8Array;
  /** Position in the current website category (cut rows). */
  sitePos?: number;
};

export type CategoryPdfOptions = {
  categoryTitle: string;
  /** e.g. "Rolling 3 months (90 days)". */
  windowLabel: string;
  /** Report depth the comparison ran against (top N). */
  top: number;
  items: CategoryPdfItem[];
  cuts: CategoryPdfItem[];
  /** Human-readable manual-edit log, in the order the edits were made. */
  edits: string[];
  updatedAt: string | null;
};

const W = 612;
const H = 792;
const MARGIN = 40;
const ROW_H = 30;
const IMG = 22;
const BOTTOM_Y = 56;

const TAG_LABELS: Record<string, string> = {
  both: "MATCH",
  new: "NEW",
  added: "ADDED",
  brand: "KEPT",
};

function tagColor(tag: string | undefined) {
  if (tag === "new") return C.berry;
  if (tag === "brand") return C.espresso;
  if (tag === "added") return C.inkSoft;
  return C.inkMuted; // match
}

function wrap(r: Report, text: string, size: number, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (r.sans.widthOfTextAtSize(probe, size) <= maxW) {
      line = probe;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBlock(r: Report, entries: string[], opts: { numbered?: boolean } = {}) {
  const size = 8.5;
  const lineH = 13;
  entries.forEach((entry, n) => {
    const prefix = opts.numbered ? `${n + 1}.  ` : "\u2022  ";
    const prefixW = r.sans.widthOfTextAtSize(prefix, size);
    const lines = wrap(r, entry, size, W - 2 * MARGIN - prefixW - 4);
    lines.forEach((line, li) => {
      if (r.y < BOTTOM_Y) {
        r.newPage();
        r.y = H - 56;
      }
      r.page.drawText(li === 0 ? prefix + line : line, {
        x: MARGIN + (li === 0 ? 0 : prefixW),
        y: r.y,
        font: r.sans,
        size,
        color: C.inkSoft,
      });
      r.y -= lineH;
    });
    r.y -= 2;
  });
}

function sectionHeading(r: Report, text: string, color = C.espresso) {
  if (r.y < BOTTOM_Y + 70) {
    r.newPage();
    r.y = H - 56;
  }
  r.y -= 8;
  r.page.drawText(text, { x: MARGIN, y: r.y, font: r.serif, size: 14, color });
  r.page.drawLine({
    start: { x: MARGIN, y: r.y - 6 },
    end: { x: W - MARGIN, y: r.y - 6 },
    thickness: 0.8,
    color,
  });
  r.y -= 26;
}

function drawRow(
  r: Report,
  idx: number | null,
  item: CategoryPdfItem,
  image: PDFImage | undefined,
  detail: string
) {
  if (r.y < BOTTOM_Y) {
    r.newPage();
    r.y = H - 56;
  }
  const y = r.y;
  const { page, sans } = r;

  if (idx !== null) {
    r.right(`${idx + 1}`, MARGIN + 18, y + 8, sans, 9, C.inkMuted);
  }

  const imgX = MARGIN + 28;
  if (image) {
    // Fit inside the IMG box, centered, preserving aspect.
    const scale = Math.min(IMG / image.width, IMG / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: imgX + (IMG - w) / 2, y: y + (IMG - h) / 2 - 3, width: w, height: h });
  } else {
    item.hexes.slice(0, 4).forEach((hex, k) => {
      drawSwatch(page, imgX + k * 6, y + 5, 5.5, hex);
    });
  }

  const nameX = MARGIN + 62;
  const name = r.truncate(item.icon, sans, 9.5, 180);
  page.drawText(name, { x: nameX, y: y + 8, font: sans, size: 9.5, color: C.espresso });
  if (item.category) {
    const cat = r.truncate(item.category, sans, 8, 100);
    page.drawText(cat, { x: MARGIN + 250, y: y + 8, font: sans, size: 8, color: C.inkMuted });
  }

  if (item.tag) {
    const label = TAG_LABELS[item.tag] ?? item.tag.toUpperCase();
    page.drawText(label, { x: MARGIN + 358, y: y + 8, font: sans, size: 7, color: tagColor(item.tag) });
  }

  r.right(detail, W - MARGIN, y + 8, sans, 8.5, C.inkSoft);

  page.drawLine({
    start: { x: MARGIN, y: y - 2 },
    end: { x: W - MARGIN, y: y - 2 },
    thickness: 0.4,
    color: C.hairline,
  });
  r.y -= ROW_H;
}

export async function buildCategoryPdf(opts: CategoryPdfOptions): Promise<Uint8Array> {
  const { categoryTitle, windowLabel, top, items, cuts, edits, updatedAt } = opts;
  const r = await Report.create();
  r.newPage();

  const { page, serif, sans } = r;
  page.drawText(`Suggested Category — ${categoryTitle}`, {
    x: MARGIN,
    y: H - 58,
    font: serif,
    size: 24,
    color: C.espresso,
  });
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sub = `${windowLabel}  \u00B7  ${items.length} icons  \u00B7  ${cuts.length} cut from the current category  \u00B7  ${today}`;
  page.drawText(sub, { x: MARGIN, y: H - 75, font: sans, size: 9, color: C.inkMuted });
  if (updatedAt) {
    page.drawText(`Order data updated ${updatedAt}`, { x: MARGIN, y: H - 88, font: sans, size: 8, color: C.inkMuted });
  }

  // Embed each distinct image once.
  const embedded = new Map<CategoryPdfItem, PDFImage>();
  for (const item of [...items, ...cuts]) {
    if (!item.imageBytes) continue;
    try {
      embedded.set(item, await r.doc.embedPng(item.imageBytes));
    } catch {
      // Unembeddable bytes — the swatch fallback covers it.
    }
  }

  r.y = H - 118;
  items.forEach((item, i) => {
    const detail = `${item.count.toLocaleString()} orders${item.rank > 0 ? `  \u00B7  #${item.rank}` : ""}`;
    drawRow(r, i, item, embedded.get(item), detail);
  });

  if (cuts.length > 0) {
    if (r.y < BOTTOM_Y + 60) {
      r.newPage();
      r.y = H - 56;
    }
    r.y -= 6;
    r.page.drawText(`Cut from the current category (${cuts.length})`, {
      x: MARGIN,
      y: r.y + 8,
      font: serif,
      size: 14,
      color: C.berry,
    });
    r.page.drawLine({
      start: { x: MARGIN, y: r.y + 2 },
      end: { x: W - MARGIN, y: r.y + 2 },
      thickness: 0.8,
      color: C.berry,
    });
    r.y -= ROW_H;
    cuts.forEach((item) => {
      const detail = `${item.rank > 0 ? `#${item.rank}  \u00B7  ` : ""}${item.count.toLocaleString()} orders${item.sitePos ? `  \u00B7  site pos ${item.sitePos}` : ""}`;
      drawRow(r, null, item, embedded.get(item), detail);
    });
    r.page.drawText("Remove these from the metaobject when applying the list above.", {
      x: MARGIN,
      y: r.y + 14,
      font: sans,
      size: 7.5,
      color: C.inkMuted,
    });
    r.y -= 8;
  }

  // ── How this list was built ────────────────────────────────────────────────
  sectionHeading(r, "How this list was built");
  const brandKeeps = items.filter((i) => i.tag === "brand").length;
  const manualAdds = items.filter((i) => i.tag === "added").length;
  drawTextBlock(r, [
    `The report side is the top ${top} most-ordered icons of the ${windowLabel.toLowerCase()}; the website side is the "${categoryTitle}" category as last synced from Shopify.`,
    `Icons in BOTH sets keep their spot (tagged MATCH) and lead the list, ordered by their rank in the window.`,
    `Icons in the top ${top} that the website doesn't feature follow (tagged NEW), in the same rank order.`,
    `Website icons outside the top ${top} are proposed as cuts. Any kept by hand appear in the list tagged KEPT${brandKeeps ? ` (${brandKeeps} this time)` : ""}; the rest are listed under "Cut from the current category" above.`,
    `Icons swapped in manually from the ranked list are tagged ADDED${manualAdds ? ` (${manualAdds} this time)` : ""}.`,
    `Manual edits override the generated list; each one is recorded below.`,
  ]);

  // ── Manual edits ───────────────────────────────────────────────────────────
  sectionHeading(r, `Manual edits (${edits.length})`);
  if (edits.length === 0) {
    drawTextBlock(r, ["None — the list is exactly as generated."]);
  } else {
    drawTextBlock(r, edits, { numbered: true });
  }

  return r.save();
}
