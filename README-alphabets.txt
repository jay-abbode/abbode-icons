ALPHABETS SECTION  (abbode-icons, built on main 8c315a0)

What it does
  - New page /alphabets: one tile per lettering set, showing that set's
    letter A with the set's name under it. Click a tile to browse the set.
  - Reach it from the menu ("Alphabets"), the home page tile, or
    "All alphabets" in the browse sidebar. Inside a set the breadcrumb reads
    Home > Alphabets > <set>.
  - Lettering sets no longer appear in the main browse view, its search, the
    regular category list, or the main Draft view.
  - A set that is still all DRAFT (Varsity Letters) opens on its Draft view.

No sheet changes
  A category counts as an alphabet when 80%+ of its designs have
  single-character names (Varsity 0 - Black, Blue Plaid A, Yacht Flag B) across
  5+ characters. Today: Bandana, Cheetah Letters, Cross Stitch, Plaid Letters,
  Varsity Letters, Yacht Flags. New sets are picked up on their own.

Unchanged
  Downloads, New Icons, contact sheet generator, visual scanner, order/color
  stats and the icons API still include lettering sets, as before.

Files (extract into the repo root, overwrite)
  app/alphabets/page.tsx        (new)
  app/browse/page.tsx
  app/page.tsx
  components/FilterControls.tsx
  components/MobileNav.tsx
  lib/categories.ts
  lib/sheets.ts
