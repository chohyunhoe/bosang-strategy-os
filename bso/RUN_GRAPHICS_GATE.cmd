@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
  echo Usage: RUN_GRAPHICS_GATE.cmd graphics-input\gongju_songseon_donghyeon.json [output-dir]
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

set "OUTPUT_DIR=graphics-output"
if not "%~2"=="" set "OUTPUT_DIR=%~2"

REM Fail-closed: opt-in 사건은 PNU→SHP 검증 PASS 전에는 지도·최종본을 만들지 않는다.
call "%QGIS_PYTHON%" run_parcel_verification.py "%~1" --output-dir "%OUTPUT_DIR%"
set "VERIFY_RC=%ERRORLEVEL%"
if not "%VERIFY_RC%"=="0" (
  echo.
  echo Parcel verification failed with code %VERIFY_RC%.
  echo See: %CD%\%OUTPUT_DIR%\^<case_id^>\parcel_verification_result.json
  exit /b %VERIFY_RC%
)

call "%QGIS_PYTHON%" run_graphics_gate.py "%~1" --output-dir "%OUTPUT_DIR%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo Graphics gate stopped with review/error code %RC%.
  exit /b %RC%
)

call "%QGIS_PYTHON%" run_sample_brief.py "%~1" --output-dir "%OUTPUT_DIR%"
set "BRIEF_RC=%ERRORLEVEL%"
if not "%BRIEF_RC%"=="0" (
  echo.
  echo Sample brief generation failed with code %BRIEF_RC%.
  exit /b %BRIEF_RC%
)

echo.
echo Parcel verification, graphics gate, and final sample brief completed.
echo Output: %OUTPUT_DIR%
exit /b 0
