@echo off
cd /d "%~dp0"
git add -A
git commit -m "ofm_colormap: handle Design Status tables capped at 20 entries (23-stop designs no longer error out)"
git push
pause
