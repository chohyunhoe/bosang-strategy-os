@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: RUN_CADASTRAL_AERIAL.cmd local_only\case.json [output-dir]
  exit /b 2
)
set "OUTPUT=bso-cadastral-out"
if not "%~2"=="" set "OUTPUT=%~2"
python "%~dp0tools\cadastral_aerial.py" --config "%~1" --out "%OUTPUT%"
exit /b %ERRORLEVEL%
