WEBSTER — "Machine" naming + machines-in-use dropdown
=====================================================

Webster only (Abbode is unchanged):

1) "Pod" is now "Machine" everywhere — heads are Machine 1 … Machine N, in the
   machine cards, the off-color toggles, the fleet label, and the printable day
   sheet.

2) New "Machines in use" dropdown (1–25, default 16). Pick how many Webster heads
   are running that day and the whole view reshapes:
     • shows exactly that many machine cards
     • the standard / off-color split and the fleet label update
     • the off-color default becomes the last 2 heads of the new size (always
       leaving at least one standard head; changing the count resets off-color to
       that default, and you can still toggle individual heads)
   Your chosen count also carries into the Print day sheet, so the printout
   matches the screen.

Note: the change-free % depends on how many OFF-COLOR heads you run (the standard
heads all carry the same popular loadout), so it stays the same whether you run
16 or 10 machines with 2 off-color — the count mainly sets how many heads you're
threading and which are off-color.

VALIDATION: with the defaults the numbers are byte-for-byte identical to the
earlier validated reference (Webster 88.9% → 97.9%). Custom counts (10, 1, etc.)
recompute correctly. All files transpile clean.

FILES
  lib/threadAllocation.ts          Webster heads are count-driven ("Machine N"),
                                   1–25; off-color default leaves ≥1 standard head
  lib/threadAllocationData.ts      passes machine counts through to the day sheet
  components/MachinesView.tsx       "Machines in use" dropdown + live reshaping
  app/machines/daysheet/page.tsx    reads the count from the URL and matches it

Unzip over the repo root (merge/replace), then push:

  cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
  git add -A
  git commit -m "Webster: rename Pod->Machine + machines-in-use dropdown (1-25)"
  git push
