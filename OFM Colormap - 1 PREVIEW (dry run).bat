@echo off
title OFM Colormap - PREVIEW (dry run)
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons" || (echo. & echo Could not find the icon app folder. Is Dropbox synced? & echo. & pause & exit /b 1)
echo ==================================================
echo   OFM COLORMAP - PREVIEW ONLY  [nothing is changed]
echo ==================================================
echo.
pip install -q -r scripts\ofm_colormap\requirements.txt
python scripts\ofm_colormap\ofm_colormap.py --dry-run
echo.
echo ==================================================
echo   Preview finished - no changes were made.
echo   Happy with it? Run the "2 RUN (apply)" file.
echo ==================================================
echo.
pause
