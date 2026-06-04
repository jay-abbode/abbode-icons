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
COMPOSITE_TAB = "COMPOSITE"
ICON_TRENDS_TAB = "ICON_TRENDS"     # rising/spiking icons (recent vs previous window)
COLOR_TRENDS_TAB = "COLOR_TRENDS"   # rising/spiking TEXT colors
USAGE_TAB = "PRODUCT_USAGE"         # most-common icons/fonts/colors per product & template
WINDOWS = (3, 6, 12)  # rolling-month buckets for the composite
TREND_DAYS_DEFAULT = 30  # trend = last N days vs the N days before that

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
    "blue bow":[17], "white bow":[35], "red bow":[1], "black bow":[36],
}
OVERRIDE_BASE = {  # for category lookup
    "red heart":"Heart","pink heart":"Heart",
    "brown cowboy boot":"Cowboy Boot","blue cowboy boot":"Cowboy Boot","pink cowboy boot":"Cowboy Boot",
    "pink claw":"Claw Clip","pink claw clip":"Claw Clip","black claw":"Claw Clip","red claw":"Claw Clip",
    "pink bow":"Long Bow","long bow":"Long Bow","blue bow":"Long Bow","white bow":"Long Bow",
    "red bow":"Long Bow","black bow":"Long Bow",
}
OVERRIDE_NAME = {
    "red heart":"Red Heart","pink heart":"Pink Heart","brown cowboy boot":"Brown Cowboy Boot",
    "blue cowboy boot":"Blue Cowboy Boot","pink cowboy boot":"Pink Cowboy Boot","pink claw":"Pink Claw",
    "pink claw clip":"Pink Claw Clip","black claw":"Black Claw","red claw":"Red Claw",
    "pink bow":"Pink Bow","long bow":"Long Bow","blue bow":"Blue Bow","white bow":"White Bow",
    "red bow":"Red Bow","black bow":"Black Bow",
}

# Order names that map to an existing catalog icon under a different spelling.
MANUAL_ALIASES = {
    "blue handbag": "Navy Suitcase",
    "handbag blue": "Navy Suitcase",
    "pink handbag": "Pink Suitcase",
    "vespa": "Moped",
    "surfboard": "Surf Board",
    "bichon frise": "Fluffy White Dog",
    "ski bichon frise": "Ski Fluffy White Dog",
    "labrador retriever": "Yellow Lab",
    "black labrador retriever": "Black Lab",
    "west highland white terrier": "Westie",
    "shih tzu long hair": "Longhair Shi Tzu",
    "long hair shih tzu": "Longhair Shi Tzu",
    "tan long haired dachshund": "Tan Longhair Dachshund",
    "tricolor basset hound": "Dark Brown and White Basset Hound",
}
# Non-icon values to skip entirely (no icon chosen, or discontinued/cut designs).
IGNORE = {"none", "baguette", "boot prints", "corndog", "bread", "avocado",
          "no selection", "hand bag", "texas flag", "texas boot", "red college boot",
          "tcu boot", "tcu hand", "smu horse", "sooners logo", "yankees",
          "ski gondola", "gelato", "wreath", "earmuffs",
          "ketchup", "penne", "nugget dip", "elbow pasta"}

# Lines that are never embroidered icons — never count these.
SKU_SKIP_EXACT = {"ONWARDINS01", "ES-UPCHARGE", "CUST-DIG-FEE"}
HANDLE_SKIP_SUBSTR = ("onward-package", "package-protection", "gift-card",
                      "custom-digitization", "-pos", "wholesale", "essentials-fee", "-fee")

FUZZY_AUTO = 88
FUZZY_REVIEW = 78


def norm(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = s.replace("pitbull", "pit bull")   # orders say "Pitbull"; catalog says "Pit Bull"
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
        if n in IGNORE:           return None, "ignored"
        if n in OVERRIDES:        return OVERRIDE_NAME[n], "override"
        if n in MANUAL_ALIASES:   return MANUAL_ALIASES[n], "manual-alias"
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
  orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      createdAt
      lineItems(first: 20) { edges { node {
        sku
        customAttributes { key value }
        variant { product { id handle } }
      } } }
    } }
  }
}
"""

PRODUCTS_QUERY = """
query($after: String) {
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      base: metafield(namespace: "custom", key: "base_product_name_nb") { value }
      template: metafield(namespace: "custom", key: "design_template_name_nb") { value }
    } }
  }
}
"""


def fetch_product_map(shop, token, max_pages=80):
    """Map product GID -> (base_product, design_template) from product metafields.
    Only products carrying at least one of the two metafields are kept; that's
    the set of customizable 'template' products the usage report cares about.
    A missing half is recorded as 'Unspecified'."""
    url = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    out, after, pages = {}, None, 0
    while pages < max_pages:
        for attempt in range(5):
            resp = requests.post(url, headers=headers,
                                 json={"query": PRODUCTS_QUERY, "variables": {"after": after}})
            if resp.status_code == 429:
                time.sleep(2 * (attempt + 1)); continue
            resp.raise_for_status()
            break
        data = resp.json()
        if "errors" in data:
            sys.exit(f"Shopify error (products): {data['errors']}")
        block = data["data"]["products"]
        for edge in block["edges"]:
            n = edge["node"]
            b = ((n.get("base") or {}).get("value") or "").strip()
            t = ((n.get("template") or {}).get("value") or "").strip()
            if not b and not t:
                continue
            out[n["id"]] = (b or "Unspecified", t or "Unspecified")
        if not block["pageInfo"]["hasNextPage"]:
            break
        after = block["pageInfo"]["endCursor"]
        pages += 1
        time.sleep(0.2)
    return out


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


class ReadAllOrdersError(Exception):
    """Shopify refused orders older than 60 days (read_all_orders not granted)."""


def _is_read_all_orders_error(errors):
    blob = json.dumps(errors).lower()
    return ("read_all_orders" in blob or "merchant approval" in blob
            or "older than 60 days" in blob or "60 days" in blob)


def _scan(shop, token, months, state, limit=None):
    """Yield (created_at_iso, line_item) newest-first. Raise ReadAllOrdersError
    if Shopify blocks orders beyond the 60-day window."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(months * 30.5))).date().isoformat()
    url = f"https://{shop}.myshopify.com/admin/api/{API_VERSION}/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    q = f"created_at:>={cutoff}"
    after = None
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
            if _is_read_all_orders_error(data["errors"]):
                raise ReadAllOrdersError()
            sys.exit(f"Shopify error: {data['errors']}")
        block = data["data"]["orders"]
        for edge in block["edges"]:
            node = edge["node"]
            created = node.get("createdAt")
            for li in node["lineItems"]["edges"]:
                yield created, li["node"]
            state["seen"] += 1
            state["yielded"] = True
            if limit and state["seen"] >= limit:
                return
        if not block["pageInfo"]["hasNextPage"]:
            return
        after = block["pageInfo"]["endCursor"]
        time.sleep(0.3)  # be polite to the API


def scan_orders(shop, token, months, state, limit=None):
    """Wrap _scan with a graceful fallback: if read_all_orders isn't granted,
    keep whatever recent orders we already pulled (or retry capped at ~60 days
    if we hadn't pulled any yet), and flag the run as capped."""
    try:
        yield from _scan(shop, token, months, state, limit)
    except ReadAllOrdersError:
        state["capped"] = True
        if state.get("yielded"):
            print("  note: only the last ~60 days are available "
                  "(read_all_orders pending) \u2014 using what was pulled.")
            return
        print("  note: read_all_orders not yet approved \u2014 "
              "capping this run to the last ~60 days.")
        yield from _scan(shop, token, 1.95, state, limit)


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


def adjust_slots(slots, croc):
    """Croc -> White(35) becomes Tusk(37); drop any retired (non-palette) slot."""
    out = []
    for s in slots:
        if croc and s == 35:
            s = 37
        if s in PALETTE:
            out.append(s)
    return out


def parse_color_label(raw):
    """'35 — White' -> 'White'. Falls back to the trimmed string if there's no
    'NN — Name' shape. Returns None for blanks. We report the customer-facing
    color NAME here (not a palette slot), since the customizer's color list has
    options beyond the 24 production spools."""
    s = (raw or "").strip()
    if not s:
        return None
    m = re.match(r"\s*\d+\s*[\u2014\u2013-]\s*(.+)$", s)
    name = (m.group(1) if m else s).strip()
    return name or None


def fonts_from_attrs(attrs):
    """Distinct font choices on a line (current + legacy customizer keys)."""
    out = []
    for k in ("font-text-one", "font-text-two", "font_style"):
        v = (attrs.get(k) or "").strip()
        if v and v not in out:
            out.append(v)
    return out


def colors_from_attrs(attrs):
    """Distinct text-color labels on a line (current + legacy customizer keys)."""
    out = []
    for k in ("color-text-one", "color-text-two", "font_color"):
        name = parse_color_label(attrs.get(k))
        if name and name not in out:
            out.append(name)
    return out


def windows_for(created_at_iso, now):
    """Which rolling windows (3/6/12 mo) an order falls into, by age in days."""
    try:
        dt = datetime.fromisoformat((created_at_iso or "").replace("Z", "+00:00"))
        age = (now - dt).days
    except Exception:
        return WINDOWS  # unparseable date -> count everywhere, conservatively
    return tuple(w for w in WINDOWS if age <= w * 30.5)


# --------------------------------------------------------------------------
# Aggregate + write
# --------------------------------------------------------------------------
def aggregate(order_lines, matcher, catalog, trend_days=TREND_DAYS_DEFAULT, product_map=None):
    """Returns (counts, composite, icon_trends, color_trends, usage):
      counts        -> {icon canon: order count} for ORDER_STATS / Icon Data
      composite     -> {window: {slot: {"icons": n, "text": n}}} for Composite Data
      icon_trends   -> {canon: {"recent": n, "previous": n}}  rising/spiking icons
      color_trends  -> {slot:  {"recent": n, "previous": n}}  rising/spiking TEXT colors
      usage         -> {(base, template): {"icon"/"font"/"color": {value: count}}}
                       for the Product Usage report, keyed off product metafields.
    Trend windows: recent = orders in the last `trend_days`; previous = the
    `trend_days` before that (so both fit inside the ~60-day order window we can
    currently read, and give a real rise/spike signal today).
    Icon colors come from the catalog (croc-adjusted), the text color from the
    customizer attribute; both counted once per line, bucketed by order age.
    """
    counts = {}
    composite = {w: {} for w in WINDOWS}
    icon_trends = {}
    color_trends = {}
    usage = {}
    product_map = product_map or {}
    now = datetime.now(timezone.utc)

    def trend_bucket(created_at_iso):
        """'recent', 'previous', or None based on order age in days."""
        try:
            dt = datetime.fromisoformat((created_at_iso or "").replace("Z", "+00:00"))
            age = (now - dt).days
        except Exception:
            return None
        if age <= trend_days:
            return "recent"
        if age <= 2 * trend_days:
            return "previous"
        return None

    for created_at, li in order_lines:
        sku = li.get("sku")
        variant = li.get("variant") or {}
        product = variant.get("product") or {}
        handle = product.get("handle")
        if line_is_noise(sku, handle):
            continue
        attrs = {a["key"]: a["value"] for a in (li.get("customAttributes") or [])}
        croc = is_croc(sku, handle)
        wins = windows_for(created_at, now)
        tb = trend_bucket(created_at)

        # Usage cell for this line, if its product is a mapped template product.
        cell = product_map.get(product.get("id"))
        line_icons = set()

        # text thread color (once per line)
        tslot = parse_color_slot(attrs.get("color-text-one") or attrs.get("font_color"), croc)
        if tslot is not None:
            for w in wins:
                d = composite[w].setdefault(tslot, {"icons": 0, "text": 0})
                d["text"] += 1
            if tb:
                color_trends.setdefault(tslot, {"recent": 0, "previous": 0})[tb] += 1

        # icon colors (each thread color in the design, once per line)
        for key in ("icon-one", "icon-two", "icon-three"):
            name = (attrs.get(key) or "").strip()
            if not name:
                continue
            canon, _how = matcher.match(name)
            if not canon:
                continue
            counts[canon] = counts.get(canon, 0) + 1
            line_icons.add(canon)
            if tb:
                icon_trends.setdefault(canon, {"recent": 0, "previous": 0})[tb] += 1
            slots, _cat = catalog_slots_for(canon, catalog)
            for s in adjust_slots(slots, croc):
                for w in wins:
                    d = composite[w].setdefault(s, {"icons": 0, "text": 0})
                    d["icons"] += 1

        # Product Usage report: tally icons/fonts/text colors into this line's
        # (base product, template) cell — once each per line.
        if cell is not None:
            u = usage.setdefault(cell, {"icon": {}, "font": {}, "color": {}})
            for c in line_icons:
                u["icon"][c] = u["icon"].get(c, 0) + 1
            for f in fonts_from_attrs(attrs):
                u["font"][f] = u["font"].get(f, 0) + 1
            for col in colors_from_attrs(attrs):
                u["color"][col] = u["color"].get(col, 0) + 1

    return counts, composite, icon_trends, color_trends, usage


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


def write_composite(sheets, sheet_id, composite, coverage, today):
    header = ["Slot", "Color",
              "3mo Icons", "3mo Text", "3mo Total",
              "6mo Icons", "6mo Text", "6mo Total",
              "12mo Icons", "12mo Text", "12mo Total",
              "Updated", "Coverage"]

    def cell(w, slot, field):
        d = composite[w].get(slot)
        return d[field] if d else 0

    def total(w, slot):
        d = composite[w].get(slot)
        return (d["icons"] + d["text"]) if d else 0

    rows = [header]
    for slot in sorted(PALETTE.keys(), key=lambda s: -total(12, s)):
        row = [slot, PALETTE[slot]]
        for w in (3, 6, 12):
            row += [cell(w, slot, "icons"), cell(w, slot, "text"), total(w, slot)]
        row += [today, coverage]
        rows.append(row)

    meta = sheets.spreadsheets().get(spreadsheetId=sheet_id).execute()
    tabs = {s["properties"]["title"] for s in meta["sheets"]}
    if COMPOSITE_TAB not in tabs:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": COMPOSITE_TAB}}}]}).execute()

    sheets.spreadsheets().values().clear(spreadsheetId=sheet_id, range=f"{COMPOSITE_TAB}!A1:Z100").execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id, range=f"{COMPOSITE_TAB}!A1",
        valueInputOption="RAW", body={"values": rows}).execute()
    return len(rows) - 1


def _ensure_clear_update(sheets, sheet_id, tab, rows, clear_range="A1:Z5000"):
    """Create the tab if missing, clear it, then write rows. Returns data row count."""
    meta = sheets.spreadsheets().get(spreadsheetId=sheet_id).execute()
    tabs = {s["properties"]["title"] for s in meta["sheets"]}
    if tab not in tabs:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]}).execute()
    sheets.spreadsheets().values().clear(spreadsheetId=sheet_id, range=f"{tab}!{clear_range}").execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id, range=f"{tab}!A1",
        valueInputOption="RAW", body={"values": rows}).execute()
    return len(rows) - 1


def write_icon_trends(sheets, sheet_id, icon_trends, catalog, window_label, today):
    header = ["Icon", "Category", "Recent", "Previous", "Window", "Updated"]
    rows = [header]
    # biggest absolute rise first, then highest current volume
    for canon, d in sorted(icon_trends.items(),
                           key=lambda x: (-(x[1]["recent"] - x[1]["previous"]), -x[1]["recent"])):
        _slots, category = catalog_slots_for(canon, catalog)
        rows.append([canon, category, d["recent"], d["previous"], window_label, today])
    return _ensure_clear_update(sheets, sheet_id, ICON_TRENDS_TAB, rows)


def write_color_trends(sheets, sheet_id, color_trends, window_label, today):
    header = ["Slot", "Color", "Recent", "Previous", "Window", "Updated"]
    rows = [header]
    for slot, d in sorted(color_trends.items(),
                          key=lambda x: (-(x[1]["recent"] - x[1]["previous"]), -x[1]["recent"])):
        if slot not in PALETTE:
            continue
        rows.append([slot, PALETTE[slot], d["recent"], d["previous"], window_label, today])
    return _ensure_clear_update(sheets, sheet_id, COLOR_TRENDS_TAB, rows, clear_range="A1:Z200")


def write_usage(sheets, sheet_id, usage, window_label, today):
    """One row per (base product, template, type, value). Type in icon/font/color,
    ordered base -> template -> type -> count desc, so the page can pivot freely."""
    header = ["Base Product", "Template", "Type", "Value", "Count", "Window", "Updated"]
    rows = [header]
    for (base, template) in sorted(usage.keys()):
        cell = usage[(base, template)]
        for typ in ("icon", "font", "color"):
            for value, cnt in sorted(cell[typ].items(), key=lambda x: (-x[1], x[0])):
                rows.append([base, template, typ, value, cnt, window_label, today])
    return _ensure_clear_update(sheets, sheet_id, USAGE_TAB, rows, clear_range="A1:Z50000")


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
    p.add_argument("--trend-days", type=int, default=TREND_DAYS_DEFAULT,
                   help="trend = last N days vs the prior N days (default 30)")
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

    print("Mapping products to base/template (for the usage report)...")
    product_map = fetch_product_map(shop, token)
    print(f"  {len(product_map)} customizable products mapped.")

    matcher = Matcher(catalog, aliases)
    print(f"Scanning Shopify orders (up to {args.months:g} months, gross)...")
    state = {"seen": 0, "yielded": False, "capped": False}
    counts, composite, icon_trends, color_trends, usage = aggregate(
        scan_orders(shop, token, args.months, state, args.limit),
        matcher, catalog, args.trend_days, product_map)

    coverage = ("Last ~60 days (read_all_orders pending)" if state["capped"]
                else f"Rolling {args.months:g} months")
    trend_label = f"Last {args.trend_days}d vs prior {args.trend_days}d"
    today = datetime.now(timezone.utc).date().isoformat()

    print(f"  matched {len(counts)} distinct icons across "
          f"{sum(counts.values())} icon-orders ({state['seen']} orders · {coverage})")
    if matcher.review:
        print(f"  {len(matcher.review)} fuzzy matches to review (add to {ALIAS_TAB} to lock):")
        for raw, (canon, sc) in sorted(matcher.review.items()):
            print(f"     {raw!r:32} -> {canon!r}  ({sc:.0f})")
    if matcher.unmatched:
        print(f"  {len(matcher.unmatched)} UNMATCHED (add to {ALIAS_TAB} or the catalog):")
        for raw, cnt in sorted(matcher.unmatched.items(), key=lambda x: -x[1]):
            print(f"     {raw!r:32} x{cnt}")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        print("Top 15 icons:")
        for canon, cnt in sorted(counts.items(), key=lambda x: -x[1])[:15]:
            slots, cat = catalog_slots_for(canon, catalog)
            print(f"  {canon:28} {cat:14} {cnt:>5}  slots={slots}")
        print("\nComposite — top 12 threads (12-month bucket):")
        ranked = sorted(PALETTE.keys(),
                        key=lambda s: -((composite[12].get(s) or {}).get("icons", 0)
                                        + (composite[12].get(s) or {}).get("text", 0)))
        for s in ranked[:12]:
            d = composite[12].get(s) or {"icons": 0, "text": 0}
            print(f"  {s:>2} {PALETTE[s]:16} icons={d['icons']:>5} "
                  f"text={d['text']:>5} total={d['icons'] + d['text']:>5}")
        print(f"\nTrending icons ({trend_label}) — top 12 by rise:")
        for canon, d in sorted(icon_trends.items(),
                               key=lambda x: -(x[1]["recent"] - x[1]["previous"]))[:12]:
            print(f"  {canon:28} now={d['recent']:>4} prev={d['previous']:>4} "
                  f"rise={d['recent'] - d['previous']:>+4}")
        print(f"\nTrending TEXT colors ({trend_label}) — by rise:")
        for slot, d in sorted(color_trends.items(),
                              key=lambda x: -(x[1]["recent"] - x[1]["previous"]))[:12]:
            print(f"  {slot:>2} {PALETTE.get(slot, '?'):16} now={d['recent']:>4} "
                  f"prev={d['previous']:>4} rise={d['recent'] - d['previous']:>+4}")
        print(f"\nProduct Usage — {len(usage)} (base x template) cells. Sample:")
        for cell in sorted(usage.keys())[:8]:
            u = usage[cell]
            ti = max(u["icon"].items(), key=lambda x: x[1], default=("\u2014", 0))
            tf = max(u["font"].items(), key=lambda x: x[1], default=("\u2014", 0))
            tc = max(u["color"].items(), key=lambda x: x[1], default=("\u2014", 0))
            print(f"  {cell[0]} / {cell[1]}: icon={ti[0]}({ti[1]}) "
                  f"font={tf[0]}({tf[1]}) color={tc[0]}({tc[1]})")
        return

    n1 = write_stats(sheets, args.sheet_id, counts, catalog, coverage)
    n2 = write_composite(sheets, args.sheet_id, composite, coverage, today)
    n3 = write_icon_trends(sheets, args.sheet_id, icon_trends, catalog, trend_label, today)
    n4 = write_color_trends(sheets, args.sheet_id, color_trends, trend_label, today)
    n5 = write_usage(sheets, args.sheet_id, usage, coverage, today)
    print(f"\nWrote {n1} rows to {OUT_TAB}, {n2} to {COMPOSITE_TAB}, "
          f"{n3} to {ICON_TRENDS_TAB}, {n4} to {COLOR_TRENDS_TAB}, "
          f"{n5} to {USAGE_TAB}. "
          "The app will show them within ~60s.")


if __name__ == "__main__":
    main()
