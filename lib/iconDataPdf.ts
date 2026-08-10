/**
 * PDF builder for the "Icon Order Frequency" report — every ranked icon with
 * its catalog thread-color swatches, category, order count, and a distribution
 * bar. Paginates as needed; top 15 emphasized.
 *
 * Lives in lib/ (rather than inline in the API route) so the layout can be
 * exercised in tests and reused. Branded to match /api/composite-export and
 * /api/color-data so the reports feel like one family.
 */

import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { promises as fs } from "fs";
import path from "path";

export type IconPdfRow = {
  icon: string;
  category: string;
  /** Order count within the report's window. */
  count: number;
  hexes: string[];
};

export type IconPdfOptions = {
  rows: IconPdfRow[];
  /** e.g. "Rolling 3 months". */
  windowLabel: string;
  /** e.g. "Top 30 of 412 icons" or "412 icons". */
  scopeLabel: string;
  totalOrders: number;
  updatedAt: string | null;
};

type Rgb = ReturnType<typeof rgb>;

const W = 612;
const H = 792;
const MARGIN = 40;
const FOOTER_Y = 24;
const TOP_N = 15;

const C = {
  espresso: rgb(67 / 255, 34 / 255, 34 / 255),
  berry: rgb(187 / 255, 55 / 255, 103 / 255),
  porcelain: rgb(255 / 255, 252 / 255, 247 / 255),
  parchment: rgb(245 / 255, 240 / 255, 235 / 255),
  rowAlt: rgb(250 / 255, 246 / 255, 241 / 255),
  inkMuted: rgb(150 / 255, 130 / 255, 130 / 255),
  inkSoft: rgb(110 / 255, 88 / 255, 88 / 255),
  hairline: rgb(232 / 255, 224 / 255, 216 / 255),
  swatchEdge: rgb(0, 0, 0),
};

// Column anchors
const COL_RANK = MARGIN + 16; // right
const COL_SW = MARGIN + 24;
const COL_NAME = MARGIN + 74;
const COL_CAT = MARGIN + 252;
const COL_ORDERS = MARGIN + 360; // right
const BAR_X = MARGIN + 372;
const BAR_W = W - MARGIN - BAR_X;

const ROW_H = 18;
const BOTTOM_Y = 52;

class Report {
  doc!: PDFDocument;
  page!: PDFPage;
  serif!: PDFFont;
  sans!: PDFFont;
  y = H;
  pageNum = 0;

  static async create(): Promise<Report> {
    const r = new Report();
    r.doc = await PDFDocument.create();
    r.doc.registerFontkit(fontkit);
    const dir = path.join(process.cwd(), "public", "fonts");
    r.serif = await r.doc.embedFont(
      await fs.readFile(path.join(dir, "Abbode-NewYork-Font-1_0.ttf")),
      { subset: true }
    );
    r.sans = await r.doc.embedFont(
      await fs.readFile(path.join(dir, "Abbode-Berlin-Font-1_0.ttf")),
      { subset: true }
    );
    return r;
  }

  newPage() {
    if (this.pageNum > 0) this.drawFooter();
    this.page = this.doc.addPage([W, H]);
    this.pageNum++;
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.porcelain });
    this.y = H;
  }

  drawFooter() {
    this.page.drawText(
      "abbode-icons.vercel.app  \u00B7  Internal embroidery icon catalog",
      { x: MARGIN, y: FOOTER_Y, font: this.sans, size: 8, color: C.inkMuted }
    );
    const pg = `Page ${this.pageNum}`;
    this.page.drawText(pg, {
      x: W - MARGIN - this.sans.widthOfTextAtSize(pg, 8),
      y: FOOTER_Y,
      font: this.sans,
      size: 8,
      color: C.inkMuted,
    });
  }

  right(text: string, rightX: number, y: number, font: PDFFont, size: number, color: Rgb) {
    this.page.drawText(text, {
      x: rightX - font.widthOfTextAtSize(text, size),
      y,
      font,
      size,
      color,
    });
  }

  truncate(text: string, font: PDFFont, size: number, maxW: number): string {
    if (font.widthOfTextAtSize(text, size) <= maxW) return text;
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(t + "\u2026", size) > maxW) {
      t = t.slice(0, -1);
    }
    return t + "\u2026";
  }

  async save() {
    this.drawFooter();
    return this.doc.save();
  }
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
}

function drawSwatch(page: PDFPage, x: number, y: number, size: number, hex: string) {
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    color: hexToRgb(hex),
    borderColor: C.swatchEdge,
    borderWidth: 0.5,
    borderOpacity: 0.15,
  });
}

function drawColumnHeader(r: Report) {
  const { page, sans } = r;
  const y = r.y;
  r.right("#", COL_RANK, y, sans, 7.5, C.inkMuted);
  page.drawText("ICON", { x: COL_NAME, y, font: sans, size: 7.5, color: C.inkMuted });
  page.drawText("CATEGORY", { x: COL_CAT, y, font: sans, size: 7.5, color: C.inkMuted });
  r.right("ORDERS", COL_ORDERS, y, sans, 7.5, C.inkMuted);
  page.drawText("FREQUENCY", { x: BAR_X, y, font: sans, size: 7.5, color: C.inkMuted });
  page.drawLine({
    start: { x: MARGIN, y: y - 5 },
    end: { x: W - MARGIN, y: y - 5 },
    thickness: 0.8,
    color: C.espresso,
  });
  r.y = y - 5 - ROW_H;
}

export async function buildIconDataPdf(opts: IconPdfOptions): Promise<Uint8Array> {
  const { rows, windowLabel, scopeLabel, totalOrders, updatedAt } = opts;
  const r = await Report.create();
  r.newPage();

  const { page, serif, sans } = r;
  page.drawText("Icon Order Frequency", {
    x: MARGIN,
    y: H - 58,
    font: serif,
    size: 26,
    color: C.espresso,
  });
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const sub = `${windowLabel || "Recent orders"}  \u00B7  ${scopeLabel}  \u00B7  ${totalOrders.toLocaleString()} icon orders  \u00B7  ${today}`;
  page.drawText(sub, { x: MARGIN, y: H - 75, font: sans, size: 9, color: C.inkMuted });
  if (updatedAt) {
    page.drawText(`Data updated ${updatedAt}`, {
      x: MARGIN,
      y: H - 88,
      font: sans,
      size: 8,
      color: C.inkMuted,
    });
  }

  const maxCount = Math.max(1, ...rows.map((s) => s.count));

  r.y = H - 112;
  drawColumnHeader(r);

  let rowIdx = 0;
  rows.forEach((s, i) => {
    if (r.y < BOTTOM_Y) {
      r.newPage();
      r.y = H - 56;
      drawColumnHeader(r);
      rowIdx = 0;
    }
    const y = r.y;
    if (rowIdx % 2 === 1) {
      r.page.drawRectangle({
        x: MARGIN - 4,
        y: y - 4,
        width: W - 2 * MARGIN + 8,
        height: ROW_H,
        color: C.rowAlt,
      });
    }
    const ty = y + 3;
    r.right(`${i + 1}`, COL_RANK, ty, sans, 9, C.inkMuted);

    const swHexes = s.hexes.slice(0, 4);
    swHexes.forEach((hex, k) => {
      drawSwatch(r.page, COL_SW + k * 11, y, 9, hex);
    });

    const name = r.truncate(s.icon, sans, 9, COL_CAT - COL_NAME - 6);
    r.page.drawText(name, {
      x: COL_NAME,
      y: ty,
      font: sans,
      size: 9,
      color: i < TOP_N ? C.espresso : C.inkSoft,
    });
    if (s.category) {
      const cat = r.truncate(s.category, sans, 8.5, COL_ORDERS - 40 - COL_CAT);
      r.page.drawText(cat, { x: COL_CAT, y: ty, font: sans, size: 8.5, color: C.inkMuted });
    }
    r.right(s.count.toLocaleString(), COL_ORDERS, ty, sans, 9, i < TOP_N ? C.espresso : C.inkSoft);

    r.page.drawRectangle({ x: BAR_X, y: y + 1, width: BAR_W, height: 6, color: C.parchment });
    const fillW = BAR_W * (s.count / maxCount);
    if (fillW > 0) {
      r.page.drawRectangle({
        x: BAR_X,
        y: y + 1,
        width: Math.max(fillW, 1),
        height: 6,
        color: i < TOP_N ? C.berry : C.inkMuted,
      });
    }

    r.page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: W - MARGIN, y: y - 4 },
      thickness: 0.4,
      color: C.hairline,
    });
    r.y -= ROW_H;
    rowIdx++;
  });

  r.page.drawText(
    "Swatches show each icon's catalog thread colors. Top 15 emphasized.",
    { x: MARGIN, y: r.y - 6, font: sans, size: 7.5, color: C.inkMuted }
  );

  return r.save();
}
