@echo off
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
git add -A
git commit -m "Color stops in every push, scoped to the pushed OFMs + whole-catalog CSV export (--only-names-file, --csv-out)"
git push
pause
