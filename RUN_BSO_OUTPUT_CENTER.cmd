@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo [INFO] Output Center is now included in the unified BSO v2.1 launcher.
call "%~dp0RUN_BSO.cmd" %*
exit /b %ERRORLEVEL%
