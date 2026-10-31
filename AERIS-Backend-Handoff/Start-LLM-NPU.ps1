param([int]$Port = 18090)
$ErrorActionPreference = 'Stop'

$cli = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GenieX CLI\geniex.exe'))
$modelId = 'unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_0'
$modelPath = Join-Path $env:USERPROFILE '.cache\geniex\models\unsloth\Qwen3-4B-Instruct-2507-GGUF\Qwen3-4B-Instruct-2507-Q4_0.gguf'
$statePath = Join-Path $PSScriptRoot 'logs\owned-geniex-process.json'

if (-not (Test-Path -LiteralPath $cli)) { throw "GenieX CLI not found: $cli" }
if (-not (Test-Path -LiteralPath $modelPath)) { throw "NPU model missing. Pull it with: geniex pull $modelId" }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port between 1024 and 65535.' }

$devices = (& pnputil.exe /enum-devices /connected | Out-String)
if ($devices -notmatch 'Qualcomm\(R\) Hexagon\(TM\) NPU[\s\S]{0,400}Status:\s+Started') {
    throw 'Windows does not report a started Qualcomm Hexagon NPU device. Install/update the Qualcomm NPU driver and restart Windows.'
}

if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port) {
    throw "Port $Port is occupied. This script will not reuse or terminate another server."
}

$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$arguments = 'serve --host 127.0.0.1:{0} --model "{1}" --compute npu --nctx 4096 --ngl -1 --log info --skip-update' -f $Port, $modelId
$process = Start-Process -FilePath $cli -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'geniex.stdout.log') `
    -RedirectStandardError (Join-Path $logs 'geniex.stderr.log')

try {
    $record = @{ pid = $process.Id; startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o'); executable = $cli; port = $Port }
    $record | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($timer.Elapsed.TotalSeconds -lt 120) {
        $process.Refresh()
        if ($process.HasExited) { throw "GenieX exited with code $($process.ExitCode). See logs/geniex.stderr.log." }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($health) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw 'GenieX was not ready within 120 seconds.' }
    Write-Host "Ready: http://127.0.0.1:$Port/v1/chat/completions | model: $modelId | Hexagon NPU"
    Write-Host 'Inference runs on first request. Stop with .\Stop-LLM-NPU.ps1.'
} catch {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    throw
}
