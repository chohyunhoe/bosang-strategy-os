@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if "%~3"=="" (
  echo Usage: RUN_TRIAL_BATCH.cmd "경일.pdf" "제일.pdf" "가람.pdf"
  exit /b 2
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found.
  exit /b 3
)

where tesseract >nul 2>nul
if errorlevel 1 (
  echo Tesseract not found. Install Tesseract OCR with Korean language data.
  exit /b 4
)

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 exit /b 5
)

call ".venv\Scripts\activate.bat"
python -m pip install -r requirements.txt
if errorlevel 1 exit /b 6

if exist "trial-output" rmdir /s /q "trial-output"
set PYTHONPATH=%CD%\src
set EXPECTED_ARG=
if exist "fixtures\golden_cases\gongju_songseon_donghyeon\expected.json" (
  set EXPECTED_ARG=--expected fixtures\golden_cases\gongju_songseon_donghyeon\expected.json
)

python run_trial_batch.py ^
  "경일=%~1" ^
  "제일=%~2" ^
  "가람=%~3" ^
  %EXPECTED_ARG% ^
  --output-dir trial-output

if errorlevel 1 exit /b 7

if exist "trial-output.zip" del /q "trial-output.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'trial-output\*' -DestinationPath 'trial-output.zip' -Force"
if errorlevel 1 exit /b 8

echo.
echo Trial output created: %CD%\trial-output
echo Human review report: %CD%\trial-output\trial_report.md
echo Package: %CD%\trial-output.zip
exit /b 0
