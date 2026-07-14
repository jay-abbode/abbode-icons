THREAD CONFIG — Webster rooms, locks, and saved configurations
==============================================================

WHAT CHANGED
------------
Webster is now 25 heads across 6 rooms (4/3/5/4/5/4), named 1-1 … 6-4. The old
"Machines in use" dropdown is gone — you now switch rooms and individual heads
on and off directly. Abbode's 7 Melcos are untouched and stay roomless; rooms
are an optional fleet property, so Abbode can get them later without a rewrite.

  • Room boxes on the Webster page. Toggle a whole room, or any head inside it.
  • Rename any room. The name is a label — the ids (1-1, 3-4) stay positional.
  • Per-room change-free %, live, as you toggle.
  • Lock a room. Its loadout is pinned at whatever it was when you locked it and
    the rest of the floor re-solves around it. If today's orders have moved on,
    the room shows a quiet flag: "a fresh thread-up would score 97% (this one
    scores 91%)". You lock so you don't re-thread — you still want to know when
    it's costing you.
  • /machines/webster/room/3 is a real page. Pin it to that room's tablet: only
    its heads, its own %, its own day sheet. Read-only, so it can't re-solve
    under the embroiderer's hands.
  • Save the whole floor as a named configuration and load it back. Setting a new
    Active config auto-snapshots the one it replaces, so there's always a way
    back even when nobody remembered to save.

SOLVE FOR: THE WHOLE FLOOR, OR EACH ROOM ON ITS OWN
--------------------------------------------------
This is the switch that matters, and it's the routing question in one control.

  Whole floor  Off-color heads cover the entire floor, wherever they sit. The
               fleet % is the honest one — but only if a job can actually be
               sent to any head. Rooms without an off-color head score much
               lower than the fleet does.

  Each room    Every room carries its own off-color head and can stitch anything
               handed to it. Costs a few points fleet-wide; raises the weakest
               room a lot. This is the correct model until Webster can steer a
               job to a specific room.

Flipping the switch resets the off-color picks to that mode's default (1 per room
in room mode, last 2 of the fleet in floor mode). Everything else is kept.

STORAGE
-------
A new MACHINE_CONFIGS tab in the Icon List sheet, auto-created on first save —
same pattern as COMMENTS, same service account, no new infrastructure. One row
per configuration; the floor is JSON in the last column, so it stays readable.
Each row also stores the % it scored when saved and the data window it was solved
against — that's what lets the Load menu show "saved at 97%, scores 91% now".

Snapshots are pruned to the last 20 per fleet.

THE DAY SHEET
-------------
Now prints the ACTIVE configuration — what the floor is actually threaded to —
rather than whatever happened to be on screen. Falls back to the solver's own
answer if you haven't set an active config yet, so nothing breaks on day one.

  /machines/daysheet?fleet=webster           the Webster floor, grouped by room
  /machines/daysheet?fleet=webster&room=3    just room 3
  /machines/daysheet?cfg=<id>                a specific saved configuration

THE JOB SOURCE IS NOW A SEAM
----------------------------
lib/threadAllocationData.ts has a JOB_SOURCES map: "history" (the THREAD_STATS /
ORDER_STATS tabs — what runs today) and "queue" (the open webster-live order
queue — stubbed). Nothing downstream knows or cares where jobs come from, so
switching the engine from "a bet on the last 3 months" to "the jobs actually
waiting" is a reader function, not a rewrite.

VALIDATION
----------
The new engine was A/B'd against the old one on an identical job set: same
change-free %, same standard loadout, same off-color loadouts, to the digit —
for both fleets, at default settings. Rooms, locking, drift detection, toggles,
empty floors, and malformed saved state all covered. esbuild → tsc --noEmit →
next build, all clean.

FILES
-----
  lib/threadAllocation.ts                    engine: rooms, floor state, locks, scope
  lib/threadAllocationData.ts                pluggable job source + floor reads
  lib/machineConfigs.ts                      NEW — MACHINE_CONFIGS tab read/write
  app/actions/machineConfigs.ts              NEW — save / load / delete server actions
  components/MachinesView.tsx                room boxes, toggles, lock, scope, config bar
  components/MachineParts.tsx                NEW — shared spool diagram + needle table
  components/RoomView.tsx                    NEW — the isolated room page
  components/DaySheetHeader.tsx              room / config labels
  app/machines/page.tsx                      hydrates from the saved active config
  app/machines/daysheet/page.tsx             prints the active config, ?room= scoping
  app/machines/[fleet]/room/[id]/page.tsx    NEW — /machines/webster/room/3

DEPLOY
------
Vercel redeploy required (web app changes). No new env vars, no new scopes — the
service account already has read/write on the sheet (it's what COMMENTS uses).

Unzip flat over the repo root (merge/replace), then:

  cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
  git add -A
  git commit -m "Thread Config: Webster rooms, locks, saved configurations"
  git push

...or just run push_to_git.bat.
