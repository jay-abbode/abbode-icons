import { getIconCatalog } from "./sheets";
import { loadVisualDescriptions } from "./visualIndex";

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

/**
 * Curate `count` icons for `theme` from the live catalog.
 * Throws with a clear message if the API key is missing or the model errors.
 */
export async function selectIconsForTheme(
  theme: string,
  count: number
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
  const pool = catalog.icons.filter(
    (i) => i.status.toUpperCase() === "ACTIVE" && i.pngFileId
  );

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
            text: `THEME: ${cleanTheme}\nN: ${n}\n\nReturn a JSON array of up to ${n} id numbers that genuinely fit the theme — fewer is completely fine, most relevant first.`,
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

  // Validate ids against the pool, dedupe, and preserve Claude's ordering.
  const seen = new Set<number>();
  const icons: SheetIcon[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id >= pool.length || seen.has(id)) continue;
    seen.add(id);
    const icon = pool[id];
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

  const note =
    icons.length < n
      ? `Only ${icons.length} strong match${
          icons.length === 1 ? "" : "es"
        } for "${cleanTheme}" — add a few manually or reword the theme to reach ${n}.`
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
