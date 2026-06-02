# Live Order Data — order-stats populator

Builds the composite behind the header's **Live Order Data** dropdown: scans
Shopify orders, joins each ordered icon to the Icon List catalog (category +
thread colors), and writes an `ORDER_STATS` tab the app reads.

## What it counts

- **Window:** rolling 12 months (`--months` to change).
- **Count:** all placed orders (gross). No refund/cancel subtraction.
- **Icons:** `icon-one` / `icon-two` / `icon-three` line-item attributes.
- **Croc pouches:** White (35) is counted as Tusk (37), for text and icons.
- **Retired colors** (anything not in the 24-spool palette) are dropped.
- **Matching:** manual overrides → exact → catalog `OLD NAME` → `ICON_ALIASES`
  tab → fuzzy. Color-prefixed variants (Red Heart, Blue Cowboy Boot, Pink Claw,
  etc.) are their own entries with the thread colors you set in `OVERRIDES`.

## One-time setup

1. **Service account needs WRITE access to the sheet.** The app's service
   account is read-only today. Open the Icon List sheet → Share → give the
   service account email **Editor** (it needs to create/refresh the
   `ORDER_STATS` tab).

2. **Create a Dev Dashboard app + copy its Client ID/Secret.** As of Jan 1,
   2026 Shopify no longer shows a copyable Admin API token, so:
   - Go to **dev.shopify.com/dashboard** (same login as your store).
   - **Create app** → name it e.g. `Order Stats`.
   - Configure **Admin API** access and enable the **`read_orders`** scope.
   - **Install** it on the Abbode store.
   - Open the app's **Settings** and copy the **Client ID** and **Client secret**.
   The app and store must be in the same org (they are — you're making it in
   your own dashboard). The script trades these for a 24h token automatically.

3. **Install deps:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set env vars** (or pass as flags):
   ```bash
   export GOOGLE_SHEET_ID=...                 # same id the app uses
   export SHOPIFY_SHOP=abbode                 # your *.myshopify.com subdomain ONLY
   export SHOPIFY_CLIENT_ID=...               # from the Dev Dashboard app
   export SHOPIFY_CLIENT_SECRET=...           # from the Dev Dashboard app
   # google-credentials.json sits in the project root (same file the app uses)
   ```
   Find your `SHOPIFY_SHOP` subdomain in the store admin URL
   (`admin.shopify.com/store/<this-part>`) — it's just the name, not `.com`.

## Run

Dry run first (scans a slice, writes nothing, prints matches + anything
unmatched so you can seed the alias tab):
```bash
python icon_order_stats.py --dry-run --limit 1000
```

Full run (writes the ORDER_STATS tab; app reflects it within ~60s):
```bash
python icon_order_stats.py
```

## ICON_ALIASES tab (recommended)

Add a tab named `ICON_ALIASES` with two columns: **Customizer Name** and
**Catalog Name**. Anything the dry run lists as unmatched or fuzzy-review goes
here once and is then matched exactly forever. Example rows:

| Customizer Name | Catalog Name |
| --------------- | ------------ |
| Makup Brushes   | Makeup Brushes |
| Evil eye - small pointed one | Evil Eye |

## Keeping it "live"

The dropdown is as fresh as the last run. Options, simplest first:
- Run it manually when you want fresh numbers.
- Cron on any always-on machine: `0 6 * * * cd ... && python icon_order_stats.py`.
- Vercel Cron hitting a small protected API route that shells this logic
  (port to a Node route if you'd rather not run Python on a schedule).
