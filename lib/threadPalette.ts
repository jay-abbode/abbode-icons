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
  { slot: 0,  code: "1567", name: "Burgundy",        rgb: [120,  24,  42] },
  { slot: 1,  code: "1747", name: "Dark Red",        rgb: [185,  30,  36] },
  { slot: 4,  code: "1621", name: "Rust Orange",     rgb: [175,  78,  36] },
  { slot: 5,  code: "1965", name: "Orange",          rgb: [238, 105,  32] },
  { slot: 6,  code: "1752", name: "Peach",           rgb: [248, 192, 158] },
  { slot: 7,  code: "1725", name: "Dark Yellow",     rgb: [216, 180,  50] },
  { slot: 8,  code: "1735", name: "Yellow",          rgb: [248, 222,  56] },
  { slot: 10, code: "1769", name: "Olive Green",     rgb: [132, 132,  60] },
  { slot: 12, code: "1902", name: "Dark Green",      rgb: [ 28,  78,  48] },
  { slot: 13, code: "1648", name: "Matcha Green",    rgb: [104, 168,  90] },
  { slot: 17, code: "1675", name: "Cool Periwinkle", rgb: [142, 162, 220] },
  { slot: 19, code: "1843", name: "Dark Royal",      rgb: [ 28,  56, 150] },
  { slot: 20, code: "1643", name: "Navy",            rgb: [ 22,  40,  90] },
  { slot: 21, code: "1832", name: "Purple",          rgb: [112,  56, 160] },
  { slot: 27, code: "1917", name: "Dusty Pink",      rgb: [212, 158, 168] },
  { slot: 28, code: "1816", name: "Light Pink",      rgb: [246, 198, 212] },
  { slot: 29, code: "1855", name: "Tan",             rgb: [202, 172, 132] },
  { slot: 30, code: "1657", name: "Milk Chocolate",  rgb: [128,  84,  50] },
  { slot: 31, code: "1659", name: "Dark Chocolate",  rgb: [ 68,  44,  30] },
  { slot: 32, code: "1811", name: "Silver",          rgb: [184, 184, 188] },
  { slot: 34, code: "1539", name: "Charcoal",        rgb: [ 60,  60,  64] },
  { slot: 35, code: "1801", name: "White",           rgb: [248, 246, 238] },
  { slot: 36, code: "1800", name: "Black",           rgb: [ 14,  14,  18] },
  { slot: 37, code: "1682", name: "Tusk",            rgb: [232, 218, 192] },
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
