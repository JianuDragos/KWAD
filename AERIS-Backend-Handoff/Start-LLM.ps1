param([int]$Port=18090)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'model.json') -Raw | ConvertFrom-Json
$exe=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runtime\llama-server.exe'))
$model=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $config.localFile))
if(-not(Test-Path -LiteralPath $exe) -or -not(Test-Path -LiteralPath $model)){throw 'Runtime or model is missing. Extract the complete offline package first.'}
if($Port -lt 1024 -or $Port -gt 65535){throw 'Choose a port between 1024 and 65535.'}
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port){throw "Port $Port is occupied. This script will not reuse or terminate another server."}
$logs=Join-Path $PSScriptRoot 'logs';New-Item -ItemType Directory -Force $logs | Out-Null
$arguments='-m "{0}" -c 8192 -ngl 0 -t 8 -tb 8 --parallel 1 --host 127.0.0.1 --port {1} --alias aeris-local --jinja --no-webui --offline --cache-ram 0' -f $model,$Port
$process=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'llm.stdout.log') -RedirectStandardError (Join-Path $logs 'llm.stderr.log')
try {
$record=@{pid=$process.Id;startTimeUtc=$process.StartTime.ToUniversalTime().ToString('o');executable=$exe;port=$Port}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'owned-process.json') -Encoding utf8
$timer=[Diagnostics.Stopwatch]::StartNew()
    $ready=$false
    while($timer.Elapsed.TotalSeconds -lt 120){
        $process.Refresh();if($process.HasExited){throw "LLM exited with code $($process.ExitCode). See logs/llm.stderr.log."}
        try {$health=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2;if($health.status -eq 'ok'){$ready=$true;break}}catch{}
        Start-Sleep -Milliseconds 300
    }
    if(-not $ready){throw 'Model was not ready within 120 seconds.'}
    Write-Host "Ready: http://127.0.0.1:$Port/v1/chat/completions | model: aeris-local | CPU ARM64"
    Write-Host 'Stop with .\Stop-LLM.ps1. First run is local; no model download is needed.'
}catch{
    if(-not $process.HasExited){Stop-Process -Id $process.Id -Force}
    throw
}
