@echo off
setlocal

REM CIVITAS GridStyle 45/90 — local dev server launcher (Windows)
REM Usage:
REM   serve.cmd
REM   serve.cmd 8000

set PORT=%~1
if "%PORT%"=="" set PORT=8000

cd /d "%~dp0"

echo Starting server at http://localhost:%PORT%/
start "CIVITAS GridStyle" "http://localhost:%PORT%/"

REM Prefer 'py' launcher if available.
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :eof
)

echo.
echo ERROR: Python not found. Install Python 3 and ensure 'py' or 'python' is on PATH.
pause
