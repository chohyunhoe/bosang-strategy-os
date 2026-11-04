[CmdletBinding()]
param(
    [int]$Port = 4174,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

function Write-Step([string]$Message) { Write-Host ("[BSO] " + $Message) -ForegroundColor Cyan }
function Write-Note([string]$Message) { Write-Host ("      " + $Message) -ForegroundColor DarkGray }
function Fail([string]$Message) { Write-Host ("[FAIL] " + $Message) -ForegroundColor Red; exit 1 }

function Resolve-SystemPython {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) { return @{ Exe=$python.Source; Prefix=@() } }
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return @{ Exe=$py.Source; Prefix=@('-3') } }
    return $null
}

function Invoke-Native {
    param(
        [Parameter(Mandatory=$true)][string]$Label,
        [Parameter(Mandatory=$true)][string]$Exe,
        [Parameter(Mandatory=$true)][string[]]$ArgumentList
    )
    Write-Step $Label
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Exe @ArgumentList
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($exitCode -ne 0) { Fail ("$Label failed (exit $exitCode)") }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js LTS is required. node.exe was not found.' }
if (-not $npm) { Fail 'npm was not found.' }

Write-Step 'Checking BSO v2.1 runtime'
Write-Note 'QGIS and local cadastral files are optional. BSO must start without them.'
Write-Note 'VWorld quick maps use a browser-session API key and do not require QGIS.'
Write-Note 'QGIS/지적원본은 선택 기능이며 VWorld API 빠른지도는 별도 지적파일 없이 사용할 수 있습니다.'
Write-Note '현장선별·신규사업·RTMS·건축물대장 기능은 필요한 로컬 API 설정이 있을 때만 사용합니다.'

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules') -PathType Container)) {
    Invoke-Native -Label 'Installing Node packages' -Exe $npm.Source -ArgumentList @('ci')
} else {
    Write-Step 'Node packages OK'
}

$venvPython = Join-Path $RepoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    $systemPython = Resolve-SystemPython
    if (-not $systemPython) { Fail 'Python 3 was not found.' }
    Write-Step 'Creating local Python virtual environment'
    $createVenvArgs = @($systemPython.Prefix) + @('-m','venv',(Join-Path $RepoRoot '.venv'))
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $systemPython.Exe @createVenvArgs
        $venvExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($venvExit -ne 0) { Fail 'Python virtual environment creation failed.' }
}

$requiredImports = 'import pydantic, docx, openpyxl, fitz, pypdf'
$previousErrorAction = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $venvPython -c $requiredImports *> $null
    $importExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorAction
}
if ($importExit -ne 0) {
    Invoke-Native -Label 'Installing report and spreadsheet Python modules' -Exe $venvPython -ArgumentList @('-m','pip','install','-r',(Join-Path $RepoRoot 'brief_output\requirements.txt'))
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $venvPython -c $requiredImports *> $null
        $verifyExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($verifyExit -ne 0) { Fail 'Python report modules are still unavailable after installation.' }
} else {
    Write-Step 'Report and spreadsheet Python modules OK'
}

$env:PYTHON = $venvPython
$env:PYTHON3 = $venvPython

$envPath = Join-Path $RepoRoot '.env'
if (Test-Path -LiteralPath $envPath -PathType Leaf) {
    Write-Step 'Local .env detected'
} else {
    Write-Step 'No .env detected; core BSO will still start'
    Write-Note 'PUBLIC_DATA_API_KEY is required only for field screening, G2B, RTMS and building ledger APIs.'
    Write-Note 'VWorld quick maps can use a browser-session key from the map screen.'
}

Invoke-Native -Label 'Building Product v2.1 local release' -Exe $npm.Source -ArgumentList @('run','release:v2.1:build')

Write-Step 'Running local capability and security self-check'
$previousErrorAction = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $node.Source (Join-Path $RepoRoot 'scripts\check_v2_1_local_capabilities.js')
    $selfCheckExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorAction
}
if ($selfCheckExit -ne 0) { Fail 'Security self-check failed. Server will not start.' }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '===============================================' -ForegroundColor DarkCyan
Write-Host '  BSO v2.1.2 Unified Workspace READY' -ForegroundColor Green
Write-Host ("  " + $url) -ForegroundColor Green
Write-Host '  PDF/OCR | Review | API Map | Field Screening' -ForegroundColor Gray
Write-Host '  G2B | RTMS | Building Ledger | DOCX/XLSX/CSV' -ForegroundColor Gray
Write-Host '===============================================' -ForegroundColor DarkCyan
Write-Host ''

if (-not $NoBrowser) {
    $browserCommand = "Start-Sleep -Seconds 2; Start-Process '$url'"
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',$browserCommand | Out-Null
}

Write-Step 'Starting local BSO server. Close this window to stop it.'
Write-Note 'The server binds to 127.0.0.1 only.'
& $node.Source (Join-Path $RepoRoot 'scripts\serve_product_v2.js') (Join-Path $RepoRoot 'dist\product-v2-1-release') $Port
exit $LASTEXITCODE
