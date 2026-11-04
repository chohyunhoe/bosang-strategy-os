[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envCandidates = @(
    (Join-Path $repoRoot 'bso\.env'),
    (Join-Path $repoRoot '.env')
)
$envFile = $envCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

if (-not $envFile) {
    throw 'ENV_FILE_MISSING'
}

$pairs = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $index = $trimmed.IndexOf('=')
    if ($index -lt 1) { continue }
    $name = $trimmed.Substring(0, $index).Trim()
    $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
    $pairs[$name] = $value
}

$key = [string]$pairs['VWORLD_API_KEY']
if ([string]::IsNullOrWhiteSpace($key)) {
    throw 'VWORLD_API_KEY_MISSING'
}

$domain = [string]$pairs['VWORLD_API_DOMAIN']
if ([string]::IsNullOrWhiteSpace($domain)) { $domain = 'localhost' }

$query = [System.Web.HttpUtility]::ParseQueryString('')
$query['service'] = 'image'
$query['version'] = '2.0'
$query['request'] = 'getmap'
$query['format'] = 'png'
$query['basemap'] = 'PHOTO'
$query['crs'] = 'EPSG:4326'
$query['zoom'] = '8'
$query['size'] = '256,256'
$query['center'] = '127.0000,36.5000'
$query['key'] = $key
$query['domain'] = $domain
$uri = 'https://api.vworld.kr/req/image?' + $query.ToString()

try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 20 -Headers @{ Accept = 'image/png' }
    $contentType = [string]$response.Headers['Content-Type']
    $byteCount = [int64]$response.RawContentLength
    $ok = $response.StatusCode -eq 200 -and $contentType.StartsWith('image/png') -and $byteCount -gt 0
    [pscustomobject]@{
        ok = $ok
        status = [int]$response.StatusCode
        content_type = $contentType
        byte_count = $byteCount
        error_code = if ($ok) { $null } else { 'VWORLD_PROBE_REJECTED' }
        secrets_exposed = $false
        request_profile = 'FIXED_NON_CASE_COORDINATE'
    } | ConvertTo-Json -Compress
    if (-not $ok) { exit 1 }
}
catch {
    [pscustomobject]@{
        ok = $false
        error_code = 'VWORLD_DIRECT_PROBE_FAILED'
        diagnostic = $_.Exception.GetType().Name
        secrets_exposed = $false
        request_profile = 'FIXED_NON_CASE_COORDINATE'
    } | ConvertTo-Json -Compress
    exit 1
}
