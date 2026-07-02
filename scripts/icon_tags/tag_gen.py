#!/usr/bin/env python3
"""
Thematic tag generator for new Abbode icons.

Given an icon's name and its MASTER Category, produce a draft list of search
tags in the house style — the same thematic flavor as the hand-written rows in
tags.csv (category anchor words, synonyms, audiences like "dog mom", occasions
like "valentine", places, aesthetics). Category is the primary signal; the name
adds the specifics; a set of concept rules fills in synonyms/related terms.

This is deterministic and self-contained (no network), so the add_icons runner
can call it every time an icon is added. It writes a solid first draft — good
enough to ship and easy to refine by hand later in tags.csv.
"""
import re

# --- reusable tag bundles -----------------------------------------------------
DOG = ["dog", "puppy", "pet", "animal", "dog mom", "dog dad", "fur baby"]
CAT = ["cat", "kitten", "kitty", "pet", "animal", "cat mom", "cat dad", "fur baby"]
LOCKET = ["locket", "keepsake", "love", "sentimental"]
MONOGRAM = ["letter", "alphabet", "initial", "monogram"]
SKI = ["winter", "snow", "ski", "skiing", "apres ski", "winter sports"]
NAUTICAL = ["nautical", "coastal", "ocean", "sailing", "preppy", "new england"]
ZODIAC = ["zodiac", "astrology", "horoscope", "star sign", "birthday", "celestial"]
ROMANCE = ["heart", "love", "valentine", "valentines day", "galentines"]
CROSS_STITCH = ["cross stitch", "needlepoint", "embroidery", "grandmillennial", "cottagecore", "vintage", "preppy"]
FLOWER = ["flower", "floral", "garden", "bloom", "spring", "nature"]

# --- Category -> base tags (covers every category currently in MASTER) --------
# Keys are normalized (lowercase). Unknown categories fall back to name + rules.
CATEGORY_TAGS = {
    "dogs": DOG,
    "ski dogs": DOG + SKI,
    "locket dogs": DOG + LOCKET,
    "cats": CAT,
    "locket cats": CAT + LOCKET,
    "pets": ["pet", "animal", "fur baby"],
    "horses": ["horse", "pony", "equestrian", "animal", "western", "farm", "cowgirl"],
    "plaid letters": MONOGRAM + ["plaid", "tartan", "preppy", "grandmillennial"],
    "cheetah letters": MONOGRAM + ["cheetah", "animal print", "leopard", "spots"],
    "bandana": MONOGRAM + ["bandana", "western", "cowgirl", "rodeo", "americana"],
    "yacht flags": MONOGRAM + ["yacht flag", "signal flag", "nautical flag", "nautical", "sailing", "coastal", "preppy"],
    "cross stitch": CROSS_STITCH,
    "cross stitch icon": CROSS_STITCH,
    "food": ["food"],
    "drinks": ["drink", "drinks", "cocktail", "happy hour", "bar"],
    "summer": ["summer", "beach", "coastal", "vacation", "preppy"],
    "nature": ["nature", "outdoors", "garden"],
    "holiday": ["holiday", "seasonal", "festive"],
    "romance": ROMANCE + ["romantic", "anniversary"],
    "zodiac": ZODIAC,
    "sports": ["sports", "athletic", "game day", "team", "fan"],
    "apothecary": ["beauty", "self care", "vanity", "glam", "apothecary", "girly"],
    "most popular": ["popular", "bestseller"],
    "california": ["california", "cali", "travel", "west coast"],
    "chicago": ["chicago", "illinois", "midwest", "travel", "windy city"],
    "boston": ["boston", "massachusetts", "new england", "travel"],
    "nyc": ["nyc", "new york", "manhattan", "city", "travel"],
    "texas": ["texas", "southern", "lone star", "travel"],
    "charleston": ["charleston", "south carolina", "southern", "lowcountry", "travel"],
    "japan": ["japan", "japanese", "tokyo", "asia", "travel"],
    "travel": ["travel", "vacation", "trip", "wanderlust", "jet setter"],
    "world cup": ["world cup", "soccer", "football", "sports", "game day"],
    "hobby": ["hobby"],
}

STOPWORDS = {"a", "an", "the", "and", "of", "with", "in", "on", "for", "to", "at", "by", "or", "&"}

# --- concept rules: substring in the (spaced) name -> extra tags ---------------
# Order matters only for readability; output is de-duped. Keep tags lowercase.
NAME_RULES = [
    (r"\blocket\b", LOCKET),
    (r"\bheart\b", ROMANCE),
    (r"\bcross stitch\b", CROSS_STITCH),
    (r"\bneedlepoint\b", ["needlepoint", "cross stitch", "embroidery", "grandmillennial", "cottagecore", "preppy"]),
    (r"\bbandana\b", ["bandana", "western", "cowgirl"]),
    (r"\b(hydrangea|rose|tulip|peony|daisy|sunflower|lily|floral|flower|bloom|magnolia|poppy)\b", FLOWER),
    (r"\b(jersey|soccer|football|world cup)\b", ["soccer", "football", "world cup", "sports", "game day", "jersey", "fan"]),
    (r"\b(note|music|treble|clef|melody)\b", ["music", "musician", "band", "song", "note", "hobby"]),
    (r"\b(fish|betta|goldfish)\b", ["fish", "aquarium", "pet"]),
    (r"\b(mahjong|majong|tile|tiles)\b", ["mahjong", "tiles", "game", "games", "game night", "hobby"]),
    (r"\bnantucket\b", ["nantucket", "new england", "cape cod", "preppy", "coastal"]),
    (r"\b(anchor|sailboat|sail|yacht|shell|wave|boat|nautical)\b", NAUTICAL),
    (r"\b(ski|skiing|snow|mountain|alpine)\b", SKI),
    (r"\b(cocktail|martini|spritz|wine|beer|margarita|espresso|coffee|latte)\b", ["drink", "drinks", "happy hour"]),
    (r"\b(christmas|santa|holly|snowman|ornament)\b", ["christmas", "holiday", "festive", "winter"]),
    (r"\b(halloween|pumpkin|ghost|spooky|bat)\b", ["halloween", "spooky", "fall", "october"]),
    (r"\b(pumpkin|leaf|leaves|acorn|autumn|fall)\b", ["fall", "autumn", "cozy"]),
]

# breed / nickname synonyms worth adding when they appear in a dog's name
DOG_SYNONYMS = {
    "frenchie": ["french bulldog", "frenchie"], "french": ["french bulldog"],
    "golden": ["golden retriever"], "lab": ["labrador", "lab"], "labrador": ["labrador retriever"],
    "corgi": ["corgi"], "doodle": ["doodle", "goldendoodle"], "goldendoodle": ["doodle"],
    "aussie": ["australian shepherd"], "berner": ["bernese mountain dog"], "pom": ["pomeranian"],
    "yorkie": ["yorkshire terrier"], "doxie": ["dachshund", "wiener dog", "sausage dog"],
    "dachshund": ["wiener dog", "sausage dog", "doxie"], "shiba": ["shiba inu"],
    "scottie": ["scottish terrier"], "westie": ["west highland terrier"], "iggy": ["italian greyhound"],
    "pit": ["pit bull", "pitbull"], "chihuahua": ["chihuahua"], "pug": ["pug"], "husky": ["siberian husky"],
}

ZODIAC_EXTRA = {
    "aries": ["ram", "march", "april"], "taurus": ["bull", "april", "may"],
    "gemini": ["twins", "may", "june"], "cancer": ["crab", "june", "july"],
    "leo": ["lion", "july", "august"], "virgo": ["august", "september"],
    "libra": ["scales", "september", "october"], "scorpio": ["scorpion", "october", "november"],
    "sagittarius": ["archer", "november", "december"], "capricorn": ["goat", "december", "january"],
    "aquarius": ["january", "february"], "pisces": ["fish", "february", "march"],
}


def norm(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def generate_tags(name, category, max_tags=18):
    """Return a comma-separated thematic tag string for one icon.

    Order is chosen so the icon's own specifics (the searched terms) are never
    crowded out by a long category bundle: category anchor, then the exact name
    (phrase + words), then concept synonyms, then supporting bundles.
    """
    nm = norm(name)
    cat = norm(category)
    tokens = nm.split()
    content = [t for t in tokens if len(t) > 1 and t not in STOPWORDS and t != "wc"]
    out = []

    def add(items):
        for t in items:
            t = t.strip()
            if t and t not in out:
                out.append(t)

    # 1) category anchor (strongest, most reliable signal)
    add(CATEGORY_TAGS.get(cat, []))

    # 2) the icon's exact name as a phrase (keeps multi-word breeds/terms intact,
    #    e.g. "cane corso", "pink hydrangea") — only for short names.
    if 2 <= len(content) <= 3:
        add([" ".join(content)])

    # 3) the icon's individual words (breed, flavor, city, letter, etc.)
    add(content)

    # 4) concept synonyms triggered by the name
    for pattern, tags in NAME_RULES:
        if re.search(pattern, nm):
            add(tags)

    # 5) dog / cat bundles + breed nicknames, driven by category OR name
    is_dog = "dog" in cat or "dog" in tokens or "puppy" in tokens
    is_cat = ("cat" in cat and "cattle" not in nm) or "cat" in tokens or "kitten" in tokens
    if is_dog:
        add(DOG)
        for tok in tokens:
            if tok in DOG_SYNONYMS:
                add(DOG_SYNONYMS[tok])
    if is_cat:
        add(CAT)

    # 6) zodiac sign specifics
    for sign, extra in ZODIAC_EXTRA.items():
        if sign in tokens:
            add(ZODIAC)
            add(extra)

    return ", ".join(out[:max_tags])


if __name__ == "__main__":
    import sys
    print(generate_tags(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
