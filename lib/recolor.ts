/**
 * Server-side recolor of a single-color stitched PNG.
 *
 * Algorithm (same as the bow prototype, ported from numpy to Node):
 *   1. Read raw RGBA pixels via Sharp.
 *   2. Compute brightness = max(R, G, B) per pixel. For an icon stitched
 *      in one bright color on a black background, this is a clean proxy for
 *      "how non-black is this pixel" and varies across stitches because
 *      individual thread strands catch light differently.
 *   3. Auto-calibrate a reference brightness per image using the 90th
 *      percentile of non-background pixels — i.e. "what does a typical
 *      bright stitch look like in this particular icon". This way we don't
 *      have to assume every catalog icon was rendered at the same brightness.
 *   4. factor = brightness / reference, clamped to [0, 1.2]. Most stitch
 *      body lands near 1.0, between-stitch grooves come in at 0.7-0.9,
 *      bright highlights up to 1.2, anti-aliased edges drop toward 0.
 *   5. output RGB = target * factor (clamped to 255). This is what preserves
 *      the stitch texture as visible lightness variation in the new color.
 *   6. alpha = min(255, brightness * 4). Pure black → fully transparent;
 *      anti-aliased pixels fade smoothly; any pixel with brightness >= ~64
 *      is fully opaque so the icon body keeps its stitch detail visible.
 */

import sharp from "sharp";

export type RGB = readonly [number, number, number];

/** Recolor a PNG buffer to the target RGB. Returns a new PNG buffer. */
export async function recolorPng(
  input: Buffer,
  target: RGB
): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const pixelCount = width * height;

  // Pass 1: brightness per pixel + histogram of non-background brightness
  const brightness = new Uint8Array(pixelCount);
  const histogram = new Uint32Array(256);
  let nonBgCount = 0;

  for (let p = 0; p < pixelCount; p++) {
    const off = p * 4;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    const br = r > g ? (r > b ? r : b) : g > b ? g : b;
    brightness[p] = br;
    // Threshold 30 keeps anti-aliased edge pixels out of the reference sample;
    // we only want "typical stitch" pixels to set the brightness scale.
    if (br > 30) {
      histogram[br]++;
      nonBgCount++;
    }
  }

  // 90th-percentile brightness as the reference. Fall back to 220 (the bow's
  // value) if the image has too few stitch pixels to compute a stable
  // percentile.
  let refBrightness = 220;
  if (nonBgCount >= 100) {
    const target90 = Math.floor(nonBgCount * 0.9);
    let cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += histogram[v];
      if (cum >= target90) {
        refBrightness = v;
        break;
      }
    }
  }
  // Sanity floor: an icon rendered very dimly shouldn't blow up the factor.
  if (refBrightness < 100) refBrightness = 100;

  // Pass 2: apply target × factor and write the output buffer.
  const out = Buffer.allocUnsafe(pixelCount * 4);
  const tR = target[0];
  const tG = target[1];
  const tB = target[2];
  const invRef = 1 / refBrightness;
  const factorCap = 1.2;

  for (let p = 0; p < pixelCount; p++) {
    const off = p * 4;
    const br = brightness[p];

    let factor = br * invRef;
    if (factor > factorCap) factor = factorCap;

    const nr = (tR * factor + 0.5) | 0;
    const ng = (tG * factor + 0.5) | 0;
    const nb = (tB * factor + 0.5) | 0;

    out[off] = nr > 255 ? 255 : nr;
    out[off + 1] = ng > 255 ? 255 : ng;
    out[off + 2] = nb > 255 ? 255 : nb;

    const a = br * 4;
    out[off + 3] = a > 255 ? 255 : a;
  }

  return await sharp(out, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
