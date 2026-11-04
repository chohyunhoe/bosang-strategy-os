@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
  echo Usage: RUN_PARCEL_VERIFICATION.cmd graphics-input\gwangmyeong_siheung.json [output-dir]
  exit /b 2
)
if not exist ".env" (
  echo .env not found in %CD%
  exit /b 3
)
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if not "%%A"=="" if not "%%A:~0,1"=="#" set "%%A=%%B"
)
if not defined QGIS_ROOT set "QGIS_ROOT=C:\Program Files\QGIS 4.2.0"
if not defined QGIS_PREFIX_PATH set "QGIS_PREFIX_PATH=%QGIS_ROOT%\apps\qgis"
if not defined QGIS_PYTHON set "QGIS_PYTHON=%QGIS_ROOT%\bin\python-qgis.bat"
if not exist "%QGIS_PYTHON%" set "QGIS_PYTHON=%QGIS_ROOT%\apps\Python312\python.exe"
if not exist "%QGIS_PYTHON%" (
  echo QGIS Python not found: %QGIS_PYTHON%
  exit /b 6
)
set "PYTHONHOME=%QGIS_ROOT%\apps\Python312"
set "PYTHONPATH=%QGIS_PREFIX_PATH%\python;%CD%\src"
set "PATH=%QGIS_ROOT%\bin;%QGIS_PREFIX_PATH%\bin;%QGIS_ROOT%\apps\Qt6\bin;%QGIS_ROOT%\apps\Python312;%QGIS_ROOT%\apps\Python312\Scripts;%PATH%"
set "QT_PLUGIN_PATH=%QGIS_ROOT%\apps\Qt6\plugins"
set "OUTPUT_DIR=graphics-output"
if not "%~2"=="" set "OUTPUT_DIR=%~2"

call "%QGIS_PYTHON%" run_parcel_verification.py "%~1" --output-dir "%OUTPUT_DIR%"
exit /b %ERRORLEVEL%
