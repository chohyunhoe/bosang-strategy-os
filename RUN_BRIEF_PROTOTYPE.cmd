@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

if not exist "prototype-output" mkdir "prototype-output"
set "LOG=%CD%\prototype-output\run.log"
>"%LOG%" echo Bosang Strategy OS v0.1 Brief Prototype
>>"%LOG%" echo Started: %DATE% %TIME%

echo ==============================================
echo  Bosang Strategy OS v0.1 Brief Prototype
echo ==============================================
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Python launcher py.exe was not found.
  >>"%LOG%" echo [FAIL] Python launcher py.exe was not found.
  goto :fail
)

echo [1/6] Install prototype dependencies
py -3 -m pip install -r brief_output\requirements.txt >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] Dependency installation failed.
  goto :fail
)

echo [2/6] Select CENTRAL appraisal PDF
for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select CENTRAL appraisal PDF'; $d.Filter='PDF files (*.pdf)|*.pdf'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}"`) do set "CENTRAL=%%F"
if not defined CENTRAL (
  echo [CANCELLED] CENTRAL PDF was not selected.
  >>"%LOG%" echo [CANCELLED] CENTRAL PDF was not selected.
  goto :fail
)

echo [3/6] Select JUNGHAE appraisal PDF
for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select JUNGHAE appraisal PDF'; $d.Filter='PDF files (*.pdf)|*.pdf'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}"`) do set "JUNGHAE=%%F"
if not defined JUNGHAE (
  echo [CANCELLED] JUNGHAE PDF was not selected.
  >>"%LOG%" echo [CANCELLED] JUNGHAE PDF was not selected.
  goto :fail
)

>>"%LOG%" echo CENTRAL=%CENTRAL%
>>"%LOG%" echo JUNGHAE=%JUNGHAE%

echo [4/6] Run PyMuPDF word-layout extraction with parser fallback
py -3 -m brief_output.run_prototype_resilient_v2 --central "%CENTRAL%" --junghae "%JUNGHAE%" --output prototype-output >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] Prototype analysis failed.
  goto :fail
)

echo [5/6] Build selective OCR queue for likely subject valuation pages
py -3 -m brief_output.selective_ocr_queue --central "%CENTRAL%" --junghae "%JUNGHAE%" --output prototype-output >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] Selective OCR queue failed.
  goto :fail
)

echo [6/6] Save pre-filter layout diagnostics
py -3 -m brief_output.run_layout_diagnostics --central "%CENTRAL%" --junghae "%JUNGHAE%" --output prototype-output >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] Layout diagnostics failed.
  goto :fail
)

start "" "%CD%\prototype-output"
echo.
echo [DONE] Prototype output created.
echo   prototype-output\semantic_tables.json
echo   prototype-output\raw_layout_lines.json
echo   prototype-output\table_blocks_before_filter.json
echo   prototype-output\extraction_result.json
echo   prototype-output\standard_to_comp_case_factor_comparisons.json
echo   prototype-output\selective_ocr_queue.json
echo   prototype-output\selective-ocr-pages\
echo   prototype-output\bso_brief_output_v0.1.json
echo   prototype-output\qa_report.json
echo   prototype-output\run.log
>>"%LOG%" echo [DONE] Completed: %DATE% %TIME%
pause
exit /b 0

:fail
echo.
echo [FAIL] Execution stopped. The window will remain open.
echo Log file:
echo   %LOG%
echo.
type "%LOG%"
echo.
pause
exit /b 1
