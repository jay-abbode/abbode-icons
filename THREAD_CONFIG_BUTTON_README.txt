THREAD CONFIG — nav button
==========================

Replaces the small "Machines" item inside the Reports dropdown with a large,
filled "Thread Config" button in the top navigation bar. It links to /machines
(the thread-allocation page) and stays visible at every screen size.

FILES
-----
  components/Header.tsx       adds the large "Thread Config" button (+ a small
                              spool icon) as a standalone nav item
  components/ReportsMenu.tsx  removes the now-redundant "Machines" dropdown entry

Header.tsx here is your current header (the refactored one with ReportsMenu +
LiveOrderDataMenu); the only change is the added button, so it's safe to drop in.

Unzip over the repo root (merge/replace), then push:

  cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
  git add -A
  git commit -m "Header: large Thread Config button (replaces Machines dropdown link)"
  git push

Note: this only changes how you REACH the page. The Machines page itself (the
full-screen view + selectable off-color heads) is unchanged — make sure you've
also pushed the machines-v2 zip if you haven't yet.
