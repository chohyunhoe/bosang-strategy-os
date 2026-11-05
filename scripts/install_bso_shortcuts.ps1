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
$shell = New-Object -ComObject WScript.Shell
try {
    # Preflight all destinations. Do not replace unrelated user shortcuts.
    foreach ($folder in $folders) {
        if ((Test-Path -LiteralPath $folder) -and -not (Test-Path -LiteralPath $folder -PathType Container)) {
            throw 'A shortcut destination is a file instead of a folder.'
        }
        $linkPath = Join-Path $folder 'BSO.lnk'
        if (Test-Path -LiteralPath $linkPath) {
            if (-not (Test-Path -LiteralPath $linkPath -PathType Leaf)) { throw 'BSO.lnk is not a file.' }
            $existing = $shell.CreateShortcut($linkPath)
            try {
                if ($existing.Description -ne $managedDescription) {
                    throw ('BSO shortcut already exists and is not managed: ' + $linkPath + '. Rename it before installing.')
                }
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($existing) }
        }
    }
    foreach ($folder in $folders) {
        $linkPath = Join-Path $folder 'BSO.lnk'
        if ($PSCmdlet.ShouldProcess($linkPath, 'Create or update BSO shortcut')) {
            if (-not (Test-Path -LiteralPath $folder)) { [void](New-Item -ItemType Directory -Path $folder -Force) }
            $shortcut = $shell.CreateShortcut($linkPath)
            $stage = 'target path'
            try {
                $shortcut.TargetPath = $launcher
                $stage = 'working directory'
                $shortcut.WorkingDirectory = $repoRoot
                $stage = 'description'
                $shortcut.Description = $managedDescription
                $stage = 'window style'
                $shortcut.WindowStyle = 1
                $stage = 'save'
                $shortcut.Save()
            } catch {
                throw ('BSO shortcut failed at ' + $stage + ': ' + $_.Exception.Message)
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
            Write-Host ('[BSO] Shortcut ready: ' + $linkPath)
        }
    }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
Write-Host '[BSO] Open BSO from the desktop or Windows Start search.'
Write-Host '[BSO] Shortcuts start the existing local launcher; they do not install runtimes or start BSO now.'
