@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM Subject-only consultation map runner (no comparison standard parcel).
REM RUN_GRAPHICS_GATE and the stable bso_graphics modules are not modified.
REM .env values are passed as environment variables only and never echoed.

if "%~1"=="" (
  echo Usage: RUN_SUBJECT_ONLY_GIS.cmd graphics-input\local_only\^<case^>.json [output-dir]
  exit /b 2
)

set "ENV_FILE=.env"
if not exist "%ENV_FILE%" set "ENV_FILE=..\.env"
if not exist "%ENV_FILE%" (
  echo .env not found in BSO or repository root
  exit /b 3
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  if not "%%A"=="" if not "%%A:~0,1"=="#" set "%%A=%%B"
)

if not defined QGIS_ROOT set "QGIS_ROOT=C:\Program Files\QGIS 4.2.0"
if not exist "%QGIS_ROOT%" (
  echo QGIS root not found: %QGIS_ROOT%
  exit /b 4
)
if not defined VWORLD_API_KEY (
  echo VWORLD_API_KEY missing in .env
  exit /b 5
)

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
set "PYTHONIOENCODING=utf-8"

set "OUTPUT_DIR=graphics-output"
if not "%~2"=="" set "OUTPUT_DIR=%~2"

REM Fail-closed: no map unless every PNU is an exact single SHP match with a strict JIBUN match.
call "%QGIS_PYTHON%" run_subject_only_gis.py "%~1" --output-dir "%OUTPUT_DIR%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo Subject-only GIS completed. Output: %CD%\%OUTPUT_DIR%
) else (
  echo Subject-only GIS stopped with code %RC%. See subject_only_gis_result.json and parcel_verification_result.json
)
exit /b %RC%
