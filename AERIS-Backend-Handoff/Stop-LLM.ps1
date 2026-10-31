$ErrorActionPreference='Stop'
$state=Join-Path $PSScriptRoot 'logs\owned-process.json'
if(-not(Test-Path -LiteralPath $state)){Write-Host 'No owned LLM process recorded.';return}
$record=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
$process=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if(-not $process){Write-Host 'The recorded LLM process has already stopped.';return}
$expected=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runtime\llama-server.exe'))
if($process.Path -ne $expected -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$record.startTimeUtc).ToUniversalTime().Ticks){throw 'PID identity changed; refusing to stop an unrelated process.'}
Stop-Process -Id $process.Id -Force
Write-Host 'Stopped the LLM process owned by this folder.'
