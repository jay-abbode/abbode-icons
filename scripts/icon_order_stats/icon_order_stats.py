#!/usr/bin/env python3
"""
icon_order_stats.py — build the "Live Order Data" composite.

Scans the Shopify Admin API for orders in a rolling window, reads each line
item's icon + thread-color custom attributes, joins every ordered icon to the
Icon List catalog (its category + thread-color slots), and writes the result
to an ORDER_STATS tab the web app reads.

Pipeline rules (locked with the team):
  - Window: rolling 12 months (configurable with --months).
  - Count: all placed orders (gross). No refund/cancel subtraction.
  - Croc pouches: White (35) -> Tusk (37), for text AND icons.
  - Retired colors (not in the 24-spool palette) are dropped from color tallies.
  - Icon matching: manual OVERRIDES -> exact -> catalog OLD NAME -> ICON_ALIASES
    tab -> fuzzy (rapidfuzz token-set). Color-prefixed variants you defined
    (Red Heart, Blue Cowboy Boot, ...) are their own entries with set colors.

Requires (env or flags):
  SHOPIFY_SHOP              your *.myshopify.com subdomain only, e.g. "abbode"
                            (NOT abbode.com, NOT the full .myshopify.com URL)
  SHOPIFY_CLIENT_ID         Client ID from your Dev Dashboard app
  SHOPIFY_CLIENT_SECRET     Client secret from your Dev Dashboard app
  GOOGLE_SHEET_ID           the Icon List sheet
  google-credentials.json   service account with EDIT access to that sheet

As of Jan 2026 Shopify no longer shows a copyable Admin API token. You create
an app in the Dev Dashboard (dev.shopify.com/dashboard), give it the read_orders
scope, install it on the store, and copy its Client ID + Client secret. This
script exchanges those for a 24h token automatically (client credentials grant),
so there's no token to copy or rotate by hand. The app and store must be in the
same Shopify organization (they are, since you create the app in your own org).

Run a dry run first (no write):
  python icon_order_stats.py --dry-run --limit 500
Then for real:
  python icon_order_stats.py
"""

import argparse, os, re, sys, time, json
from pathlib import Path
from datetime import datetime, timedelta, timezone

import requests
from rapidfuzz import fuzz, process
from google.oauth2 import service_account
from googleapiclient.discovery import build

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
API_VERSION = "2024-10"
MASTER_TAB = "MASTER"
ALIAS_TAB = "ICON_ALIASES"      # optional: columns "Customizer Name", "Catalog Name"
OUT_TAB = "ORDER_STATS"

# 24-spool palette (slot -> name). Mirror of lib/threadPalette.ts.
PALETTE = {0:"Burgundy",1:"Dark Red",4:"Rust Orange",5:"Orange",6:"Peach",7:"Dark Yellow",
8:"Yellow",10:"Olive Green",12:"Dark Green",13:"Matcha Green",17:"Cool Periwinkle",
19:"Dark Royal",20:"Navy",21:"Purple",27:"Dusty Pink",28:"Light Pink",29:"Tan",
30:"Milk Chocolate",31:"Dark Chocolate",32:"Silver",34:"Charcoal",35:"White",36:"Black",37:"Tusk"}

# Color-prefixed variants -> their thread-color slots (team-provided).
# These are recognized as their own icons and carry their own colors.
OVERRIDES = {
    "red heart":[1], "pink heart":[27],
    "brown cowboy boot":[29,30], "blue cowboy boot":[17,20], "pink cowboy boot":[28,27],
    "pink claw":[28,27], "pink claw clip":[28,27], "black claw":[36], "red claw":[1],
    "pink bow":[27], "long bow":[35],
}
OVERRIDE_BASE = {  # for category lookup
    "red heart":"Heart","pink heart":"Heart",
    "brown cowboy boot":"Cowboy Boot","blue cowboy boot":"Cowboy Boot","pink cowboy boot":"Cowboy Boot",
    "pink claw":"Claw Clip","pink claw clip":"Claw Clip","black claw":"Claw Clip","red claw":"Claw Clip",
    "pink bow":"Long Bow","long bow":"Long Bow",
}
OVERRIDE_NAME = {
    "red heart":"Red Heart","pink heart":"Pink Heart","brown cowboy boot":"Brown Cowboy Boot",
    "blue cowboy boot":"Blue Cowboy Boot","pink cowboy boot":"Pink Cowboy Boot","pink claw":"Pink Claw",
    "pink claw clip":"Pink Claw Clip","black claw":"Black Claw","red claw":"Red Claw",
    "pink bow":"Pink Bow","long bow":"Long Bow",
}

# Lines that are never embroidered icons — never count these.
SKU_SKIP_EXACT = {"ONWARDINS01", "ES-UPCHARGE", "CUST-DIG-FEE"}
HANDLE_SKIP_SUBSTR = ("onward-package", "package-protection", "gift-card",
                      "custom-digitization", "-pos", "wholesale", "essentials-fee", "-fee")

FUZZY_AUTO = 88
FUZZY_REVIEW = 78


def norm(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


# --------------------------------------------------------------------------
# Catalog + aliases
# --------------------------------------------------------------------------
def read_catalog(sheets, sheet_id):
    resp = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=f"{MASTER_TAB}!A1:AZ5000").execute()
    rows = resp.get("values", [])
    if len(rows) < 3:
        sys.exit("ERROR: MASTER tab looks empty.")
    header = [h.strip() for h in rows[1]]
    idx = {h.lower(): i for i, h in enumerate(header)}
    ci, ic, ist, iol, itc = (idx.get("category"), idx.get("icon"), idx.get("status"),
                             idx.get("old name"), idx.get("thread colors"))
    if ic is None:
        sys.exit("ERROR: no 'Icon' column in MASTER.")
    cat = {}
    for r in rows[2:]:
        def g(i): return r[i].strip() if (i is not None and i < len(r)) else ""
        name = g(ic)
        if not name:
            continue
        cat[name] = {
            "category": g(ci), "status": g(ist), "old_name": g(iol),
            "slots": [int(m) for m in re.findall(r"-?\d+", g(itc))],
        }
    return cat


def read_aliases(sheets, sheet_id):
    """Optional ICON_ALIASES tab: customizer name -> catalog name. Self-improving."""
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=f"{ALIAS_TAB}!A1:B5000").execute()
    except Exception:
        return {}
    rows = resp.get("values", [])
    out = {}
    for r in rows[1:]:
        if len(r) >= 2 and r[0].strip() and r[1].strip():
            out[norm(r[0])] = r[1].strip()
    return out


# --------------------------------------------------------------------------
# Matching
# --------------------------------------------------------------------------
class Matcher:
    def __init__(self, catalog, aliases):
        self.catalog = catalog
        self.aliases = aliases
        self.by_norm = {}
        self.alias_norm = {}
        for name, row in catalog.items():
            self.by_norm.setdefault(norm(name), name)
            if row["old_name"]:
                self.alias_norm.setdefault(norm(row["old_name"]), name)
        self.norm_to_canon = {norm(n): n for n in catalog}
        self.choices = list(self.norm_to_canon)
        self.unmatched = {}
        self.review = {}

    def match(self, name):
        n = norm(name)
        if n in OVERRIDES:        return OVERRIDE_NAME[n], "override"
        if n in self.aliases:     return self.aliases[n], "alias-tab"
        if n in self.by_norm:     return self.by_norm[n], "exact"
        if n in self.alias_norm:  return self.alias_norm[n], "old-name"
        best = process.extractOne(n, self.choices, scorer=fuzz.token_set_ratio)
        if best:
            cand, score, _ = best
            canon = self.norm_to_canon[cand]
            if score >= FUZZY_AUTO:
                return canon, "fuzzy-auto"
            if score >= FUZZY_REVIEW:
                self.review[name] = (canon, score)
                return canon, "fuzzy-review"
        self.unmatched[name] = self.unmatched.get(name, 0) + 1
        return None, "unmatched"


# --------------------------------------------------------------------------
# Shopify
# --------------------------------------------------------------------------
ORDERS_QUERY = """
query($q: String!, $after: String) {
  orders(first: 100, query: $q, sortKey: CREATED_AT, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      lineItems(first: 20) { edges { node {
        sku
        customAttributes { key value }
        variant { product { handle } }
      } } }
    } }
  }
}
"""


def normalize_shop(shop):
    """Accept 'abbode', 'abbode.myshopify.com', or a full URL -> 'abbode'."""
    s = (shop or "").strip().replace("https://", "").replace("http://", "").strip("/")
    return s.split(".myshopify.com")[0].split(".")[0] if ".myshopify.com" in s else s.split("/")[0]


def get_access_token(shop, client_id, client_secret):
    """Client credentials grant -> short-lived (24h) Admin API token."""
    url = f"https://{shop}.myshopify.com/admin/oauth/access_token"
    resp = requests.post(url, data={
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    })
    if resp.status_code != 200:
        sys.exit(
            f"Token request failed ({resp.status_code}): {resp.text}\n"
            "If this says 'shop_not_permitted', your app and store are in different\n"
            "Shopify organizations — create the app from the Dev Dashboard of the\n"
            "same org that owns the store."
        )
    return resp.json()["access_token"]


def shopify_orders(shop, token, months, limit=None):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(months * 30.5))).date().isoformat()
    url = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    q = f"created_at:>={cutoff}"
    after, seen = None, 0
    while True:
        for attempt in range(5):
            resp = requests.post(url, headers=headers,
                                 json={"query": ORDERS_QUERY, "variables": {"q": q, "after": after}})
            if resp.status_code == 429:
                time.sleep(2 * (attempt + 1)); continue
            resp.raise_for_status()
            break
        data = resp.json()
        if "errors" in data:
            sys.exit(f"Shopify error: {data['errors']}")
        block = data["data"]["orders"]
        for edge in block["edges"]:
            for li in edge["node"]["lineItems"]["edges"]:
                yield li["node"]
            seen += 1
            if limit and seen >= limit:
                return
        if not block["pageInfo"]["hasNextPage"]:
            return
        after = block["pageInfo"]["endCursor"]
        time.sleep(0.3)  # be polite to the API


def line_is_noise(sku, handle):
    if not sku and not handle:
        return True
    if sku and sku.upper() in SKU_SKIP_EXACT:
        return True
    h = (handle or "").lower()
    return any(s in h for s in HANDLE_SKIP_SUBSTR)


def is_croc(sku, handle):
    return "croc" in (handle or "").lower() or (sku or "").upper().startswith("CRCP")


def parse_color_slot(raw, croc):
    m = re.match(r"\s*(\d+)", raw or "")
    if not m:
        return None
    slot = int(m.group(1))
    if croc and slot == 35:
        slot = 37
    return slot if slot in PALETTE else None   # drop retired


# --------------------------------------------------------------------------
# Aggregate + write
# --------------------------------------------------------------------------
def aggregate(line_items, matcher):
    counts, colors = {}, {}
    for li in line_items:
        sku = li.get("sku")
        handle = (li.get("variant") or {}).get("product", {}).get("handle") if li.get("variant") else None
        if line_is_noise(sku, handle):
            continue
        attrs = {a["key"]: a["value"] for a in (li.get("customAttributes") or [])}
        croc = is_croc(sku, handle)
        slot = parse_color_slot(attrs.get("color-text-one") or attrs.get("font_color"), croc)
        for key in ("icon-one", "icon-two", "icon-three"):
            name = (attrs.get(key) or "").strip()
            if not name:
                continue
            canon, _how = matcher.match(name)
            if not canon:
                continue
            counts[canon] = counts.get(canon, 0) + 1
            if slot is not None:
                colors.setdefault(canon, {})[slot] = colors.setdefault(canon, {}).get(slot, 0) + 1
    return counts, colors


def catalog_slots_for(canon, catalog):
    nlc = canon.lower()
    if nlc in OVERRIDES:
        base = catalog.get(OVERRIDE_BASE.get(nlc, ""), {})
        return OVERRIDES[nlc], base.get("category", "(variant)")
    row = catalog.get(canon, {})
    return row.get("slots", []), row.get("category", "")


def write_stats(sheets, sheet_id, counts, catalog, window_label):
    today = datetime.now(timezone.utc).date().isoformat()
    header = ["Icon", "Category", "Orders", "Thread Slots", "Window", "Updated"]
    rows = [header]
    for canon, cnt in sorted(counts.items(), key=lambda x: -x[1]):
        slots, category = catalog_slots_for(canon, catalog)
        rows.append([canon, category, cnt, "; ".join(map(str, slots)), window_label, today])

    # ensure the tab exists
    meta = sheets.spreadsheets().get(spreadsheetId=sheet_id).execute()
    tabs = {s["properties"]["title"] for s in meta["sheets"]}
    if OUT_TAB not in tabs:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": OUT_TAB}}}]}).execute()

    sheets.spreadsheets().values().clear(spreadsheetId=sheet_id, range=f"{OUT_TAB}!A1:Z5000").execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id, range=f"{OUT_TAB}!A1",
        valueInputOption="RAW", body={"values": rows}).execute()
    return len(rows) - 1


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--shop", default=os.environ.get("SHOPIFY_SHOP"))
    p.add_argument("--client-id", default=os.environ.get("SHOPIFY_CLIENT_ID"))
    p.add_argument("--client-secret", default=os.environ.get("SHOPIFY_CLIENT_SECRET"))
    p.add_argument("--creds", type=Path, default=DEFAULT_CREDS)
    p.add_argument("--months", type=float, default=12)
    p.add_argument("--limit", type=int, default=None, help="cap orders scanned (testing)")
    p.add_argument("--dry-run", action="store_true", help="don't write the tab; print a preview")
    args = p.parse_args()

    for need, val in [("GOOGLE_SHEET_ID", args.sheet_id), ("SHOPIFY_SHOP", args.shop),
                      ("SHOPIFY_CLIENT_ID", args.client_id),
                      ("SHOPIFY_CLIENT_SECRET", args.client_secret)]:
        if not val:
            sys.exit(f"ERROR: {need} not set (env or flag).")

    shop = normalize_shop(args.shop)
    creds = load_creds(args.creds)
    sheets = build("sheets", "v4", credentials=creds)

    print("Reading catalog + aliases...")
    catalog = read_catalog(sheets, args.sheet_id)
    aliases = read_aliases(sheets, args.sheet_id)
    print(f"  {len(catalog)} icons, {len(aliases)} alias-tab entries")

    print(f"Getting a Shopify access token for {shop}.myshopify.com ...")
    token = get_access_token(shop, args.client_id, args.client_secret)

    matcher = Matcher(catalog, aliases)
    window_label = f"Rolling {args.months:g} months"
    print(f"Scanning Shopify orders ({window_label}, gross)...")
    counts, colors = aggregate(shopify_orders(shop, token, args.months, args.limit), matcher)

    print(f"  matched {len(counts)} distinct icons across "
          f"{sum(counts.values())} icon-orders")
    if matcher.review:
        print(f"  {len(matcher.review)} fuzzy matches to review (add to {ALIAS_TAB} to lock):")
        for raw, (canon, sc) in sorted(matcher.review.items()):
            print(f"     {raw!r:32} -> {canon!r}  ({sc:.0f})")
    if matcher.unmatched:
        print(f"  {len(matcher.unmatched)} UNMATCHED (add to {ALIAS_TAB} or the catalog):")
        for raw, n in sorted(matcher.unmatched.items(), key=lambda x: -x[1]):
            print(f"     {raw!r:32} x{n}")

    if args.dry_run:
        print("\n--dry-run: top 20 preview (not written)")
        for canon, cnt in sorted(counts.items(), key=lambda x: -x[1])[:20]:
            slots, cat = catalog_slots_for(canon, catalog)
            print(f"  {canon:28} {cat:14} {cnt:>5}  slots={slots}")
        return

    n = write_stats(sheets, args.sheet_id, counts, catalog, window_label)
    print(f"\nWrote {n} rows to the {OUT_TAB} tab. The app will show them within ~60s.")


if __name__ == "__main__":
    main()
