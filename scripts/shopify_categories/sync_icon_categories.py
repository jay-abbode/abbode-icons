#!/usr/bin/env python3
"""
sync_icon_categories.py — snapshot the website's Custom Icon Categories
(Shopify metaobjects) into an ICON_CATEGORIES tab in the Icon List sheet.

Why a sync instead of the app calling Shopify: the web app deliberately holds
no Shopify token. This script (which already has one, via the same Dev
Dashboard app the order-stats script uses) writes the tab; /reports/icons/compare
reads it and compares against the 3-month order report.

Each category is a `custom_icon_categories` metaobject whose `icons` field is
an ordered list of `custom_icon_option` references; each option's `label` is
the icon name. Labels are canonicalized through the SAME matcher the stats
pipeline uses (aliases, overrides, fuzzy), so the comparison joins cleanly to
ICON_WINDOWS / ORDER_STATS names.

Tab layout (row 1 = headers):
  Category | Handle | Position | Icon Label | Canon Icon | Match |
  Category Updated | Synced

`Canon Icon` is blank when the matcher can't place a label — the compare page
lists those separately instead of silently dropping them.

REQUIRES the `read_metaobjects` scope on the Dev Dashboard app (the same
pending addition the ICON_HEALTH age column wants). Without it the script
exits with a clear message.

Usage:
  python sync_icon_categories.py                     # just most-popular (fast)
  python sync_icon_categories.py --handles most-popular,valentines
  python sync_icon_categories.py --all               # every category (~87)
  python sync_icon_categories.py --dry-run
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from googleapiclient.discovery import build

# Canonical matching + token + sheet helpers live in icon_order_stats.py —
# import, never copy.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "icon_order_stats"))
import icon_order_stats as ios  # noqa: E402

TAB = "ICON_CATEGORIES"
DEFAULT_HANDLES = "most-popular"
HEADER = ["Category", "Handle", "Position", "Icon Label", "Canon Icon", "Match",
          "Category Updated", "Synced"]

BY_HANDLE_QUERY = """
query($handle: String!) {
  metaobjectByHandle(handle: { type: "custom_icon_categories", handle: $handle }) {
    handle
    updatedAt
    title: field(key: "title") { value }
    icons: field(key: "icons") {
      references(first: 200) {
        pageInfo { hasNextPage }
        nodes { ... on Metaobject { label: field(key: "label") { value } } }
      }
    }
  }
}
"""

LIST_HANDLES_QUERY = """
query($after: String) {
  metaobjects(type: "custom_icon_categories", first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { handle }
  }
}
"""


def gql(shop, token, query, variables):
    url = f"https://{shop}.myshopify.com/admin/api/{ios.API_VERSION}/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    for attempt in range(5):
        resp = requests.post(url, headers=headers, json={"query": query, "variables": variables})
        if resp.status_code == 429:
            time.sleep(2 * (attempt + 1))
            continue
        resp.raise_for_status()
        break
    data = resp.json()
    if "errors" in data:
        blob = str(data["errors"])
        if "ACCESS_DENIED" in blob or "read_metaobjects" in blob:
            sys.exit(
                "ERROR: the Shopify app is missing the read_metaobjects scope.\n"
                "Fix: dev.shopify.com/dashboard -> your app -> Configuration -> "
                "Admin API scopes -> add read_metaobjects -> save, then re-run.\n"
                "(Same scope the ICON_HEALTH first-seen dates have been waiting on.)"
            )
        sys.exit(f"Shopify error: {data['errors']}")
    return data["data"]


def list_all_handles(shop, token):
    handles, after = [], None
    while True:
        block = gql(shop, token, LIST_HANDLES_QUERY, {"after": after})["metaobjects"]
        handles.extend(n["handle"] for n in block["nodes"])
        if not block["pageInfo"]["hasNextPage"]:
            return handles
        after = block["pageInfo"]["endCursor"]
        time.sleep(0.2)


def fetch_category(shop, token, handle):
    node = gql(shop, token, BY_HANDLE_QUERY, {"handle": handle})["metaobjectByHandle"]
    if node is None:
        return None
    refs = (node.get("icons") or {}).get("references") or {}
    if (refs.get("pageInfo") or {}).get("hasNextPage"):
        print(f"  WARNING: {handle} has more than 200 icons — extra entries not synced.")
    labels = []
    for n in refs.get("nodes") or []:
        label = ((n or {}).get("label") or {}).get("value")
        if label and label.strip():
            labels.append(label.strip())
    return {
        "handle": node["handle"],
        "title": ((node.get("title") or {}).get("value") or node["handle"]).strip(),
        "updatedAt": node.get("updatedAt") or "",
        "labels": labels,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--shop", default=os.environ.get("SHOPIFY_SHOP"))
    p.add_argument("--client-id", default=os.environ.get("SHOPIFY_CLIENT_ID"))
    p.add_argument("--client-secret", default=os.environ.get("SHOPIFY_CLIENT_SECRET"))
    p.add_argument("--creds", type=Path, default=ios.DEFAULT_CREDS)
    p.add_argument("--handles", default=DEFAULT_HANDLES,
                   help="comma-separated category handles (default: most-popular)")
    p.add_argument("--all", action="store_true", help="sync every category")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    for need, val in [("GOOGLE_SHEET_ID", args.sheet_id), ("SHOPIFY_SHOP", args.shop),
                      ("SHOPIFY_CLIENT_ID", args.client_id),
                      ("SHOPIFY_CLIENT_SECRET", args.client_secret)]:
        if not val:
            sys.exit(f"ERROR: {need} not set (env or flag).")

    shop = ios.normalize_shop(args.shop)
    creds = ios.load_creds(args.creds)
    sheets = build("sheets", "v4", credentials=creds)

    print("Reading catalog + aliases for canonical matching...")
    catalog = ios.read_catalog(sheets, args.sheet_id)
    aliases = ios.read_aliases(sheets, args.sheet_id)
    matcher = ios.Matcher(catalog, aliases)

    print(f"Getting a Shopify access token for {shop}.myshopify.com ...")
    token = ios.get_access_token(shop, args.client_id, args.client_secret)

    handles = list_all_handles(shop, token) if args.all else [
        h.strip() for h in args.handles.split(",") if h.strip()
    ]
    print(f"Syncing {len(handles)} categor{'y' if len(handles) == 1 else 'ies'}...")

    synced = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows, missing = [], []
    for handle in handles:
        cat = fetch_category(shop, token, handle)
        if cat is None:
            missing.append(handle)
            continue
        unmatched_here = 0
        for pos, label in enumerate(cat["labels"], start=1):
            canon, how = matcher.match(label)
            if not canon:
                unmatched_here += 1
            rows.append([cat["title"], cat["handle"], str(pos), label,
                        canon or "", how or "", cat["updatedAt"], synced])
        print(f"  {cat['title']} ({cat['handle']}): {len(cat['labels'])} icons"
              + (f", {unmatched_here} unmatched" if unmatched_here else ""))
        time.sleep(0.2)

    if missing:
        print(f"  NOT FOUND: {', '.join(missing)}")
    if not rows:
        sys.exit("Nothing to write — no categories resolved.")

    if args.dry_run:
        print(f"\n--dry-run: nothing written. {len(rows)} rows. First 10:")
        for r in rows[:10]:
            print("  " + " | ".join(r[:6]))
        return

    n = ios._ensure_clear_update(sheets, args.sheet_id, TAB, [HEADER] + rows)
    print(f"\nWrote {n} rows to {TAB}. The compare page reflects them within ~60s.")


if __name__ == "__main__":
    main()
