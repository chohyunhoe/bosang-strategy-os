@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title BSO - Desktop and Start Menu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_bso_shortcuts.ps1" %*
set "BSO_RC=%ERRORLEVEL%"
if not "%BSO_RC%"=="0" (
  echo [FAIL] BSO shortcuts were not installed. Check the message above.
  pause
)
exit /b %BSO_RC%
