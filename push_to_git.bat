@echo off
cd /d "%~dp0"
git add -A
git commit -m "Composite range chart: COMPOSITE_DAILY tab, 1d-12m + custom ranges, top-15 highlight, range comparison"
git push
pause
