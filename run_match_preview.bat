@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo   Abbode Icon Match Preview
echo ============================================================

REM Build the Python environment OUTSIDE Dropbox so sync can't corrupt it.
set "VENV=%LOCALAPPDATA%\abbode-match-venv"

REM Remove the broken environment that got created inside the Dropbox folder.
if exist ".venv-match" (
  echo Cleaning up the old environment from the Dropbox folder...
  rmdir /s /q ".venv-match" 2>nul
)

where python >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Python was not found. Open a terminal and type:  python --version
  echo If that fails, Python needs installing or adding to PATH. Send me what you see.
  pause
  exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
  echo Creating a clean environment outside Dropbox...
  python -m venv "%VENV%"
)

if not exist "%VENV%\Scripts\python.exe" (
  echo.
  echo ERROR: could not create the environment. Send me the messages above.
  pause
  exit /b 1
)

set "PY=%VENV%\Scripts\python.exe"

REM Make sure pip is healthy (no in-place self-upgrade; that was the breakage).
"%PY%" -m ensurepip --upgrade >nul 2>&1
"%PY%" -m pip --version >nul 2>&1
if errorlevel 1 (
  echo Repairing pip...
  "%PY%" -m ensurepip --default-pip
)

echo.
echo Installing dependencies ^(first run downloads PyTorch + DINOv2, a few minutes^)...
"%PY%" -m pip install -r requirements-match-preview.txt
if errorlevel 1 (
  echo.
  echo ERROR: dependency install failed. Copy everything above and send it to me.
  pause
  exit /b 1
)

if "%ANTHROPIC_API_KEY%"=="" (
  echo.
  echo NOTE: ANTHROPIC_API_KEY isn't visible in this window. If you just set it,
  echo close this window and double-click the bat again.
  echo.
)

echo.
echo Running matcher...
"%PY%" match_preview.py
set RC=%errorlevel%

echo.
if exist "icon_review.html" (
  echo Opening report...
  start "" "icon_review.html"
) else (
  echo No report was produced. Check the messages above.
)

echo.
pause
exit /b %RC%
