@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo  Bosang Strategy OS - Tomorrow PC Gate
echo ==============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Git is not installed or not on PATH.
  pause
  exit /b 1
)

for /f "delims=" %%S in ('git status --porcelain') do set "BOSANG_DIRTY=1"
if defined BOSANG_DIRTY (
  echo [HOLD] Local changes are present.
  echo Commit, stash, or discard them before running this gate.
  git status --short
  pause
  exit /b 1
)

echo [1/4] Fetch latest branch
git fetch origin fix/individual-factor-detail-breakdown-20260803
if errorlevel 1 goto :fail

echo [2/4] Checkout gate branch
git checkout fix/individual-factor-detail-breakdown-20260803
if errorlevel 1 goto :fail

echo [3/4] Fast-forward only
git pull --ff-only origin fix/individual-factor-detail-breakdown-20260803
if errorlevel 1 goto :fail

echo [4/4] Start PC gate
echo.
echo Browser steps:
echo   1. Select the same anonymized PDF once.
echo   2. Wait until the top banner says READY.
echo   3. Check desktop, mobile width, synthetic map layout,
echo      numeric table, individual-factor details, and result alignment.
echo   4. Enter the requested P/W/F decisions.
echo   5. After the first decision is recorded, press Ctrl+C once.
echo      The itemized visual review will then start automatically.
echo.
call RUN_PC_GATE.cmd
exit /b %errorlevel%

:fail
echo.
echo [FAIL] Branch preparation failed. No gate was executed.
pause
exit /b 1
