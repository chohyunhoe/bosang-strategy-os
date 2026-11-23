@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title BSO Consultation Simulator (PR-1, synthetic default)
where node >nul 2>nul || (echo [FAIL] Node.js 22+ is required. & pause & exit /b 1)
node scripts\build_consultation_sim.js || (echo [FAIL] build failed. & pause & exit /b 1)
set "BSO_OPEN_BROWSER=1"
node scripts\serve_product_v2.js dist\consultation-sim 4176
set "BSO_RC=%ERRORLEVEL%"
if not "%BSO_RC%"=="0" pause
exit /b %BSO_RC%
