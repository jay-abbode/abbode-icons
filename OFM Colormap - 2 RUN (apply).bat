@echo off
title OFM Colormap - RUN (apply)
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons" || (echo. & echo Could not find the icon app folder. Is Dropbox synced? & echo. & pause & exit /b 1)
echo ==================================================
echo   OFM COLORMAP - APPLY  [writes to the sheet]
echo ==================================================
echo.
echo You will be asked to type  yes  to confirm.
echo.
pip install -q -r scripts\ofm_colormap\requirements.txt
python scripts\ofm_colormap\ofm_colormap.py
echo.
echo ==================================================
echo   All done. Hard-refresh the app: Ctrl + Shift + R
echo   Full CSV report: scripts\ofm_colormap\output\color_stops.csv
echo ==================================================
echo.
pause
