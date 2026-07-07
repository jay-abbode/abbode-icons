import { getIconCatalog } from "./sheets";

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

// Fast, cheap, and more than capable for a ranking/selection task over a few
// hundred short catalog lines. Bump to a larger model here if curation ever
// needs more nuance — nothing else has to change.
const MATCH_MODEL = "claude-haiku-4-5-20251001";

const MAX_COUNT = 40;

const SYSTEM_PROMPT = `You are a design curator for Abbode, an embroidery brand. You build themed "contact sheets": a small, tasteful set of icons that together evoke a theme — a place, a season, an activity, an aesthetic, or a vibe.

You are given a THEME, a target number N, and the full CATALOG of available icons. Each catalog line is:
  slug | name | category | tags

Pick the icons that best fit the theme, the way a thoughtful human merchandiser would.

Rules:
- Return ONLY a JSON array of slug strings, most relevant first. No prose, no markdown, no code fences.
- Use only slugs that appear in the catalog. Never invent one.
- Aim for exactly N icons. Favor strong, recognizable fits and visual variety — avoid a pile of near-duplicates unless the theme genuinely calls for it.
- Reason associatively. A place can include its food, landmarks and culture; a season its weather, activities and mood. The tags are hints, not hard filters.
- If there are fewer than N genuinely fitting icons, add the next-best related ones to reach N — but never pad with clearly-unrelated icons. Returning slightly fewer is better than including junk.`;

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
  const bySlug = new Map(pool.map((i) => [i.slug, i]));

  // One compact line per icon. Cap tags so a few very tagged icons don't
  // dominate the prompt; the first tags are the most salient anyway.
  const catalogText = pool
    .map((i) => {
      const tags = i.tags.slice(0, 12).join(", ");
      return `${i.slug} | ${i.name} | ${i.category}${tags ? " | " + tags : ""}`;
    })
    .join("\n");

  const userMessage = `THEME: ${cleanTheme}\nN: ${n}\n\nCATALOG:\n${catalogText}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MATCH_MODEL,
      max_tokens: 1024,
      temperature: 0, // reproducible: same theme + count -> same set
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Claude API error (${res.status}). ${body.slice(0, 300)}`.trim()
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (data.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  const slugs = parseSlugArray(text);

  // Validate against the catalog, dedupe, and preserve Claude's ordering.
  const seen = new Set<string>();
  const icons: SheetIcon[] = [];
  for (const slug of slugs) {
    const icon = bySlug.get(slug);
    if (!icon || seen.has(slug)) continue;
    seen.add(slug);
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
 * Pull the JSON slug array out of the model's reply. We ask for a bare array,
 * but this is defensive against stray prose or a code fence sneaking in.
 */
function parseSlugArray(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}
