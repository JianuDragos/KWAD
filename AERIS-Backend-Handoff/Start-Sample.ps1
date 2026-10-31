$ErrorActionPreference='Stop'
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 5088){throw 'Port 5088 is occupied. Stop the existing sample before starting another.'}
Write-Host 'Sample API: POST http://127.0.0.1:5088/api/aeris/explain. Ctrl+C stops it.'
& (Join-Path $PSScriptRoot 'demo\Sample.exe')
