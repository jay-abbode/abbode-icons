@echo off
title Add Icons - PREVIEW (dry run)
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons" || (echo. & echo Could not find the icon app folder. Is Dropbox synced? & echo. & pause & exit /b 1)
echo ==================================================
echo   ADD ICONS - PREVIEW ONLY  [nothing is changed]
echo ==================================================
echo.
python scripts\add_icons\add_icons.py
echo.
echo ==================================================
echo   Preview finished - no changes were made.
echo   Happy with it? Run the "2 RUN (apply)" file.
echo ==================================================
echo.
pause
