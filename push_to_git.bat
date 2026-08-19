@echo off
cd /d "%~dp0"
git add -A
git commit -m "Auto-crop: fix new-icon skip (blank Category), add Drive verification + hard-fail gates"
git push
pause
