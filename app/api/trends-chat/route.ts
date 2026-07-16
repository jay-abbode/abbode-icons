import { NextResponse } from "next/server";
import { getProductTrends, EMPTY_PRODUCT_TRENDS, baseProduct } from "@/lib/productTrends";

export const dynamic = "force-dynamic";

/**
 * POST /api/trends-chat — "Ask about this data" on /reports/trends.
 *
 * Grounds Claude in a condensed snapshot of the TRENDS_* tabs (the same data the
 * page renders) and answers forecasting questions: what's popular, what's moving,
 * what to reorder. Needs ANTHROPIC_API_KEY set in the environment (Vercel →
 * Settings → Environment Variables); until then it returns { error: "not_configured" }.
 * The site-wide auth middleware already gates this route to signed-in users.
 */

function condense(t: Awaited<ReturnType<typeof getProductTrends>>) {
  // Per-product totals + monthly series from the categories tab (true volume).
  const prod = new Map<string, { units: number; web: number; pos: number; byMonth: Record<string, number> }>();
  for (const r of t.categories) {
    const label = baseProduct(r.category);
    if (!label || label === "Unspecified") continue;
    const p = prod.get(label) || { units: 0, web: 0, pos: 0, byMonth: {} };
    p.units += r.units;
    p[r.channel] += r.units;
    p.byMonth[r.month] = (p.byMonth[r.month] || 0) + r.units;
    prod.set(label, p);
  }
  // Colors overall and per product+color.
  const color = new Map<string, { units: number; byMonth: Record<string, number> }>();
  const pairs = new Map<string, number>();
  for (const r of t.colors) {
    const c = r.color.trim();
    if (!c) continue;
    const e = color.get(c) || { units: 0, byMonth: {} };
    e.units += r.units;
    e.byMonth[r.month] = (e.byMonth[r.month] || 0) + r.units;
    color.set(c, e);
    const label = baseProduct(r.product) || "Unspecified";
    if (label === "Unspecified") { color.set(c, color.get(c)!); }
    const k = `${label} · ${c}`;
    pairs.set(k, (pairs.get(k) || 0) + r.units);
  }
  const top = <T,>(m: Map<string, T>, val: (x: T) => number, n: number) =>
    [...m.entries()].sort((a, b) => val(b[1]) - val(a[1])).slice(0, n);

  return {
    coverage: t.coverage || "unknown",
    updatedAt: t.updatedAt || "unknown",
    months: t.months,
    monthlyOrders: t.timeseries.map((r) => ({
      month: r.month,
      channel: r.channel,
      orders: r.orders,
      units: r.units,
    })),
    products: top(prod, (x) => x.units, 30).map(([label, x]) => ({ product: label, ...x })),
    colors: top(color, (x) => x.units, 25).map(([label, x]) => ({ color: label, ...x })),
    productColors: top(pairs, (x) => x, 60).map(([k, units]) => ({ pair: k, units })),
  };
}

const SYSTEM = `You are the forecasting assistant inside the Product Trends dashboard of Abbode, an embroidery brand selling customizable pouches, totes, charms and similar goods. You are given a JSON snapshot of their real order data: monthly order volume by channel ("web" = online store, "pos" = in-store), per-product units and monthly series, garment-color picks overall and per product ("productColors" pairs), plus data coverage.

Rules:
- Ground every claim in the JSON. Use real product and color names with real numbers. Never invent data.
- If the question can't be answered from the snapshot, say so plainly and say what data would answer it.
- If coverage indicates a short window (e.g. ~60 days), say seasonal/year-over-year reads are limited when relevant.
- When asked what to order or stock, give a concrete, ranked suggestion based on volume and month-over-month movement, and note it's directional, not gospel.
- "pos" means in-store; note that in-store data is intentionally sparse in this pipeline.
- Reply as plain conversational text: no markdown symbols, no headers, no bullet characters. Keep it to a few sentences, or a short numbered list written inline if genuinely needed.`;

export async function POST(req: Request) {
  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question || "").slice(0, 500).trim();
  } catch {
    /* fall through to empty check */
  }
  if (!question) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "not_configured" });
  }

  const t = await getProductTrends().catch(() => EMPTY_PRODUCT_TRENDS);
  const data = condense(t);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `DATA (JSON):\n${JSON.stringify(data)}\n\nQUESTION: ${question}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return NextResponse.json({ error: "api_error", detail }, { status: 502 });
    }

    const out = await res.json();
    const answer = Array.isArray(out?.content)
      ? out.content
          .filter((c: { type?: string }) => c?.type === "text")
          .map((c: { text?: string }) => c.text || "")
          .join("\n")
          .trim()
      : "";
    if (!answer) {
      return NextResponse.json({ error: "api_error", detail: "empty response" }, { status: 502 });
    }
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ error: "api_error", detail: "request failed" }, { status: 502 });
  }
}
