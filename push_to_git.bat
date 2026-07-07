@echo off
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
git add -A
git commit -m "Contact sheet: slim match payload (~28k->~6k tokens) + prompt caching + graceful 429 handling"
git push
pause
