/**
 * Madeira Polyneon thread palette — the 24 spool colors loaded on the
 * embroidery machine.
 *
 * Kept in sync (manually, for now) with
 *   scripts/extract_colors/madeira_polyneon.json
 *
 * RGB values are best-effort approximations from color names. They're used in
 * the app for displaying color chips next to each icon. If a chip ever looks
 * obviously wrong, edit the corresponding entry below.
 */

export type ThreadColor = {
  /** Machine slot number (0-37, with gaps where no spool is loaded). */
  slot: number;
  /** Madeira Polyneon 4-digit code. */
  code: string;
  /** Color name as it appears on the spool / chart. */
  name: string;
  /** RGB triple, 0-255 per channel. */
  rgb: [number, number, number];
};

export const THREAD_PALETTE: ThreadColor[] = [
  // RGB values calibrated from photos of the actual Madeira polyneon swatches
  // (median of an 80% center crop on each scan). Earlier values were guessed
  // from the color name; these are now grounded in the real thread.
  { slot: 0,  code: "1567", name: "Burgundy",        rgb: [109,  52,  58] },
  { slot: 1,  code: "1747", name: "Red",        rgb: [152,  42,  49] },
  { slot: 4,  code: "1621", name: "Rust",     rgb: [186,  92,  42] },
  { slot: 5,  code: "1965", name: "Orange",          rgb: [235, 112,  17] },
  { slot: 6,  code: "1752", name: "Peach",           rgb: [255, 214, 164] },
  { slot: 7,  code: "1725", name: "Dark Yellow",     rgb: [204, 148,  59] },
  { slot: 8,  code: "1735", name: "Yellow",          rgb: [255, 248, 115] },
  { slot: 10, code: "1769", name: "Olive",     rgb: [ 92, 117,  44] },
  { slot: 12, code: "1902", name: "Dark Green",      rgb: [ 45,  71,  53] },
  { slot: 13, code: "1648", name: "Matcha",    rgb: [141, 161,  99] },
  { slot: 17, code: "1675", name: "Light Blue", rgb: [166, 220, 252] },
  { slot: 19, code: "1843", name: "Royal Blue",      rgb: [ 38,  75, 123] },
  { slot: 20, code: "1643", name: "Navy",            rgb: [ 46,  59,  71] },
  { slot: 21, code: "1832", name: "Purple",          rgb: [103,  87, 155] },
  { slot: 27, code: "1917", name: "Pink",      rgb: [200, 122, 139] },
  { slot: 28, code: "1816", name: "Light Pink",      rgb: [255, 222, 238] },
  { slot: 29, code: "1855", name: "Tan",             rgb: [178, 152, 112] },
  { slot: 30, code: "1657", name: "Milk Chocolate",  rgb: [127,  93,  66] },
  { slot: 31, code: "1659", name: "Dark Chocolate",  rgb: [ 87,  66,  56] },
  { slot: 32, code: "1811", name: "Silver",          rgb: [208, 219, 221] },
  { slot: 34, code: "1539", name: "Charcoal",        rgb: [101, 100,  96] },
  { slot: 35, code: "1801", name: "White",           rgb: [250, 252, 255] },
  { slot: 36, code: "1800", name: "Black",           rgb: [ 51,  55,  55] },
  { slot: 37, code: "1682", name: "Tusk",            rgb: [244, 236, 215] },
];

const BY_SLOT = new Map<number, ThreadColor>(
  THREAD_PALETTE.map((t) => [t.slot, t])
);

export function getThreadBySlot(slot: number): ThreadColor | undefined {
  return BY_SLOT.get(slot);
}

export function rgbToHex(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/**
 * Parse a "Thread Colors" cell into an array of slot numbers.
 * Accepts comma- or semicolon-separated lists, ignores whitespace, drops
 * anything non-numeric. Examples:
 *   "20; 35; 8"          -> [20, 35, 8]
 *   "20, 35, 8"          -> [20, 35, 8]
 *   "20"                 -> [20]
 *   ""                   -> []
 *   "20; 35; ?"          -> [20, 35]
 *   "Slot 20, slot 35"   -> [20, 35]
 */
export function parseThreadSlots(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const tokens = raw.split(/[;,]/);
  const slots: number[] = [];
  for (const tok of tokens) {
    const m = tok.match(/-?\d+/);
    if (!m) continue;
    const n = parseInt(m[0], 10);
    if (Number.isFinite(n) && !slots.includes(n)) slots.push(n);
  }
  return slots;
}
