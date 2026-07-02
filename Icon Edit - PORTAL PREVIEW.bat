@echo off
title Icon Edit - PORTAL PREVIEW
cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons" || (echo. & echo Could not find the icon app folder. Is Dropbox synced? & echo. & pause & exit /b 1)
echo ==================================================
echo   PORTAL EDIT - PREVIEW  [nothing is changed]
echo ==================================================
echo.
python scripts\add_icons\add_icons.py --portal
echo.
echo ==================================================
echo   Preview finished - no changes were made.
echo   Happy? Run the "PORTAL - SEND" file.
echo ==================================================
echo.
pause
