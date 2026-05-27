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

/**
 * Compute how much shadow (darkening) to apply when recoloring to a target.
 *
 * For dark/saturated targets (luminance ≤ 0.7) we keep the original full
 * multiplicative behavior — the natural darkening at mid-brightness pixels
 * reads as honest shadow on e.g. burgundy or navy.
 *
 * For light targets (luminance > 0.7) we taper the shadow strength toward
 * 0.25 as luminance approaches white. This compresses the dark end of the
 * curve so a pure-white target produces output in the [75%–100%] of-white
 * range across the icon instead of dropping to 50% gray for mid-brightness
 * pixels (which is what made white recolors look silver).
 *
 * Stitch texture is still preserved — the same brightness variations across
 * stitches still produce proportional output variations, just within a
 * lighter band when the target itself is light.
 */
function shadowStrengthFor(target: RGB): number {
  const luminance = (target[0] + target[1] + target[2]) / 765;
  // No lift below 0.7, ramps linearly to 0.25 at luminance 1.0.
  const lifted = 1.0 - Math.max(0, luminance - 0.7) * 2.5;
  return lifted < 0.25 ? 0.25 : lifted;
}

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
  // Constant per recolor call: how aggressively to apply shadow vs target.
  const shadowStrength = shadowStrengthFor(target);

  for (let p = 0; p < pixelCount; p++) {
    const off = p * 4;
    const br = brightness[p];

    let rawFactor = br * invRef;
    if (rawFactor > factorCap) rawFactor = factorCap;
    // f blends between full multiplicative (shadowStrength = 1) and
    // "target with only mild shadow" (shadowStrength ≈ 0.25 for white).
    const factor = 1 - shadowStrength * (1 - rawFactor);

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

// ---------------------------------------------------------------------------
// Two-region recolor (multi-color designs)
// ---------------------------------------------------------------------------
//
// For icons that stitch two distinct colors (e.g. a bandana with a colored
// body and a white pattern, or a cowboy boot with a tan body and a darker
// brown filigree), we classify each pixel as belonging to the "base" region
// or the "accent" region using 2-means clustering on the RGB values of the
// solid pixels (those bright enough to not be background or anti-aliased
// edge). The cluster center closer to the supplied `anchorBase` becomes the
// base; the other becomes the accent.
//
// Each region then gets its own brightness reference (the 90th percentile
// brightness of its pixels) so the recolored output preserves the
// region-relative stitch texture. The final color of each pixel is the
// target color × (pixel_brightness / region_reference_brightness).
//
// Anti-aliased edge pixels (brightness < the solid threshold but >= the
// background threshold) are also assigned to whichever cluster center they
// are closer to in RGB; this gives a clean boundary in the output between
// the two recolored regions.

const SOLID_THRESHOLD = 80; // br >= this counts as a "solid" stitch pixel
const BG_THRESHOLD = 25;    // br < this counts as background, fully transparent

function sq(x: number): number {
  return x * x;
}

/**
 * Recolor a PNG buffer with two distinct target colors, one for each region
 * the classifier finds. Returns a new PNG buffer.
 */
export async function recolorPngTwoRegion(
  input: Buffer,
  targetBase: RGB,
  targetAccent: RGB,
  anchorBase: RGB,
): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixelCount = width * height;

  // Pass 1 — compute per-pixel brightness and find brightness extremes
  // among solid pixels (used to seed the k-means centers).
  const brightness = new Uint8Array(pixelCount);
  let minSolidIdx = -1;
  let maxSolidIdx = -1;
  let minSolidBr = 256;
  let maxSolidBr = -1;
  let solidCount = 0;

  for (let p = 0; p < pixelCount; p++) {
    const off = p * 4;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    const br = r > g ? (r > b ? r : b) : g > b ? g : b;
    brightness[p] = br;
    if (br >= SOLID_THRESHOLD) {
      solidCount++;
      if (br < minSolidBr) {
        minSolidBr = br;
        minSolidIdx = p;
      }
      if (br > maxSolidBr) {
        maxSolidBr = br;
        maxSolidIdx = p;
      }
    }
  }

  // If there's not enough data to cluster reliably, fall back to a single-
  // color recolor using the base target. This shouldn't happen for any of
  // our configured multi-color designs, but it's a safe default.
  if (solidCount < 100 || minSolidIdx < 0 || maxSolidIdx < 0) {
    return recolorPng(input, targetBase);
  }

  // Pass 2 — k-means with k=2 on solid pixels.
  const c0Init = data.subarray(minSolidIdx * 4, minSolidIdx * 4 + 3);
  const c1Init = data.subarray(maxSolidIdx * 4, maxSolidIdx * 4 + 3);
  let c0R = c0Init[0];
  let c0G = c0Init[1];
  let c0B = c0Init[2];
  let c1R = c1Init[0];
  let c1G = c1Init[1];
  let c1B = c1Init[2];

  for (let iter = 0; iter < 15; iter++) {
    let s0R = 0;
    let s0G = 0;
    let s0B = 0;
    let n0 = 0;
    let s1R = 0;
    let s1G = 0;
    let s1B = 0;
    let n1 = 0;

    for (let p = 0; p < pixelCount; p++) {
      if (brightness[p] < SOLID_THRESHOLD) continue;
      const off = p * 4;
      const r = data[off];
      const g = data[off + 1];
      const b = data[off + 2];
      const d0 = sq(r - c0R) + sq(g - c0G) + sq(b - c0B);
      const d1 = sq(r - c1R) + sq(g - c1G) + sq(b - c1B);
      if (d0 <= d1) {
        s0R += r;
        s0G += g;
        s0B += b;
        n0++;
      } else {
        s1R += r;
        s1G += g;
        s1B += b;
        n1++;
      }
    }

    const new0R = n0 > 0 ? s0R / n0 : c0R;
    const new0G = n0 > 0 ? s0G / n0 : c0G;
    const new0B = n0 > 0 ? s0B / n0 : c0B;
    const new1R = n1 > 0 ? s1R / n1 : c1R;
    const new1G = n1 > 0 ? s1G / n1 : c1G;
    const new1B = n1 > 0 ? s1B / n1 : c1B;

    const moved =
      Math.abs(new0R - c0R) +
      Math.abs(new0G - c0G) +
      Math.abs(new0B - c0B) +
      Math.abs(new1R - c1R) +
      Math.abs(new1G - c1G) +
      Math.abs(new1B - c1B);

    c0R = new0R;
    c0G = new0G;
    c0B = new0B;
    c1R = new1R;
    c1G = new1G;
    c1B = new1B;
    if (moved < 1) break;
  }

  // Decide which center is base vs accent by anchor proximity.
  const dAnchor0 =
    sq(c0R - anchorBase[0]) + sq(c0G - anchorBase[1]) + sq(c0B - anchorBase[2]);
  const dAnchor1 =
    sq(c1R - anchorBase[0]) + sq(c1G - anchorBase[1]) + sq(c1B - anchorBase[2]);
  const baseIsZero = dAnchor0 <= dAnchor1;
  const baseR = baseIsZero ? c0R : c1R;
  const baseG = baseIsZero ? c0G : c1G;
  const baseB = baseIsZero ? c0B : c1B;
  const accR = baseIsZero ? c1R : c0R;
  const accG = baseIsZero ? c1G : c0G;
  const accB = baseIsZero ? c1B : c0B;

  // Pass 3 — classify every non-bg pixel by nearest center, building per-
  // region brightness histograms for the percentile reference. Region tag:
  // 0 = bg, 1 = base, 2 = accent.
  const region = new Uint8Array(pixelCount);
  const baseHist = new Uint32Array(256);
  const accentHist = new Uint32Array(256);
  let baseN = 0;
  let accentN = 0;

  for (let p = 0; p < pixelCount; p++) {
    const br = brightness[p];
    if (br < BG_THRESHOLD) continue;
    const off = p * 4;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    const dBase = sq(r - baseR) + sq(g - baseG) + sq(b - baseB);
    const dAcc = sq(r - accR) + sq(g - accG) + sq(b - accB);
    if (dBase <= dAcc) {
      region[p] = 1;
      baseHist[br]++;
      baseN++;
    } else {
      region[p] = 2;
      accentHist[br]++;
      accentN++;
    }
  }

  function p90(hist: Uint32Array, count: number): number {
    if (count < 100) return 220;
    const target = Math.floor(count * 0.9);
    let cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= target) return v < 100 ? 100 : v;
    }
    return 220;
  }

  const baseRef = p90(baseHist, baseN);
  const accentRef = p90(accentHist, accentN);
  const invBaseRef = 1 / baseRef;
  const invAccentRef = 1 / accentRef;

  // Pass 4 — write the output buffer.
  const out = Buffer.allocUnsafe(pixelCount * 4);
  const tbR = targetBase[0];
  const tbG = targetBase[1];
  const tbB = targetBase[2];
  const taR = targetAccent[0];
  const taG = targetAccent[1];
  const taB = targetAccent[2];
  // Each region gets its own shadow strength based on its own target's
  // luminance. So in a Bandana with base=white and accent=black, the white
  // body uses a low shadow strength (stays clearly white) while the black
  // pattern uses full multiplicative behavior (natural shadow depth).
  const shadowStrengthBase = shadowStrengthFor(targetBase);
  const shadowStrengthAccent = shadowStrengthFor(targetAccent);

  for (let p = 0; p < pixelCount; p++) {
    const off = p * 4;
    const br = brightness[p];
    const tag = region[p];

    if (tag === 0) {
      out[off] = 0;
      out[off + 1] = 0;
      out[off + 2] = 0;
      out[off + 3] = 0;
      continue;
    }

    let tR: number;
    let tG: number;
    let tB: number;
    let invRef: number;
    let shadowStrength: number;
    if (tag === 1) {
      tR = tbR;
      tG = tbG;
      tB = tbB;
      invRef = invBaseRef;
      shadowStrength = shadowStrengthBase;
    } else {
      tR = taR;
      tG = taG;
      tB = taB;
      invRef = invAccentRef;
      shadowStrength = shadowStrengthAccent;
    }

    let rawFactor = br * invRef;
    if (rawFactor > 1.2) rawFactor = 1.2;
    const factor = 1 - shadowStrength * (1 - rawFactor);
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
