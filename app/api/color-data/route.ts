/**
 * /api/color-data
 *
 * Generates a multi-page PDF report of thread color usage from the live
 * catalog:
 *   - Page 1: overall usage table (every spool, with icon counts, share of
 *     catalog, and a distribution bar)
 *   - Page 2+: per-category breakdown — the threads used in each category,
 *     ranked by frequency within that category
 *
 * Auth-gated. Not cached (reflects current sheet state). Branded with the
 * Abbode fonts and palette but intentionally restrained — this is a
 * reference document, not a poster.
 */

import { NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@/auth";
import {
  getColorDataReport,
  type ColorDataReport,
  type ColorStat,
} from "@/lib/colorStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// pdf-lib's color type, derived so we don't depend on the exported name.
type Rgb = ReturnType<typeof rgb>;

const W = 612;
const H = 792;
const MARGIN = 40;
const FOOTER_Y = 24;
const TOP_Y = H - 56;

const C = {
  espresso:  rgb(67 / 255, 34 / 255, 34 / 255),
  berry:     rgb(187 / 255, 55 / 255, 103 / 255),
  porcelain: rgb(255 / 255, 252 / 255, 247 / 255),
  parchment: rgb(245 / 255, 240 / 255, 235 / 255),
  rowAlt:    rgb(250 / 255, 246 / 255, 241 / 255),
  inkMuted:  rgb(150 / 255, 130 / 255, 130 / 255),
  inkSoft:   rgb(110 / 255, 88 / 255, 88 / 255),
  hairline:  rgb(232 / 255, 224 / 255, 216 / 255),
  swatchEdge: rgb(0, 0, 0),
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const report = await getColorDataReport();
    const bytes = await buildPdf(report);
    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="abbode-thread-colors-${today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Color-data PDF generation failed:", msg);
    return new NextResponse("PDF generation failed", { status: 500 });
  }
}

/**
 * Small stateful builder over pdf-lib's imperative API. Tracks the current
 * page and a vertical cursor (`y`) so the category section can flow across
 * as many pages as needed, drawing a footer on each.
 */
class Report {
  doc!: PDFDocument;
  page!: PDFPage;
  serif!: PDFFont;
  sans!: PDFFont;
  y = TOP_Y;
  pageNum = 0;

  static async create(): Promise<Report> {
    const r = new Report();
    r.doc = await PDFDocument.create();
    r.doc.registerFontkit(fontkit);
    const dir = path.join(process.cwd(), "public", "fonts");
    r.serif = await r.doc.embedFont(
      await fs.readFile(path.join(dir, "Abbode-NewYork-Font-1_0.ttf")),
      { subset: true },
    );
    r.sans = await r.doc.embedFont(
      await fs.readFile(path.join(dir, "Abbode-Berlin-Font-1_0.ttf")),
      { subset: true },
    );
    return r;
  }

  newPage() {
    if (this.pageNum > 0) this.drawFooter();
    this.page = this.doc.addPage([W, H]);
    this.pageNum++;
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.porcelain });
    this.y = TOP_Y;
  }

  drawFooter() {
    this.page.drawText(
      "abbode-icons.vercel.app  \u00B7  Internal embroidery icon catalog",
      { x: MARGIN, y: FOOTER_Y, font: this.sans, size: 8, color: C.inkMuted },
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

  /** Ensure at least `needed` points remain before the footer; else new page. */
  ensureSpace(needed: number) {
    if (this.y - needed < FOOTER_Y + 20) this.newPage();
  }

  right(text: string, rightX: number, y: number, font: PDFFont, size: number, color: Rgb) {
    this.page.drawText(text, {
      x: rightX - font.widthOfTextAtSize(text, size),
      y, font, size, color,
    });
  }

  async save() {
    this.drawFooter(); // footer on the final page
    return this.doc.save();
  }
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function drawSwatch(page: PDFPage, x: number, y: number, size: number, hex: string) {
  page.drawRectangle({
    x, y, width: size, height: size,
    color: hexToRgb(hex),
    borderColor: C.swatchEdge,
    borderWidth: 0.5,
    opacity: 1,
    borderOpacity: 0.15,
  });
}

async function buildPdf(report: ColorDataReport): Promise<Uint8Array> {
  const r = await Report.create();

  drawSummaryPage(r, report);
  drawCategoryPages(r, report);

  return r.save();
}

// ---------- Page 1: overall usage table ----------
function drawSummaryPage(r: Report, report: ColorDataReport) {
  r.newPage();
  const { page, serif, sans } = r;

  page.drawText("Thread Color Report", {
    x: MARGIN, y: H - 58, font: serif, size: 28, color: C.espresso,
  });

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  page.drawText(
    `${report.totalIcons.toLocaleString()} icons  \u00B7  24 Madeira spools  \u00B7  ` +
      `${report.totalUses.toLocaleString()} total thread uses  \u00B7  ${today}`,
    { x: MARGIN, y: H - 75, font: sans, size: 9, color: C.inkMuted },
  );

  // Column anchors
  const COL_SW = MARGIN;
  const COL_SLOT = MARGIN + 22;
  const COL_NAME = MARGIN + 52;
  const COL_CODE = MARGIN + 188;
  const COL_CNT = MARGIN + 300; // right-aligned
  const COL_PCT = MARGIN + 360; // right-aligned
  const BAR_X = MARGIN + 372;
  const BAR_W = W - MARGIN - BAR_X;

  const tableTop = H - 100;

  // Header
  page.drawText("SLOT", { x: COL_SLOT, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });
  page.drawText("COLOR", { x: COL_NAME, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });
  page.drawText("MADEIRA", { x: COL_CODE, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });
  r.right("ICONS", COL_CNT, tableTop, sans, 7.5, C.inkMuted);
  r.right("SHARE", COL_PCT, tableTop, sans, 7.5, C.inkMuted);
  page.drawText("DISTRIBUTION", { x: BAR_X, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });

  page.drawLine({
    start: { x: MARGIN, y: tableTop - 5 },
    end: { x: W - MARGIN, y: tableTop - 5 },
    thickness: 0.8, color: C.espresso,
  });

  const rowH = 19.5;
  const maxCount = Math.max(1, ...report.colors.map((c) => c.count));
  let y = tableTop - 5 - rowH;

  report.colors.forEach((stat: ColorStat, i: number) => {
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN - 4, y: y - 4,
        width: W - MARGIN - (MARGIN - 4) + 4, height: rowH,
        color: C.rowAlt,
      });
    }
    const ty = y + 4;
    drawSwatch(page, COL_SW, y + 1, 12, stat.hex);
    page.drawText(stat.slot.toString(), { x: COL_SLOT, y: ty, font: sans, size: 9, color: C.espresso });
    page.drawText(stat.name, { x: COL_NAME, y: ty, font: sans, size: 9, color: C.espresso });
    page.drawText(stat.code, { x: COL_CODE, y: ty, font: sans, size: 8.5, color: C.inkMuted });
    r.right(stat.count.toLocaleString(), COL_CNT, ty, sans, 9, C.espresso);
    const pct = report.totalIcons > 0 ? (stat.count / report.totalIcons) * 100 : 0;
    r.right(`${pct.toFixed(0)}%`, COL_PCT, ty, sans, 8.5, C.inkSoft);

    // distribution bar
    page.drawRectangle({ x: BAR_X, y: y + 2, width: BAR_W, height: 6, color: C.parchment });
    const fillW = BAR_W * (stat.count / maxCount);
    if (fillW > 0) {
      page.drawRectangle({
        x: BAR_X, y: y + 2, width: Math.max(fillW, 1), height: 6,
        color: i < 15 ? C.berry : C.inkMuted,
      });
    }

    page.drawLine({
      start: { x: MARGIN, y: y - 4 }, end: { x: W - MARGIN, y: y - 4 },
      thickness: 0.4, color: C.hairline,
    });
    y -= rowH;
  });
}

// ---------- Page 2+: per-category breakdown ----------
function drawCategoryPages(r: Report, report: ColorDataReport) {
  r.newPage();
  const { page, serif, sans } = r;

  page.drawText("Color Usage by Category", {
    x: MARGIN, y: H - 56, font: serif, size: 22, color: C.espresso,
  });
  page.drawText(
    "Threads used in each category, ranked by frequency within that category.",
    { x: MARGIN, y: H - 72, font: sans, size: 9, color: C.inkMuted },
  );
  r.y = H - 96;

  for (const cat of report.categories) {
    // Reserve room for the header + at least one chip row before committing.
    r.ensureSpace(44);

    // Category header
    r.page.drawText(cat.category, {
      x: MARGIN, y: r.y, font: r.sans, size: 11, color: C.espresso,
    });
    const nameW = r.sans.widthOfTextAtSize(cat.category, 11);
    const meta = `${cat.iconCount} ${cat.iconCount === 1 ? "icon" : "icons"}  \u00B7  ` +
      `${cat.colors.length} ${cat.colors.length === 1 ? "color" : "colors"}`;
    r.page.drawText(meta, {
      x: MARGIN + nameW + 8, y: r.y, font: r.sans, size: 8.5, color: C.inkMuted,
    });
    r.y -= 6;
    r.page.drawLine({
      start: { x: MARGIN, y: r.y }, end: { x: W - MARGIN, y: r.y },
      thickness: 0.5, color: C.hairline,
    });
    r.y -= 16;

    // Color chips, wrapping
    let chipX = MARGIN;
    const chipRowH = 16;
    for (const col of cat.colors) {
      const label = `${col.slot} ${col.name} (${col.count})`;
      const textW = r.sans.widthOfTextAtSize(label, 8.5);
      const chipW = 11 + 4 + textW + 16; // swatch + gap + text + trailing gap
      if (chipX + chipW > W - MARGIN) {
        chipX = MARGIN;
        r.y -= chipRowH + 4;
        if (r.y < FOOTER_Y + 24) {
          r.newPage();
          r.y = TOP_Y;
        }
      }
      drawSwatch(r.page, chipX, r.y - 2, 10, col.hex);
      r.page.drawText(label, {
        x: chipX + 15, y: r.y, font: r.sans, size: 8.5, color: C.inkSoft,
      });
      chipX += chipW;
    }
    r.y -= 26; // gap before next category
  }
}
