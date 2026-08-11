#!/usr/bin/env python3
"""
webster_queue.py — write the WEBSTER_QUEUE tab the routing page reads.

Pulls every OPEN Shopify order tagged `webster-live`, derives each line's
thread-color set with the SAME pipeline icon_order_stats.py runs (imported,
not copied — one derivation, zero drift), and rewrites the WEBSTER_QUEUE tab:

  Batch | Order | Order Id | Created At | Line | Qty | Product | Variant |
  Icons | Text | Text Color | Slots | Flag | Preview | Updated

One row per order line with WORK REMAINING: `Qty` is the line's UNFULFILLED
quantity, lines fully fulfilled are dropped, and an order with nothing left to
stitch is dropped entirely — so a fresh run shrinks the queue as Webster
fulfills. `Batch` is the order's created DATE in --batch-tz (default
America/New_York). `Slots` is the design's color set ("20; 35; 8"). `Flag`
marks lines the router must send to review instead of trusting the colors:

  photo          Pet Portrait / photo-stitch products (colors come from the
                 photo, not the palette)
  no-attributes  line has no customizer attributes at all
  no-color       attributes present but nothing resolved to a palette color
  unmatched: X   an icon name the matcher couldn't place — colors incomplete

Lines that are never embroidered (insurance, gift cards, fees, samples, …)
are dropped entirely by the shared noise filter.

The app (/machines/routing) reads this tab plus the active thread config and
assigns every order to a room. Run this any time for a fresh queue; the
GitHub Action (webster-queue.yml) runs it on a schedule.

Requires the same env/flags as icon_order_stats.py:
  GOOGLE_SHEET_ID, SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET,
  and a service-account google-credentials.json with EDIT access.

Dry run first:
  python webster_queue.py --dry-run
Then for real:
  python webster_queue.py
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from googleapiclient.discovery import build

# The canonical derivation lives in icon_order_stats.py — import it rather than
# copying, so an alias/override/noise-rule change there is instantly law here.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "icon_order_stats"))
import icon_order_stats as ios  # noqa: E402

QUEUE_TAB = "WEBSTER_QUEUE"
TAG = "webster-live"
BATCH_TZ_DEFAULT = "America/New_York"
LOOKBACK_DAYS_DEFAULT = 30  # open orders older than this are stale enough to skip

HEADER = ["Batch", "Order", "Order Id", "Created At", "Line", "Qty", "Product",
          "Variant", "Icons", "Text", "Text Color", "Slots", "Flag", "Preview", "Updated"]

# Photo-stitch products: the design's colors come from the uploaded photo, not
# the 24-spool palette, so routing on derived colors would be fiction.
PHOTO_SUBSTR = ("pet-portrait", "pet portrait", "photo-stitch", "photo stitch")

# Line-level noise the shared filter can't see (it only checks sku + handle):
# Checkout+ / order-protection upsells sometimes ship with a bare title.
TITLE_NOISE_SUBSTR = ("checkout+", "checkout plus", "shipping protection",
                      "package protection", "order protection", "route insurance")

TEXT_KEYS = ("text", "text-one", "text-two", "monogram")

ORDERS_QUERY = """
query($q: String!, $after: String) {
  orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      name
      createdAt
      cancelledAt
      displayFulfillmentStatus
      lineItems(first: 20) { edges { node {
        sku
        title
        quantity
        unfulfilledQuantity
        variantTitle
        customAttributes { key value }
        variant { product { id handle title } }
      } } }
    } }
  }
}
"""


def fetch_open_orders(shop, token, days, limit=None):
    """All open, unfulfilled `webster-live` orders from the last `days` days,
    newest first. Filters again client-side on status so a search-syntax quirk
    can only ever over-fetch, never mis-include."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    url = f"https://{shop}.myshopify.com/admin/api/{ios.API_VERSION}/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    q = f"tag:{TAG} AND status:open AND fulfillment_status:unfulfilled AND created_at:>={cutoff}"

    out, after = [], None
    while True:
        resp = None
        for attempt in range(5):
            resp = requests.post(url, headers=headers,
                                 json={"query": ORDERS_QUERY, "variables": {"q": q, "after": after}})
            if resp.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            resp.raise_for_status()
            break
        data = resp.json()
        if "errors" in data:
            sys.exit(f"Shopify error: {data['errors']}")
        block = data["data"]["orders"]
        for edge in block["edges"]:
            node = edge["node"]
            if node.get("cancelledAt"):
                continue
            if (node.get("displayFulfillmentStatus") or "").upper() == "FULFILLED":
                continue
            out.append(node)
            if limit and len(out) >= limit:
                return out
        if not block["pageInfo"]["hasNextPage"]:
            return out
        after = block["pageInfo"]["endCursor"]
        time.sleep(0.3)


def batch_date(created_at_iso, tz):
    """The order's created DATE in the batch timezone — the 3PL's batch key."""
    dt = datetime.fromisoformat((created_at_iso or "").replace("Z", "+00:00"))
    return dt.astimezone(tz).date().isoformat()


def is_photo(handle, title):
    blob = f"{(handle or '').lower()} {(title or '').lower()}"
    return any(s in blob for s in PHOTO_SUBSTR)


def title_is_noise(title):
    t = (title or "").lower()
    return any(s in t for s in TITLE_NOISE_SUBSTR)


# The 24 production spool colors, keyed by lowercase name — newer customizer
# templates store `color-text-one` as a bare name ("Royal Blue") with no slot
# number, which parse_color_slot alone can't place. The customizer's display
# names differ from the Python palette's Madeira-ish names for seven colors,
# so both naming systems resolve (source of the customizer names:
# lib/threadPalette.ts — the same 24 slots).
CUSTOMIZER_SYNONYMS = {
    "red": 1,          # palette: Dark Red
    "rust": 4,         # palette: Rust Orange
    "olive": 10,       # palette: Olive Green
    "matcha": 13,      # palette: Matcha Green
    "light blue": 17,  # palette: Cool Periwinkle
    "royal blue": 19,  # palette: Dark Royal
    "pink": 27,        # palette: Dusty Pink
}
NAME_TO_SLOT = {
    **{name.lower(): slot for slot, name in ios.PALETTE.items()},
    **CUSTOMIZER_SYNONYMS,
}

TEXT_COLOR_KEYS = ("color-text-one", "font_color")


def resolve_text_slot(attrs, croc, has_text):
    """The monogram thread slot, from whichever key/format this template
    generation used: numbered values ("20 — Navy"), bare names ("Royal Blue"),
    and — only on lines that actually carry text — the plain `color` key.
    (`color` can also mean an item colorway, so icon-only lines never consult
    it.) Croc's White→Tusk swap applies on every path."""
    keys = TEXT_COLOR_KEYS + (("color",) if has_text else ())
    for key in keys:
        raw = (attrs.get(key) or "").strip()
        if not raw:
            continue
        slot = ios.parse_color_slot(raw, croc)
        if slot is None:
            _num, name = ios.split_color(raw)
            if name:
                cand = NAME_TO_SLOT.get(name.lower())
                if cand is not None:
                    adjusted = ios.adjust_slots([cand], croc)
                    slot = adjusted[0] if adjusted else None
        if slot is not None:
            return slot
    return None


def derive_line(li, matcher, catalog):
    """One order line -> a queue row dict, or None when the line is pure noise.
    Color derivation is byte-for-byte the stats pipeline: OVERRIDES / aliases /
    fuzzy matching, catalog slots, croc White->Tusk, retired slots dropped."""
    sku = li.get("sku")
    variant = li.get("variant") or {}
    product = variant.get("product") or {}
    handle = product.get("handle")
    title = (li.get("title") or product.get("title") or "").strip()

    if ios.line_is_noise(sku, handle) or title_is_noise(title):
        return None

    # Only what's left to stitch: fully fulfilled lines drop out of the queue.
    unfulfilled = li.get("unfulfilledQuantity")
    qty = int(unfulfilled if unfulfilled is not None else (li.get("quantity") or 1))
    if qty <= 0:
        return None

    attrs = {a["key"]: a["value"] for a in (li.get("customAttributes") or [])}
    # Underscore keys (_template_id, _gid, _images, …) are customizer plumbing,
    # not customization — a line with only those has no attributes that matter.
    meaningful = {k for k in attrs if not k.startswith("_")}
    croc = ios.is_croc(sku, handle)

    text = " / ".join(dict.fromkeys(
        v.strip() for k in TEXT_KEYS if (v := (attrs.get(k) or "")).strip()
    ))

    icons, slots, unmatched = [], [], []
    flag = ""

    if is_photo(handle, title):
        flag = "photo"
    else:
        # `icon` (singular) is the newer template generation's key.
        for key in ("icon", "icon-one", "icon-two", "icon-three"):
            name = (attrs.get(key) or "").strip()
            if not name:
                continue
            canon, how = matcher.match(name)
            if not canon:
                if how != "ignored":
                    unmatched.append(name)
                continue
            if canon in icons:
                continue
            icons.append(canon)
            s, _cat = ios.catalog_slots_for(canon, catalog)
            slots.extend(ios.adjust_slots(s, croc))

        tslot = resolve_text_slot(attrs, croc, bool(text))
        if tslot is not None:
            slots.append(tslot)

        if unmatched:
            flag = "unmatched: " + ", ".join(unmatched)
        elif not meaningful:
            flag = "no-attributes"
        elif not slots:
            flag = "no-color"

    # Customer-facing text color NAME for the pick sheet (the slot number alone
    # means nothing to an embroiderer reading a printout).
    color_name = ""
    for key in ("color-text-one", "font_color", "color"):
        raw = (attrs.get(key) or "").strip()
        if raw:
            _num, name = ios.split_color(raw)
            color_name = name or ios.PALETTE.get(ios.parse_color_slot(raw, croc) or -1, "") or raw
            break

    return {
        "qty": qty,
        "product": title,
        "variant": (li.get("variantTitle") or "").strip(),
        "icons": ", ".join(icons),
        "text": text,
        "text_color": color_name,
        "slots": sorted(set(slots)),
        "flag": flag,
        "preview": line_preview(attrs),
    }


def line_preview(attrs):
    """Best available proof link: _screenshot, else the first _images entry
    (a JSON array on newer templates), else the _preview_pdf page."""
    shot = (attrs.get("_screenshot") or "").strip()
    if shot:
        return shot
    raw = (attrs.get("_images") or "").strip()
    if raw:
        try:
            imgs = json.loads(raw)
            if isinstance(imgs, list) and imgs and str(imgs[0]).strip():
                return str(imgs[0]).strip()
        except (ValueError, TypeError):
            pass
    return (attrs.get("_preview_pdf") or "").strip()


def order_sort_key(name):
    digits = "".join(ch for ch in (name or "") if ch.isdigit())
    return (int(digits) if digits else 0, name or "")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--shop", default=os.environ.get("SHOPIFY_SHOP"))
    p.add_argument("--client-id", default=os.environ.get("SHOPIFY_CLIENT_ID"))
    p.add_argument("--client-secret", default=os.environ.get("SHOPIFY_CLIENT_SECRET"))
    p.add_argument("--creds", type=Path, default=ios.DEFAULT_CREDS)
    p.add_argument("--days", type=int, default=LOOKBACK_DAYS_DEFAULT,
                   help="how far back to look for open orders (default 30)")
    p.add_argument("--batch-tz", default=os.environ.get("WEBSTER_BATCH_TZ", BATCH_TZ_DEFAULT),
                   help="timezone whose calendar date defines a batch (default America/New_York)")
    p.add_argument("--limit", type=int, default=None, help="cap orders pulled (testing)")
    p.add_argument("--dry-run", action="store_true", help="don't write the tab; print a preview")
    args = p.parse_args()

    for need, val in [("GOOGLE_SHEET_ID", args.sheet_id), ("SHOPIFY_SHOP", args.shop),
                      ("SHOPIFY_CLIENT_ID", args.client_id),
                      ("SHOPIFY_CLIENT_SECRET", args.client_secret)]:
        if not val:
            sys.exit(f"ERROR: {need} not set (env or flag).")

    tz = ZoneInfo(args.batch_tz)
    shop = ios.normalize_shop(args.shop)
    creds = ios.load_creds(args.creds)
    sheets = build("sheets", "v4", credentials=creds)

    print("Reading catalog + aliases...")
    catalog = ios.read_catalog(sheets, args.sheet_id)
    aliases = ios.read_aliases(sheets, args.sheet_id)
    matcher = ios.Matcher(catalog, aliases)
    print(f"  {len(catalog)} icons, {len(aliases)} alias-tab entries")

    print(f"Getting a Shopify access token for {shop}.myshopify.com ...")
    token = ios.get_access_token(shop, args.client_id, args.client_secret)

    print(f"Pulling open `{TAG}` orders (last {args.days} days)...")
    orders = fetch_open_orders(shop, token, args.days, args.limit)
    print(f"  {len(orders)} open orders")

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows, per_batch = [], {}
    for node in orders:
        name = node.get("name") or ""
        batch = batch_date(node.get("createdAt"), tz)
        lines = []
        for i, li_edge in enumerate(node["lineItems"]["edges"], start=1):
            d = derive_line(li_edge["node"], matcher, catalog)
            if d is None:
                continue
            lines.append((i, d))
        if not lines:
            continue  # nothing but noise lines — not Webster's problem
        stats = per_batch.setdefault(batch, {"orders": 0, "stitchable": 0, "flagged": 0})
        stats["orders"] += 1
        if any(d["slots"] and not d["flag"] for _i, d in lines):
            stats["stitchable"] += 1
        else:
            stats["flagged"] += 1
        for i, d in lines:
            rows.append([
                batch, name, node.get("id") or "", node.get("createdAt") or "",
                str(i), str(d["qty"]), d["product"], d["variant"], d["icons"],
                d["text"], d["text_color"],
                "; ".join(str(s) for s in d["slots"]),
                d["flag"], d["preview"], now_iso,
            ])

    rows.sort(key=lambda r: (r[0], order_sort_key(r[1]), int(r[4])))

    if matcher.unmatched:
        print(f"  {len(matcher.unmatched)} UNMATCHED icon names (add to {ios.ALIAS_TAB} to fix):")
        for raw, cnt in sorted(matcher.unmatched.items(), key=lambda x: -x[1]):
            print(f"     {raw!r:32} x{cnt}")

    print(f"\nQueue: {sum(s['orders'] for s in per_batch.values())} orders, "
          f"{len(rows)} lines, {len(per_batch)} batch(es) [{args.batch_tz}]:")
    for b in sorted(per_batch, reverse=True):
        s = per_batch[b]
        print(f"  {b}: {s['orders']} orders ({s['stitchable']} stitchable, {s['flagged']} review)")

    if args.dry_run:
        print("\n--dry-run: nothing written. First 10 rows:")
        for r in rows[:10]:
            print("  " + " | ".join(r[:13]))
        return

    if not rows:
        # Keep the tab honest even when the queue is empty: header plus one
        # sentinel row (no Order value — the reader skips it) carrying Updated.
        rows = [["", "", "", "", "", "", "", "", "", "", "", "", "empty", "", now_iso]]

    n = ios._ensure_clear_update(sheets, args.sheet_id, QUEUE_TAB, [HEADER] + rows)
    print(f"\nWrote {n} rows to {QUEUE_TAB}. The routing page reflects them within ~60s.")


if __name__ == "__main__":
    main()
