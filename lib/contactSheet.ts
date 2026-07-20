import { getIconCatalog } from "./sheets";
import { loadVisualDescriptions } from "./visualIndex";
import { isPremadeCategory } from "./categories";

/**
 * Contact-sheet icon curation.
 *
 * Given a free-text THEME ("New England Autumn", "Soccer", "Coastal Grandma"…)
 * and a desired COUNT, we ask Claude to pick the icons from the live catalog
 * that best evoke that theme, as a human merchandiser would. This is deliberately
 * *reasoning-based* rather than a tag filter: the catalog's Tags column is passed
 * along as a hint, but Claude curates associatively (a place pulls in its food,
 * landmarks and culture; a season pulls in its weather, activities and mood).
 *
 * The model only ever returns catalog slugs, which we validate back against the
 * catalog before rendering — so a hallucinated slug can never reach the sheet.
 */

/** A single icon chosen for a sheet — everything the renderer needs. */
export interface SheetIcon {
  slug: string;
  name: string;
  category: string;
  /** Drive file ID; the client renders it via /api/image/<pngFileId>. */
  pngFileId: string;
}

export interface SheetSelection {
  theme: string;
  requested: number;
  icons: SheetIcon[];
  /** Set when we returned fewer icons than requested (narrow theme). */
  note: string | null;
}

// Sonnet handles the nuance this task needs: honoring exclusions ("no cats"),
// inferring material and appearance (metal, wood, stripes) from an icon's name,
// and exercising restraint instead of padding weak matches. The request is
// small (~6k tokens), so the cost stays a fraction of a cent per sheet.
const MATCH_MODEL = "claude-sonnet-5";

const MAX_COUNT = 40;

const SYSTEM_PROMPT = `You are a design curator for Abbode, an embroidery brand. You build themed "contact sheets": a small, tasteful set of icons that fit a theme.

A theme can be anything — a place, a season, an activity, an aesthetic, a color, a MATERIAL (wood, metal, ceramic, leather…), or a visual PATTERN (stripes, plaid, floral, polka-dot…).

You are given a THEME, a target number N, and the CATALOG. Each catalog line is:
  id  name  (category) — visual description

The visual description (after the em-dash, when present) is what the icon ACTUALLY looks like: its subject, material, colors, and any surface pattern. TRUST IT — it is the source of truth for material, color, and pattern themes. For example, only icons whose description mentions stripes should match "stripes"; a chair or a swimsuit described as "striped" IS a match, while an icon with no stripes is not. Where a description is missing, fall back to the name and what it most likely looks like (a horseshoe is metal, a canoe is wood).

Rules, in priority order:
- Return ONLY a JSON array of the id numbers, most relevant first. No prose, no markdown, no code fences. Example: [12, 3, 87]
- Use only ids that appear in the catalog. Never invent one.
- PRECISION BEATS QUANTITY. Only include icons that genuinely fit the theme. Aim for N, but NEVER pad the list with weak, generic, or tenuous matches just to reach it — returning far fewer strong matches (even 2 or 3) is much better than filling with junk.
- HONOR EXCLUSIONS. If the theme rules something out ("no cats", "not letters", "without red"), never include anything matching it.
- AVOID ALPHABET ICONS. Single letters and monogram/alphabet sets (categories like Plaid Letters, Cheetah Letters, Cross Stitch, Bandana letters, or any name that is essentially one letter) are a large, generic part of the catalog. Leave them out UNLESS the theme is explicitly about letters, monograms, or initials.
- Favor recognizable, on-theme picks with visual variety over near-duplicates.`;

/** Clamp/normalize a requested count to a sane range. */
export function normalizeCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(MAX_COUNT, n));
}

/** Normalize an optional positive-integer color cap; anything else → null. */
function normalizeCap(raw: number | null | undefined): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : null;
}

/**
 * Curate `count` icons for `theme` from the live catalog.
 * Throws with a clear message if the API key is missing or the model errors.
 */
/** The optional color constraints a sheet can be generated under. */
export interface ColorCaps {
  /** Most thread SLOTS any single icon may use (its own color count). */
  maxPerIcon?: number | null;
  /** Most DISTINCT colors the whole sheet may use — the union of all picks. */
  maxPerSheet?: number | null;
  /** Fixed set of thread slots the sheet may draw from; an icon qualifies only
   *  if every color it uses is in this set. Empty/undefined = no palette limit. */
  palette?: number[] | null;
}

export async function selectIconsForTheme(
  theme: string,
  count: number,
  caps: ColorCaps = {}
): Promise<SheetSelection> {
  const cleanTheme = theme.trim();
  if (!cleanTheme) throw new Error("Please enter a theme.");
  const n = normalizeCount(count);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy."
    );
  }

  const catalog = await getIconCatalog();

  // Only active designs that actually have a rendered PNG can go on a sheet.
  // Premade Designs are finished, fixed-size products — they're never used as
  // building blocks on a curated contact sheet, so they're excluded from the
  // pool the model picks from.
  let pool = catalog.icons.filter(
    (i) =>
      i.status.toUpperCase() === "ACTIVE" &&
      i.pngFileId &&
      !isPremadeCategory(i.category)
  );

  // Two independent color caps (both optional):
  //   • maxPerIcon  — the most thread SLOTS any single icon may use.
  //   • maxPerSheet — the most DISTINCT colors the whole sheet may use, i.e.
  //                   the size of the union of every pick's thread slots.
  // `threadSlots` is a design's DISTINCT Madeira spools (parseThreadSlots
  // dedupes), so its length is that icon's color count. Icons with no recorded
  // thread colors can't be confirmed against either cap, so they're excluded
  // while a cap is active.
  const perIcon = normalizeCap(caps.maxPerIcon);
  const perSheet = normalizeCap(caps.maxPerSheet);
  // Optional fixed palette: the specific thread slots the sheet may draw from.
  const paletteSet =
    Array.isArray(caps.palette) && caps.palette.length
      ? new Set(caps.palette.filter((s) => Number.isInteger(s)))
      : null;

  if (perIcon != null || perSheet != null || paletteSet != null) {
    // Every constraint needs a known color count — drop icons with a blank cell.
    pool = pool.filter((i) => i.threadSlots.length > 0);

    // Fixed palette: an icon qualifies only if EVERY color it uses is in the
    // palette (i.e. it can be stitched with just those threads).
    if (paletteSet != null) {
      pool = pool.filter((i) => i.threadSlots.every((s) => paletteSet.has(s)));
    }

    // Per-icon cap — and the per-sheet cap's single-icon floor — bound how many
    // slots one design may use. The effective ceiling is the smaller of the two.
    const limit = Math.min(perIcon ?? Infinity, perSheet ?? Infinity);
    if (limit !== Infinity) {
      pool = pool.filter((i) => i.threadSlots.length <= limit);
    }

    if (pool.length === 0) {
      const reason =
        paletteSet != null
          ? "use only the selected palette colors"
          : `use ${limit} color${limit === 1 ? "" : "s"} or fewer`;
      throw new Error(
        `No active icons ${reason} (with recorded thread colors). Adjust the color limits or palette, or set them to Any.`
      );
    }
  }

  // Per-icon visual descriptions (subject, material, colors, pattern) from the
  // one-time vision pass in scripts/caption-icons.mjs. Empty until that script
  // has been run — matching still works on name + category alone in that case.
  const visual = await loadVisualDescriptions();

  // Compact, index-keyed lines: `id  name  (category) — visual description`.
  // Tags are intentionally left out (they were derived from name + category);
  // the visual description is the new signal that makes material / color /
  // pattern themes actually work.
  const catalogText = pool
    .map((icon, idx) => {
      const desc = icon.pngFileId ? visual.get(icon.pngFileId) : undefined;
      return `${idx} ${icon.name} (${icon.category})${desc ? " — " + desc : ""}`;
    })
    .join("\n");

  // When a per-sheet color budget is active, some relevant picks get dropped for
  // using colors that don't fit the running budget — so ask Claude for a deeper
  // ranked list to choose from. We still return at most `n`.
  const candidateN =
    perSheet != null ? Math.min(MAX_COUNT, Math.max(n, n * 2)) : n;

  // The catalog is the same on every request, so it's sent as its own cached
  // block: repeat generations within ~5 minutes reuse it (cheaper + faster).
  const requestBody = {
    model: MATCH_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `CATALOG (id  name  (category)):\n${catalogText}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `THEME: ${cleanTheme}\nN: ${n}\n\nReturn a JSON array of up to ${candidateN} id numbers that genuinely fit the theme, most relevant first — fewer is completely fine. I'll use the top ${n}.`,
          },
        ],
      },
    ],
  };

  const data = await callClaude(apiKey, requestBody);
  const text = (data.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  const ids = parseIndexArray(text);

  // Walk Claude's ranked ids, validate + dedupe, and (when a per-sheet cap is
  // set) greedily enforce the sheet-wide color budget: an icon is added only if
  // it keeps the union of all picked colors within maxPerSheet. Going in
  // relevance order means the strongest matches claim the budget first; later
  // picks that reuse those colors cost nothing and still get in.
  const seen = new Set<number>();
  const icons: SheetIcon[] = [];
  const sheetColors = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id >= pool.length || seen.has(id)) continue;
    seen.add(id);
    const icon = pool[id];
    if (perSheet != null) {
      const merged = new Set(sheetColors);
      for (const s of icon.threadSlots) merged.add(s);
      if (merged.size > perSheet) continue; // would blow the sheet budget — skip
      for (const s of icon.threadSlots) sheetColors.add(s);
    }
    icons.push({
      slug: icon.slug,
      name: icon.name,
      category: icon.category,
      pngFileId: icon.pngFileId as string,
    });
    if (icons.length >= n) break;
  }

  if (icons.length === 0) {
    throw new Error(
      "Couldn't find matching icons for that theme. Try rewording it or lowering the count."
    );
  }

  const capParts: string[] = [];
  if (perIcon != null) capParts.push(`${perIcon}/icon`);
  if (perSheet != null) capParts.push(`${perSheet}/sheet`);
  if (paletteSet != null) capParts.push(`${paletteSet.size}-color palette`);
  const capNote = capParts.length
    ? ` within your color limits (${capParts.join(", ")})`
    : "";
  const note =
    icons.length < n
      ? `Only ${icons.length} strong match${
          icons.length === 1 ? "" : "es"
        } for "${cleanTheme}"${capNote} — add a few manually${
          capParts.length ? ", raise the color limits," : ""
        } or reword the theme to reach ${n}.`
      : null;

  return { theme: cleanTheme, requested: n, icons, note };
}

/**
 * Pull the JSON id-number array out of the model's reply. We ask for a bare
 * array, but this is defensive against stray prose, a code fence, or ids that
 * come back as quoted strings.
 */
function parseIndexArray(text: string): number[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) =>
        typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN
      )
      .filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

/**
 * POST to Claude's Messages API. On a 429 rate-limit we retry once after a
 * short wait (honoring Retry-After when it's small); otherwise we surface a
 * clean, actionable message instead of the raw API error body.
 */
async function callClaude(
  apiKey: string,
  body: unknown
): Promise<{ content?: Array<{ type: string; text?: string }> }> {
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 6;
      if (attempt < MAX_ATTEMPTS && waitS <= 12) {
        await new Promise((r) => setTimeout(r, waitS * 1000));
        continue;
      }
      throw new Error(
        `Claude is rate-limited right now. Wait about ${Math.ceil(
          waitS
        )}s and hit Generate again. To raise the ceiling, add credits at console.anthropic.com → Billing (that bumps your usage tier and the per-minute limit).`
      );
    }

    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error (${res.status}). ${errText.slice(0, 200)}`.trim());
  }
  throw new Error("Claude request failed."); // unreachable; satisfies the type checker
}
