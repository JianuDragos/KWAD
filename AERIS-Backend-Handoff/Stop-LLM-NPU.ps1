$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot 'logs\owned-geniex-process.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'No owned GenieX process recorded.'; return }

$record = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if (-not $process) { Write-Host 'The recorded GenieX process has already stopped.'; return }

$expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GenieX CLI\geniex.exe'))
if ($process.Path -ne $expected -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$record.startTimeUtc).ToUniversalTime().Ticks) {
    throw 'Process identity changed; refusing to stop an unrelated process.'
}

Stop-Process -Id $process.Id -Force
Write-Host 'Stopped the GenieX process owned by this folder.'
