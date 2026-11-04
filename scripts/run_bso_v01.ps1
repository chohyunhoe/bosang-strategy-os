[CmdletBinding()]
param(
    [ValidateSet("Menu", "Sillim", "Gwangmyeong")]
    [string]$Mode = "Menu",
    [switch]$DryRun,
    [string]$PrimePdf,
    [string]$LinePdf,
    [string]$ShapefilePath,
    [string]$PdfPassword,
    [switch]$NoUi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BsoRoot = Join-Path $RepoRoot "bso"
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunRoot = Join-Path $RepoRoot ("output\runs\" + $RunId)
$LogPath = Join-Path $RunRoot "run.log"
$Script:FormsLoaded = $false

function Import-Forms {
    if ($Script:FormsLoaded) { return }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $Script:FormsLoaded = $true
}

function Show-Info([string]$Message) {
    Write-Host $Message
    if (-not $DryRun -and -not $NoUi) {
        Import-Forms
        [void][System.Windows.Forms.MessageBox]::Show(
            $Message,
            "보상전략 OS v0.1",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
    }
}

function Show-ErrorMessage([string]$Message) {
    Write-Host $Message -ForegroundColor Red
    if (-not $DryRun -and -not $NoUi) {
        Import-Forms
        [void][System.Windows.Forms.MessageBox]::Show(
            $Message,
            "보상전략 OS v0.1 — 실행 중단",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    }
}

function Select-InputFile([string]$Title, [string]$Filter) {
    Import-Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = $Title
    $dialog.Filter = $Filter
    $dialog.Multiselect = $false
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "사용자가 파일 선택을 취소했습니다."
    }
    return $dialog.FileName
}

function Select-InputFolder([string]$Description) {
    Import-Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Description
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "사용자가 폴더 선택을 취소했습니다."
    }
    return $dialog.SelectedPath
}

function Read-Secret([string]$Title, [string]$Prompt) {
    if ($PdfPassword -and $Title -like "*PDF*") { return $PdfPassword }
    Import-Forms
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Title
    $form.StartPosition = "CenterScreen"
    $form.ClientSize = New-Object System.Drawing.Size(450, 145)
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Prompt
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(18, 18)
    $form.Controls.Add($label)

    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point(20, 50)
    $box.Size = New-Object System.Drawing.Size(408, 24)
    $box.UseSystemPasswordChar = $true
    $form.Controls.Add($box)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "확인"
    $ok.Location = New-Object System.Drawing.Point(270, 95)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $ok
    $form.Controls.Add($ok)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "취소"
    $cancel.Location = New-Object System.Drawing.Point(352, 95)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancel
    $form.Controls.Add($cancel)

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($box.Text)) {
        throw "필수 보안정보 입력이 취소되었습니다."
    }
    return $box.Text
}

function Select-RunMode {
    Import-Forms
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "보상전략 OS v0.1"
    $form.StartPosition = "CenterScreen"
    $form.ClientSize = New-Object System.Drawing.Size(540, 235)
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "실행할 검증을 선택하세요."
    $title.Font = New-Object System.Drawing.Font("Malgun Gothic", 13, [System.Drawing.FontStyle]::Bold)
    $title.AutoSize = $true
    $title.Location = New-Object System.Drawing.Point(24, 22)
    $form.Controls.Add($title)

    $combo = New-Object System.Windows.Forms.ComboBox
    $combo.DropDownStyle = "DropDownList"
    $combo.Font = New-Object System.Drawing.Font("Malgun Gothic", 10)
    $combo.Location = New-Object System.Drawing.Point(28, 68)
    $combo.Size = New-Object System.Drawing.Size(480, 28)
    [void]$combo.Items.Add("신림동 1513-2 — PDF 분석·역산·지도·2페이지 PDF")
    [void]$combo.Items.Add("광명시흥 과림동 — 지적도 검증·지도·2페이지 PDF")
    $combo.SelectedIndex = 0
    $form.Controls.Add($combo)

    $note = New-Object System.Windows.Forms.Label
    $note.Text = "원문과 비밀번호·API Key는 로컬에서만 처리하며 저장소에 포함하지 않습니다."
    $note.AutoSize = $true
    $note.Location = New-Object System.Drawing.Point(28, 115)
    $form.Controls.Add($note)

    $run = New-Object System.Windows.Forms.Button
    $run.Text = "실행"
    $run.Size = New-Object System.Drawing.Size(100, 34)
    $run.Location = New-Object System.Drawing.Point(300, 170)
    $run.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $run
    $form.Controls.Add($run)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "취소"
    $cancel.Size = New-Object System.Drawing.Size(100, 34)
    $cancel.Location = New-Object System.Drawing.Point(408, 170)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancel
    $form.Controls.Add($cancel)

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "사용자가 실행을 취소했습니다."
    }
    if ($combo.SelectedIndex -eq 0) { return "Sillim" }
    return "Gwangmyeong"
}

function Write-RunLog([string]$Message) {
    if ($DryRun) {
        Write-Host $Message
        return
    }
    $stamp = Get-Date -Format "HH:mm:ss"
    Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f $stamp, $Message) -Encoding UTF8
}

function Invoke-LoggedStep([string]$Name, [string]$Executable, [string[]]$Arguments) {
    Write-Host ("[진행] " + $Name)
    Write-RunLog ("START " + $Name)
    if ($DryRun) {
        Write-Host ("  실행 파일: " + $Executable)
        return
    }
    $previousErrorAction = $ErrorActionPreference
    try {
        # QGIS/GDAL writes FutureWarning messages to stderr even on exit code 0.
        # Judge native success by its exit code, not by PowerShell ErrorRecord wrapping.
        $ErrorActionPreference = "Continue"
        $stepOutput = & $Executable @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($null -ne $stepOutput) {
        $stepOutput | ForEach-Object { Add-Content -LiteralPath $LogPath -Value ([string]$_) -Encoding UTF8 }
    }
    if ($exitCode -ne 0) {
        throw ("{0} 단계가 중단되었습니다. 오류코드: {1}" -f $Name, $exitCode)
    }
    Write-RunLog ("PASS " + $Name)
}

function Resolve-Python {
    $candidates = @(
        (Join-Path $RepoRoot ".venv\Scripts\python.exe"),
        (Join-Path $BsoRoot ".venv\Scripts\python.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    $systemPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($systemPython) { return $systemPython.Source }
    throw "Python이 설치되어 있지 않습니다. Python 3.11 이상을 먼저 설치하세요."
}

function Ensure-PythonEnvironment {
    $python = Resolve-Python
    if ($DryRun) { return $python }
    # Do not let dependency warnings become function return values. PowerShell
    # otherwise combines the warning text with the executable path.
    $null = & $python -c "import pymupdf" 2>$null
    if ($LASTEXITCODE -eq 0) { return $python }

    $venvRoot = Join-Path $BsoRoot ".venv"
    $systemPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $systemPython) {
        throw "PyMuPDF 실행환경이 없고 Python을 찾을 수 없습니다."
    }
    Invoke-LoggedStep "로컬 Python 환경 준비" $systemPython.Source @("-m", "venv", $venvRoot)
    $python = Join-Path $venvRoot "Scripts\python.exe"
    Invoke-LoggedStep "필수 구성요소 설치" $python @("-m", "pip", "install", "-r", (Join-Path $BsoRoot "requirements.txt"))
    return $python
}

function Ensure-Tesseract {
    $tesseract = Get-Command tesseract.exe -ErrorAction SilentlyContinue
    if (-not $tesseract) {
        $common = "C:\Program Files\Tesseract-OCR\tesseract.exe"
        if (Test-Path -LiteralPath $common -PathType Leaf) {
            $env:BSO_TESSERACT_CMD = $common
            $tesseractPath = $common
        } else {
            throw "한글 OCR용 Tesseract가 없습니다. Tesseract OCR을 먼저 설치하세요."
        }
    } else {
        $tesseractPath = $tesseract.Source
        $env:BSO_TESSERACT_CMD = $tesseractPath
    }

    $tessdataCandidates = @(
        (Join-Path $RepoRoot "tmp\tessdata"),
        (Join-Path (Split-Path $tesseractPath -Parent) "tessdata")
    )
    foreach ($candidate in $tessdataCandidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate "kor.traineddata") -PathType Leaf) {
            $env:TESSDATA_PREFIX = $candidate
            return
        }
    }
    throw "한글 OCR 데이터(kor.traineddata)가 없습니다. Tesseract tessdata 폴더에 추가하세요."
}

function Ensure-GraphicsEnvironment {
    $envPath = Join-Path $BsoRoot ".env"
    $settings = [ordered]@{}
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
        foreach ($rawLine in Get-Content -LiteralPath $envPath -Encoding UTF8) {
            $line = ([string]$rawLine).Trim().TrimStart([char]0xFEFF)
            if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
            $parts = $line.Split("=", 2)
            $name = $parts[0].Trim().TrimStart([char]0xFEFF)
            if ($name) { $settings[$name] = $parts[1].Trim() }
        }
    }

    if (-not $settings.Contains("VWORLD_API_KEY") -or [string]::IsNullOrWhiteSpace($settings["VWORLD_API_KEY"])) {
        if ($DryRun) {
            Write-Host "[확인 필요] 첫 실행에서 VWorld API Key를 입력합니다."
            return
        }
        $settings["VWORLD_API_KEY"] = Read-Secret "VWorld API Key" "로컬에서 사용할 VWorld API Key를 입력하세요."
    }
    if (-not $settings.Contains("QGIS_ROOT") -or [string]::IsNullOrWhiteSpace($settings["QGIS_ROOT"])) {
        $settings["QGIS_ROOT"] = "C:\Program Files\QGIS 4.2.0"
    }
    $qgisRoot = [string]$settings["QGIS_ROOT"]
    if (-not (Test-Path -LiteralPath $qgisRoot -PathType Container)) {
        if ($DryRun) { throw "QGIS 설치 폴더를 찾을 수 없습니다: $qgisRoot" }
        $qgisRoot = Select-InputFolder "QGIS 설치 폴더를 선택하세요."
        $settings["QGIS_ROOT"] = $qgisRoot
    }

    $env:VWORLD_API_KEY = [string]$settings["VWORLD_API_KEY"]
    $env:QGIS_ROOT = [string]$settings["QGIS_ROOT"]
    if ($DryRun) {
        Write-Host "[PASS] VWorld API Key·QGIS 로컬 설정 확인"
        return
    }

    $lines = @($settings.Keys | ForEach-Object { "$_=$($settings[$_])" })
    [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Assert-File([string]$Path, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw ($Label + " 파일을 찾을 수 없습니다.")
    }
}

function Assert-SiheungSidecars([string]$ShpPath) {
    Assert-File $ShpPath "시흥시 SHP"
    $base = [System.IO.Path]::Combine(
        [System.IO.Path]::GetDirectoryName($ShpPath),
        [System.IO.Path]::GetFileNameWithoutExtension($ShpPath)
    )
    $paths = @()
    foreach ($extension in @(".shp", ".shx", ".dbf", ".prj", ".cpg")) {
        $path = $base + $extension
        Assert-File $path ("지적도 부속파일 " + $extension)
        $paths += $path
    }
    return $paths
}

function Prepare-SiheungArchive([string]$ShpPath) {
    $sidecars = Assert-SiheungSidecars $ShpPath
    $archive = Join-Path $BsoRoot "graphics-input\source\LSMD_CONT_LDREG_5174_경기_시흥시.zip"
    if ($DryRun) {
        Write-Host ("[PASS] 필수 지적도 파일 5개 확인: " + (Split-Path $ShpPath -Parent))
        Write-Host ("[예정] 로컬 검증용 ZIP: " + $archive)
        return $archive
    }
    $archiveDir = Split-Path $archive -Parent
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    $tempArchive = Join-Path $RunRoot "siheung-cadastral.zip"
    Compress-Archive -LiteralPath $sidecars -DestinationPath $tempArchive -CompressionLevel Optimal
    Move-Item -LiteralPath $tempArchive -Destination $archive -Force
    Write-RunLog "PASS 시흥시 지적도 필수파일 5개 패키징"
    return $archive
}

function Assert-TrialPass([string]$ManifestPath) {
    $trial = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $trial.all_trial_usable) {
        throw "PDF 분석 결과에 검토 불가 항목이 있어 지도·최종 PDF 생성을 차단했습니다."
    }
    if (-not $trial.golden_all_valid) {
        throw "신림 Ground Truth 14개 항목 중 불일치가 있어 지도·최종 PDF 생성을 차단했습니다."
    }
}

function Run-Sillim([string]$Python) {
    if (-not $PrimePdf) { $script:PrimePdf = Select-InputFile "프라임 감정평가서 PDF 선택" "PDF 파일 (*.pdf)|*.pdf" }
    if (-not $LinePdf) { $script:LinePdf = Select-InputFile "라인 감정평가서 PDF 선택" "PDF 파일 (*.pdf)|*.pdf" }
    Assert-File $PrimePdf "프라임 감정평가서"
    Assert-File $LinePdf "라인 감정평가서"
    Ensure-Tesseract
    Ensure-GraphicsEnvironment

    $geometryArchive = Join-Path $BsoRoot "graphics-input\source\AL_D002_11_20260719.zip"
    if (-not (Test-Path -LiteralPath $geometryArchive -PathType Leaf)) {
        if ($DryRun) {
            Write-Host "[확인 필요] 신림동 연속지적도 ZIP이 필요합니다."
        } else {
            $selected = Select-InputFile "신림동 연속지적도 ZIP 선택" "ZIP 파일 (*.zip)|*.zip"
            New-Item -ItemType Directory -Path (Split-Path $geometryArchive -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $selected -Destination $geometryArchive
        }
    }

    if (-not $DryRun) {
        $env:BSO_PDF_PASSWORD = Read-Secret "PDF 비밀번호" "두 감정평가서의 PDF 비밀번호를 입력하세요."
    }
    $env:PYTHONPATH = Join-Path $BsoRoot "src"
    $parserOut = Join-Path $RunRoot "parser"
    $expected = Join-Path $BsoRoot "fixtures\golden_cases\sillim_1513_2\expected_e2e.json"
    Invoke-LoggedStep "PDF 분석·산식·역산 검증" $Python @(
        (Join-Path $BsoRoot "run_trial_batch.py"),
        ("프라임=" + $PrimePdf),
        ("라인=" + $LinePdf),
        "--output-dir", $parserOut,
        "--expected", $expected,
        "--target-dong", "신림동",
        "--target-lot", "1513-2"
    )
    if ($DryRun) { return }
    Assert-TrialPass (Join-Path $parserOut "trial_manifest.json")

    $generatedManifest = Join-Path $RunRoot "sillim.generated.json"
    Invoke-LoggedStep "검증 지도 입력 연결" $Python @(
        (Join-Path $BsoRoot "build_sample_brief_manifest.py"),
        (Join-Path $BsoRoot "graphics-input\sillim_1513_2.json"),
        ("프라임=" + (Join-Path $parserOut "프라임.canonical.json")),
        ("라인=" + (Join-Path $parserOut "라인.canonical.json")),
        "--output", $generatedManifest
    )
    $graphicsRoot = Join-Path $RunRoot "graphics"
    Invoke-LoggedStep "PNU·지적도·지도·2페이지 PDF 생성" (Join-Path $BsoRoot "RUN_GRAPHICS_GATE.cmd") @($generatedManifest, $graphicsRoot)

    $finalPdf = Join-Path $graphicsRoot "SILLIM_1513_2\final_sample_brief.pdf"
    Assert-File $finalPdf "최종 신림 검증 PDF"
    if (-not $NoUi) {
        Start-Process explorer.exe -ArgumentList @("/select,`"$finalPdf`"")
    }
    Show-Info ("완료되었습니다.`n`n신림 검증: 14/14 Ground Truth 통과 후 지도·2페이지 PDF 생성`n결과: " + $finalPdf)
}

function Run-Gwangmyeong([string]$Python) {
    if (-not $ShapefilePath) {
        $script:ShapefilePath = Select-InputFile "시흥시 연속지적도 SHP 선택" "Shapefile (*.shp)|*.shp"
    }
    [void](Prepare-SiheungArchive $ShapefilePath)
    Ensure-GraphicsEnvironment
    $env:PYTHONPATH = Join-Path $BsoRoot "src"
    if ($DryRun) { return }

    $graphicsRoot = Join-Path $RunRoot "graphics"
    $manifest = Join-Path $BsoRoot "graphics-input\gwangmyeong_siheung.json"
    Invoke-LoggedStep "PNU·지적도·지도·2페이지 PDF 생성" (Join-Path $BsoRoot "RUN_GRAPHICS_GATE.cmd") @($manifest, $graphicsRoot)

    $finalPdf = Join-Path $graphicsRoot "GMSH_GWARIM_120_7_120_8\final_sample_brief.pdf"
    Assert-File $finalPdf "최종 광명시흥 검증 PDF"
    if (-not $NoUi) {
        Start-Process explorer.exe -ArgumentList @("/select,`"$finalPdf`"")
    }
    Show-Info ("완료되었습니다.`n`n페이지 1: 대상토지·비교표준지 검증 지도`n페이지 2: 사례 지번 마스킹으로 위치도 생성 불가 표시`n결과: " + $finalPdf)
}

try {
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
        Write-RunLog "보상전략 OS v0.1 실행 시작"
    }
    if ($Mode -eq "Menu") { $Mode = Select-RunMode }
    $python = Ensure-PythonEnvironment
    if ($Mode -eq "Sillim") {
        Run-Sillim $python
    } else {
        Run-Gwangmyeong $python
    }
    if ($DryRun) { Write-Host "[PASS] 실행기 사전점검 완료" }
    exit 0
} catch {
    $safeMessage = [string]$_.Exception.Message
    if (-not $DryRun) {
        Write-RunLog ("FAIL " + $safeMessage)
        $safeMessage += "`n`n실행 기록: " + $LogPath
    }
    Show-ErrorMessage $safeMessage
    exit 1
} finally {
    $env:BSO_PDF_PASSWORD = $null
    $PdfPassword = $null
}
