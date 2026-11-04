[CmdletBinding()]
param(
    [ValidateRange(1024,65535)][int]$Port = 4174,
    [switch]$NoBrowser,
    [switch]$CheckOnly,
    [switch]$SetupOutput
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot
function Step([string]$Message) { Write-Host ("[BSO v1] " + $Message) -ForegroundColor Cyan }
function Fail([string]$Message) { Write-Host ("[FAIL] " + $Message) -ForegroundColor Red; exit 1 }
function Test-Python([string]$Exe, [string[]]$Prefix = @(), [string]$Code = 'import sys; assert sys.version_info >= (3, 10)') {
    if (-not $Exe) { return $false }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Exe @Prefix -c $Code *> $null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false } finally { $ErrorActionPreference = $prior }
}

# Optional machine-local paths. This file contains no credentials and is gitignored.
$localConfig = @{}
$configPath = Join-Path $RepoRoot '.bso-runtime.json'
if (Test-Path -LiteralPath $configPath) {
    try {
        $parsed = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        foreach ($name in @('node','python')) {
            if ($parsed.PSObject.Properties.Name -contains $name) { $localConfig[$name] = [string]$parsed.$name }
        }
    } catch { Fail 'Invalid .bso-runtime.json. Correct the local runtime paths.' }
}
$nodeCandidates = @($env:BSO_NODE, $localConfig['node'])
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
$node = $null
foreach ($candidate in $nodeCandidates) {
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $nodeVersion = & $candidate --version
        if ($LASTEXITCODE -eq 0 -and [version]($nodeVersion.TrimStart('v')) -ge [version]'22.0.0') { $node = $candidate; break }
    } catch {} finally { $ErrorActionPreference = $prior }
}
if (-not $node) { Fail 'Node.js 22 or newer is required. Install Node.js LTS or set BSO_NODE.' }

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules\pdfjs-dist\package.json'))) {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { Fail 'Dependencies are missing. Install Node.js LTS, then start BSO again.' }
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) { Fail 'Node dependency installation failed.' }
}

$pythonCandidates = @()
foreach ($candidate in @($env:BSO_PYTHON, (Join-Path $RepoRoot '.venv-v1\Scripts\python.exe'), $localConfig['python'], (Join-Path $RepoRoot '.venv\Scripts\python.exe'))) {
    if ($candidate) { $pythonCandidates += @{ Exe=$candidate; Prefix=@() } }
}
foreach ($name in @('py.exe','python.exe','python3.exe')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notmatch '\\WindowsApps\\') {
        $prefix = @(); if ($name -eq 'py.exe') { $prefix = @('-3') }
        $pythonCandidates += @{ Exe=$command.Source; Prefix=$prefix }
    }
}
$python = $null
foreach ($candidate in $pythonCandidates) {
    if (Test-Python -Exe $candidate.Exe -Prefix $candidate.Prefix) {
        if (-not $python) { $python = $candidate }
        if (Test-Python -Exe $candidate.Exe -Prefix $candidate.Prefix -Code 'import pydantic, docx, openpyxl') { $python = $candidate; break }
    }
}

if ($SetupOutput) {
    if (-not $python) { Fail 'Install Python 3.10 or newer, then run SETUP_BSO_OUTPUT.cmd again.' }
    $venv = Join-Path $RepoRoot '.venv-v1'
    $venvPython = Join-Path $venv 'Scripts\python.exe'
    # Repair only the v1 environment in place; preserve the existing .venv.
    if (-not (Test-Python -Exe $venvPython)) {
        Step 'Preparing the v1 report environment'
        & $python.Exe @($python.Prefix) -m venv $venv
        if ($LASTEXITCODE -ne 0) { Fail 'Report environment preparation failed.' }
    }
    & $venvPython -m pip install -r (Join-Path $RepoRoot 'brief_output\requirements.txt')
    if ($LASTEXITCODE -ne 0) { Fail 'Report dependency installation failed. Core BSO remains available.' }
    $python = @{ Exe=$venvPython; Prefix=@() }
}
if ($python) {
    # Resolve py.exe to a real interpreter path so every bridge gets the same runtime.
    $resolvedPython = & $python.Exe @($python.Prefix) -c 'import sys; print(sys.executable)'
    $env:BSO_PYTHON = [string]$resolvedPython
    $env:PYTHON = [string]$resolvedPython
    $env:PYTHON3 = [string]$resolvedPython
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    if (Test-Python -Exe $env:BSO_PYTHON -Code 'import pydantic, docx, openpyxl') {
        Step 'DOCX / XLSX / CSV runtime ready'
    } else {
        Step 'Report modules unavailable. Run SETUP_BSO_OUTPUT.cmd to prepare them.'
    }
} else {
    Step 'Python unavailable. PDF/OCR, review, case backup and API quick maps remain available.'
    Step 'DOCX/XLSX reports need SETUP_BSO_OUTPUT.cmd after Python installation.'
}

Step 'Building Release v1'
& $node (Join-Path $RepoRoot 'scripts\build_release_v1.js')
if ($LASTEXITCODE -ne 0) { Fail 'Release v1 build failed.' }
& $node (Join-Path $RepoRoot 'scripts\check_v2_1_local_capabilities.js')
if ($LASTEXITCODE -ne 0) { Fail 'Local security self-check failed.' }
if ($CheckOnly) { Step 'Startup checks completed. See capability availability above.'; exit 0 }

$url = "http://127.0.0.1:$Port/"
# Open only after this process has bound the port; never open an unrelated service.
if (-not $NoBrowser) { $env:BSO_OPEN_BROWSER = '1' } else { Remove-Item Env:BSO_OPEN_BROWSER -ErrorAction SilentlyContinue }
Step ("Starting Release v1 at " + $url)
Step 'Keep this window open. Save the case JSON before closing the browser.'
& $node (Join-Path $RepoRoot 'scripts\serve_product_v2.js') (Join-Path $RepoRoot 'dist\release-v1') $Port
exit $LASTEXITCODE
