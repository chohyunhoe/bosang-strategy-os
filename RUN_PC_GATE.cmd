@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js is not installed or not on PATH.
  echo Install a current Node.js LTS release, then run this file again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm is not installed or not on PATH.
  echo Reinstall Node.js LTS with npm, then run this file again.
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -p "process.versions.node"') do set "BOSANG_NODE_VERSION=%%V"
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(((a===20&&b>=16)||(a===22&&b>=3)||a>22)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Unsupported Node.js version: %BOSANG_NODE_VERSION%
  echo Use Node.js 20.16-20.x or 22.3 and later. Current LTS is recommended.
  pause
  exit /b 1
)
node scripts\run_pc_gate.js
if errorlevel 1 (
  echo.
  echo Initial PC gate recorded a fail or blocker.
  echo Starting item-by-item visual review to identify the exact failed area.
)
node scripts\refine_pc_gate_visual_review.js
if errorlevel 1 (
  echo.
  echo PC gate remains FAIL. Review only the failed visual item or hard blocker in PC_GATE_RESULT.json.
  pause
  exit /b 1
)
echo.
echo PC gate item-by-item review completed.
endlocal
