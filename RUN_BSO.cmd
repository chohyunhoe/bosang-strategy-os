@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Bosang Strategy OS - Release v1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_bso_v1.ps1" %*
set "BSO_RC=%ERRORLEVEL%"
if not "%BSO_RC%"=="0" (
  echo [FAIL] BSO did not start. Check the message above.
  pause
)
exit /b %BSO_RC%
