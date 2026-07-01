FIX — hamburger drawer was cut off
==================================

The menu drawer was being clipped to the header's height (only the top couple of
items showed, with a scrollbar). Cause: the header uses backdrop-blur, and a
CSS backdrop-filter creates a "containing block" for position:fixed children —
so the drawer's full-screen `fixed inset-0` was measured against the header box
instead of the whole window.

Fix: the drawer now renders through a React portal onto <body>, escaping the
header entirely, so it fills the full viewport height (with its own internal
scroll if the list is ever taller than the screen).

Single-file drop-in over the already-deployed redesign:

  components/MobileNav.tsx

  cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
  git add -A
  git commit -m "Fix: portal the hamburger drawer to body so it isn't clipped by the header"
  git push
