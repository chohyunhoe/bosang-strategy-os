[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [string]$DesktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory),
    [string]$StartMenuDirectory = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)) 'BSO')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repoRoot 'RUN_BSO.cmd'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw 'RUN_BSO.cmd is missing. Run this installer from the complete BSO folder.'
}
if (-not $DesktopDirectory -or -not $StartMenuDirectory) {
    throw 'Desktop or Start menu location is unavailable.'
}
$managedDescription = 'BSO local workspace launcher (managed shortcut)'
$folders = @($DesktopDirectory, $StartMenuDirectory) | ForEach-Object { [IO.Path]::GetFullPath($_) } | Select-Object -Unique
$helper = Join-Path $PSScriptRoot 'windows_shortcut.cs'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The BSO shortcut helper is missing.' }
if (-not ('BSO.WindowsShortcut' -as [type])) { Add-Type -Path $helper }
    # Preflight all destinations. Do not replace unrelated user shortcuts.
    foreach ($folder in $folders) {
        if ((Test-Path -LiteralPath $folder) -and -not (Test-Path -LiteralPath $folder -PathType Container)) {
            throw 'A shortcut destination is a file instead of a folder.'
        }
        $linkPath = Join-Path $folder 'BSO.lnk'
        if (Test-Path -LiteralPath $linkPath) {
            if (-not (Test-Path -LiteralPath $linkPath -PathType Leaf)) { throw 'BSO.lnk is not a file.' }
            $existing = [BSO.WindowsShortcut]::Read($linkPath)
            if ($existing.Description -ne $managedDescription) {
                throw ('BSO shortcut already exists and is not managed: ' + $linkPath + '. Rename it before installing.')
            }
        }
    }
    foreach ($folder in $folders) {
        $linkPath = Join-Path $folder 'BSO.lnk'
        if ($PSCmdlet.ShouldProcess($linkPath, 'Create or update BSO shortcut')) {
            if (-not (Test-Path -LiteralPath $folder)) { [void](New-Item -ItemType Directory -Path $folder -Force) }
            [BSO.WindowsShortcut]::Write($linkPath, $launcher, $repoRoot, $managedDescription)
            Write-Host ('[BSO] Shortcut ready: ' + $linkPath)
        }
    }
Write-Host '[BSO] Open BSO from the desktop or Windows Start search.'
Write-Host '[BSO] Shortcuts start the existing local launcher; they do not install runtimes or start BSO now.'
