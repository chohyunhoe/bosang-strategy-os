@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title BSO Release v1 - Report Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_bso_v1.ps1" -SetupOutput -CheckOnly
set "BSO_RC=%ERRORLEVEL%"
pause
exit /b %BSO_RC%
