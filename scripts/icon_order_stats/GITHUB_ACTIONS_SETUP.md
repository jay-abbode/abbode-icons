# Running the order-stats populator automatically

`.github/workflows/order-stats.yml` runs `icon_order_stats.py` on GitHub's
servers every **Monday at 07:00 UTC (~3am ET)**, and rewrites the `ORDER_STATS`
tab. The script itself is unchanged. Nothing is deployed to Vercel — the app
already reads the sheet live, so a fresh tab shows up in the app within ~60s.

You can also run it on demand: **Actions → Icon order stats → Run workflow**.
That button also lets you change the window (`months`) or tick `dry_run` to
preview without writing.

---

## One-time setup: five repo secrets

GitHub → the `abbode-icons` repo → **Settings → Secrets and variables →
Actions → New repository secret**. Add these five, named exactly:

| Secret | Value |
|---|---|
| `GOOGLE_SHEET_ID` | `1zP1wTjPpYxhEQ4GnF8pCLdZj1DiyoGIrwEr3VWrLbqo` |
| `GOOGLE_CREDENTIALS_JSON` | The **entire contents** of `google-credentials.json` — open it in Notepad, select all, paste. Include the outer `{` and `}`. |
| `SHOPIFY_SHOP` | The store's myshopify subdomain (the same value you pass to `--shop` when running locally) |
| `SHOPIFY_CLIENT_ID` | Dev Dashboard app → Settings → Client ID |
| `SHOPIFY_CLIENT_SECRET` | Dev Dashboard app → Settings → Client secret |

The Shopify Dev Dashboard app is the one described in the script's README — the
same Client ID / Secret you already use to run this locally. Nothing new to
create.

**Paste `GOOGLE_CREDENTIALS_JSON` raw.** Unlike Vercel, GitHub secrets take the
file exactly as-is: real newlines are fine, no `\n` escaping, no surrounding
quotes. The workflow parses it and fails loudly on the first run if it's
malformed.

---

## Check it works

1. **Actions → Icon order stats → Run workflow**, tick **dry_run**, hit Run.
2. Green check = credentials good, Shopify reachable, matching sane. It prints a
   top-20 preview and writes nothing.
3. Run it again with `dry_run` **unticked** to do the real write.
4. Confirm the `Updated` column in `ORDER_STATS` shows today.

After that it runs itself. GitHub emails you when a scheduled run fails.

---

## Two things that will bite you eventually

**Scheduled workflows get disabled after 60 days of repo inactivity.** GitHub
does this to every repo. If commits stop for two months, the cron silently stops
and you're back to stale stats with no warning. GitHub emails you before it
does. Re-enable it from the Actions tab.

**Order scope.** Shopify's Admin API only returns the **last 60 days** of orders
unless the app has the `read_all_orders` scope. The existing 12-month numbers in
`ORDER_STATS` prove the current app already has it. If you ever rebuild the Dev
Dashboard app, request `read_all_orders` again or the window silently truncates
to 60 days — the run will still go green, it'll just be wrong.

---

## Known gap in the data (worth fixing next)

`ORDER_STATS` only writes icons with **at least one order**. Icons with zero
orders are simply absent from the tab.

That's a real blind spot for cut decisions: 284 catalog icons are missing from
the tab, but only 129 are genuinely dead. The other 155 are recent additions
that hadn't been created yet when the populator last ran — "absent" and "dead"
look identical.

The fix is to emit a row for every catalog icon, zeros included, plus a
first-seen date so a new icon can't be mistaken for a dead one. That's a change
to `write_stats()` in the script — worth doing, but it needs the actual file in
front of us rather than a guess at it.
