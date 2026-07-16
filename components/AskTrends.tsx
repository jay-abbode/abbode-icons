"use client";

import { useState } from "react";

/**
 * "Ask about this data" — the assistant box at the bottom of /reports/trends.
 * Sends a free-form question to /api/trends-chat, which grounds Claude in the
 * same TRENDS_* data the page renders. Shows a setup hint until
 * ANTHROPIC_API_KEY is configured in Vercel.
 */

const SUGGESTIONS = [
  "What should I reorder first?",
  "Which colors are trending up?",
  "What looks seasonal so far?",
];

export default function AskTrends() {
  const [q, setQ] = useState("");
  const [askedQ, setAskedQ] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    const query = question.trim();
    if (!query || loading) return;
    setLoading(true);
    setAskedQ(query);
    setAnswer(null);
    setError(null);
    try {
      const res = await fetch("/api/trends-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: query }),
      });
      const data = await res.json().catch(() => null);
      if (data?.answer) {
        setAnswer(data.answer);
      } else if (data?.error === "not_configured") {
        setError(
          "The assistant isn't configured yet — add ANTHROPIC_API_KEY in Vercel (Settings → Environment Variables) and redeploy.",
        );
      } else {
        setError("Couldn't reach the assistant just now — try again in a moment.");
      }
    } catch {
      setError("Couldn't reach the assistant just now — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-parchment bg-white">
      <div className="border-b border-parchment/60 px-5 pb-4 pt-5">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-berry">Assistant</p>
        <h2 className="font-display mt-1 text-lg text-espresso">Ask about this data</h2>
        <p className="font-ui mt-1 text-xs text-ink-muted">
          What&rsquo;s moving, what to reorder, what a number means — answered from the trends above.
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                void ask(s);
              }}
              disabled={loading}
              className="focus-ring font-ui rounded-full border border-parchment bg-porcelain px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-pink hover:text-espresso disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {(loading || answer || error) && (
          <div className="rounded-xl border border-parchment bg-porcelain/60 px-4 py-3">
            {askedQ && <p className="font-ui text-[11px] font-semibold text-ink-muted">{askedQ}</p>}
            {loading ? (
              <p className="font-ui mt-1.5 animate-pulse text-sm text-ink-muted">Reading the numbers&hellip;</p>
            ) : error ? (
              <p className="font-ui mt-1.5 text-sm leading-relaxed text-ink-soft">{error}</p>
            ) : (
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{answer}</p>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything about these trends…"
            maxLength={500}
            className="focus-ring font-ui min-w-0 flex-1 rounded-full border border-parchment bg-white px-4 py-2 text-sm text-espresso placeholder:text-ink-muted"
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="focus-ring font-ui flex-none rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-cherry disabled:opacity-50"
          >
            {loading ? "Asking…" : "Ask"}
          </button>
        </form>

        <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
          Answers are drawn from the data on this page — directional, so sanity-check before big orders.
        </p>
      </div>
    </section>
  );
}
