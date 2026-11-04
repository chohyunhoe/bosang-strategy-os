@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo  Bosang Strategy OS - Visual Review Only
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "pc-gate-results\LATEST.txt" (
  echo [FAIL] No previous PC gate result was found.
  echo Run RUN_PC_GATE.cmd first.
  pause
  exit /b 1
)

echo This does NOT rerun PDF parsing, OCR, or map generation.
echo It reuses the latest runtime-passed PC_GATE_RESULT.json
echo and records the six visual checks independently.
echo.
node scripts\refine_pc_gate_visual_review.js
set "EXIT_CODE=%errorlevel%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Visual review result was saved to the latest PC gate folder.
) else (
  echo [REVIEW] One or more critical visual checks failed.
)
echo Upload the updated PC_GATE_RESULT.json to ChatGPT.
pause
exit /b %EXIT_CODE%
