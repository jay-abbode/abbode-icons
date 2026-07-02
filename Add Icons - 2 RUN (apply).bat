@echo off
title Add Icons - RUN (apply)
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons" || (echo. & echo Could not find the icon app folder. Is Dropbox synced? & echo. & pause & exit /b 1)
echo ==================================================
echo   ADD ICONS - APPLY  [writes to the sheet + Drive]
echo ==================================================
echo.
echo You will be asked to type  yes  to confirm.
echo.
python scripts\add_icons\add_icons.py --apply
echo.
echo ==================================================
echo   All done. Now hard-refresh the app:
echo   Ctrl + Shift + R  in your browser.
echo ==================================================
echo.
pause
