@echo off
title Icon Edit - PORTAL SEND
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons" || (echo. & echo Could not find the icon app folder. Is Dropbox synced? & echo. & pause & exit /b 1)
echo ==================================================
echo   PORTAL EDIT - SEND  [pushes changes to Drive + sheet]
echo ==================================================
echo.
echo Drop the edited icon's files in the PORTAL folder first.
echo You will be asked to type  yes  to confirm.
echo.
python scripts\add_icons\add_icons.py --portal --apply
echo.
echo ==================================================
echo   Done. PORTAL is cleared. Now hard-refresh the app:
echo   Ctrl + Shift + R  in your browser.
echo ==================================================
echo.
pause
