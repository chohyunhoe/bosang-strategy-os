@echo off
setlocal EnableExtensions

set "BSO_ROOT=%~dp0"
pushd "%BSO_ROOT%" || exit /b 2

title Bosang Strategy OS v0.1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BSO_ROOT%scripts\run_bso_v01.ps1" %*
set "BSO_RC=%ERRORLEVEL%"

if not "%BSO_RC%"=="0" (
  echo.
  echo BSO launcher stopped. Check the message above or the local run log.
  pause
)

popd
exit /b %BSO_RC%
