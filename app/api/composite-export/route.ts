/**
 * /api/composite-export
 *
 * Generates a multi-page PDF of composite thread usage — the same "which
 * spools get used most" data shown on /composite — with one page per rolling
 * window (12, 6, and 3 months). Each page ranks all 24 spools by total usage
 * (icon colors + chosen text colors), with the per-source breakdown, share,
 * and a distribution bar. Top 15 emphasized.
 *
 * Auth-gated, not cached. Branded to match /api/color-data so the two reports
 * feel like one family.
 */

import { NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@/auth";
import {
  getCompositeStats,
  type CompositeSnapshot,
  type CompositeWindow,
  type WindowKey,
} from "@/lib/compositeStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Rgb = ReturnType<typeof rgb>;

const W = 612;
const H = 792;
const MARGIN = 40;
const FOOTER_Y = 24;
const TOP_Y = H - 56;
const TOP_N = 15;

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

// Render windows longest-first, matching "12 / 6 / 3 month" framing.
const WINDOW_SEQUENCE: WindowKey[] = ["12mo", "6mo", "3mo"];

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const snapshot = await getCompositeStats();
    const bytes = await buildPdf(snapshot);
    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="abbode-composite-thread-usage-${today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Composite PDF generation failed:", msg);
    return new NextResponse("PDF generation failed", { status: 500 });
  }
}

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

  right(text: string, rightX: number, y: number, font: PDFFont, size: number, color: Rgb) {
    this.page.drawText(text, {
      x: rightX - font.widthOfTextAtSize(text, size),
      y, font, size, color,
    });
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

async function buildPdf(snapshot: CompositeSnapshot): Promise<Uint8Array> {
  const r = await Report.create();
  for (const key of WINDOW_SEQUENCE) {
    drawWindowPage(r, snapshot.windows[key], snapshot);
  }
  return r.save();
}

function drawWindowPage(
  r: Report,
  win: CompositeWindow,
  snapshot: CompositeSnapshot,
) {
  r.newPage();
  const { page, serif, sans } = r;

  page.drawText("Composite Thread Usage", {
    x: MARGIN, y: H - 58, font: serif, size: 26, color: C.espresso,
  });

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const sub =
    `Rolling ${win.label}  \u00B7  ${win.totalUses.toLocaleString()} total thread uses  \u00B7  ${today}`;
  page.drawText(sub, {
    x: MARGIN, y: H - 75, font: sans, size: 9, color: C.inkMuted,
  });
  if (snapshot.coverage) {
    page.drawText(`Coverage: ${snapshot.coverage}`, {
      x: MARGIN, y: H - 88, font: sans, size: 8, color: C.inkMuted,
    });
  }

  // Column anchors (right-aligned numeric columns at their X).
  const COL_SW = MARGIN;
  const COL_SLOT = MARGIN + 22;
  const COL_NAME = MARGIN + 50;
  const COL_CODE = MARGIN + 170;
  const COL_ICONS = MARGIN + 250; // right
  const COL_TEXT = MARGIN + 305;  // right
  const COL_TOTAL = MARGIN + 362; // right
  const COL_PCT = MARGIN + 408;   // right
  const BAR_X = MARGIN + 416;
  const BAR_W = W - MARGIN - BAR_X;

  const tableTop = H - 112;

  page.drawText("SLOT", { x: COL_SLOT, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });
  page.drawText("COLOR", { x: COL_NAME, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });
  page.drawText("MADEIRA", { x: COL_CODE, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });
  r.right("ICONS", COL_ICONS, tableTop, sans, 7.5, C.inkMuted);
  r.right("TEXT", COL_TEXT, tableTop, sans, 7.5, C.inkMuted);
  r.right("TOTAL", COL_TOTAL, tableTop, sans, 7.5, C.inkMuted);
  r.right("SHARE", COL_PCT, tableTop, sans, 7.5, C.inkMuted);
  page.drawText("DISTRIBUTION", { x: BAR_X, y: tableTop, font: sans, size: 7.5, color: C.inkMuted });

  page.drawLine({
    start: { x: MARGIN, y: tableTop - 5 },
    end: { x: W - MARGIN, y: tableTop - 5 },
    thickness: 0.8, color: C.espresso,
  });

  const rowH = 19.5;
  const maxTotal = Math.max(1, ...win.colors.map((c) => c.total));
  let y = tableTop - 5 - rowH;

  win.colors.forEach((c, i) => {
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN - 4, y: y - 4,
        width: W - MARGIN - (MARGIN - 4) + 4, height: rowH,
        color: C.rowAlt,
      });
    }
    const ty = y + 4;
    drawSwatch(page, COL_SW, y + 1, 12, c.hex);
    page.drawText(c.slot.toString(), { x: COL_SLOT, y: ty, font: sans, size: 9, color: C.espresso });
    page.drawText(c.name, { x: COL_NAME, y: ty, font: sans, size: 9, color: C.espresso });
    page.drawText(c.code, { x: COL_CODE, y: ty, font: sans, size: 8.5, color: C.inkMuted });
    r.right(c.icons.toLocaleString(), COL_ICONS, ty, sans, 9, C.inkSoft);
    r.right(c.text.toLocaleString(), COL_TEXT, ty, sans, 9, C.inkSoft);
    r.right(c.total.toLocaleString(), COL_TOTAL, ty, sans, 9, C.espresso);
    const pct = win.totalUses > 0 ? (c.total / win.totalUses) * 100 : 0;
    r.right(`${pct.toFixed(0)}%`, COL_PCT, ty, sans, 8.5, C.inkSoft);

    page.drawRectangle({ x: BAR_X, y: y + 2, width: BAR_W, height: 6, color: C.parchment });
    const fillW = BAR_W * (c.total / maxTotal);
    if (fillW > 0) {
      page.drawRectangle({
        x: BAR_X, y: y + 2, width: Math.max(fillW, 1), height: 6,
        color: i < TOP_N ? C.berry : C.inkMuted,
      });
    }

    page.drawLine({
      start: { x: MARGIN, y: y - 4 }, end: { x: W - MARGIN, y: y - 4 },
      thickness: 0.4, color: C.hairline,
    });
    y -= rowH;
  });

  // Footnote
  page.drawText(
    "Total = icon thread colors + chosen text color, counted once per order. " +
      "Retired colors dropped.",
    { x: MARGIN, y: y - 6, font: sans, size: 7.5, color: C.inkMuted },
  );
}
