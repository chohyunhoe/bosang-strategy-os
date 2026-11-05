Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$name = 'BSO shortcut ' + [char]0xD55C + [char]0xAE00 + " & apostrophe' " + [Guid]::NewGuid().ToString('N')
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) $name
$repo = Join-Path $temporaryRoot 'repo'
$desktop = Join-Path $temporaryRoot 'desktop'
$programs = Join-Path $temporaryRoot 'programs'
$shell = New-Object -ComObject WScript.Shell
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    [void](New-Item -ItemType Directory -Path (Join-Path $repo 'scripts') -Force)
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'scripts\install_bso_shortcuts.ps1') -Destination (Join-Path $repo 'scripts\install_bso_shortcuts.ps1')
    $launcher = Join-Path $repo 'RUN_BSO.cmd'
    [IO.File]::WriteAllText($launcher, "@echo off`r`nexit /b 0`r`n", [Text.Encoding]::ASCII)
    $installer = Join-Path $repo 'scripts\install_bso_shortcuts.ps1'
    & $installer -DesktopDirectory $desktop -StartMenuDirectory $programs -WhatIf
    Assert (-not (Test-Path -LiteralPath $desktop)) 'WhatIf must not create a desktop folder.'
    & $installer -DesktopDirectory $desktop -StartMenuDirectory $programs
    foreach ($folder in @($desktop, $programs)) {
        $link = $shell.CreateShortcut((Join-Path $folder 'BSO.lnk'))
        try {
            Assert ($link.TargetPath -eq $launcher) 'Shortcut target must preserve the exact launcher path.'
            Assert ($link.WorkingDirectory -eq $repo) 'Shortcut working directory must be the BSO folder.'
            Assert ([string]::IsNullOrEmpty($link.Arguments)) 'A shortcut must not inject shell arguments.'
        } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
    }
    & $installer -DesktopDirectory $desktop -StartMenuDirectory $programs
    Assert (@(Get-ChildItem -LiteralPath $desktop).Count -eq 1) 'Repeat installation must not create duplicate shortcuts.'

    $conflictFolder = Join-Path $temporaryRoot 'conflict'
    [void](New-Item -ItemType Directory -Path $conflictFolder)
    $conflict = $shell.CreateShortcut((Join-Path $conflictFolder 'BSO.lnk'))
    $conflict.TargetPath = Join-Path $env:SystemRoot 'System32\notepad.exe'
    $conflict.Description = 'UNRELATED'
    $conflict.Save()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($conflict)
    $newDesktop = Join-Path $temporaryRoot 'must-not-be-created'
    $rejected = $false
    try { & $installer -DesktopDirectory $newDesktop -StartMenuDirectory $conflictFolder }
    catch { $rejected = $_.Exception.Message -match 'not managed' }
    Assert $rejected 'An unrelated existing shortcut must be rejected.'
    Assert (-not (Test-Path -LiteralPath $newDesktop)) 'All destinations must be checked before writing.'
    Write-Host 'Windows shortcuts passed: real .lnk targets, Unicode/spaced paths, repeat setup, dry run, conflict protection.'
} finally {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
