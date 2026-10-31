param([Parameter(Mandatory)][string]$Exe,[Parameter(Mandatory)][string]$ModelFile,[string]$Dotnet='dotnet',[string]$Dll=(Join-Path $PSScriptRoot 'bin\Release\net10.0\win-arm64\Aeris.LocalBench.dll'),[string]$Label='qwen3-4b-cpu',[string]$ResultDir,[int]$Repeats=3,[string]$Case='all')
$ErrorActionPreference='Stop'
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 18090){throw 'Port 18090 is already in use. Stop the existing inference server before benchmarking.'}
if(-not $ResultDir){$ResultDir=Join-Path $PSScriptRoot "results\$Label"}
New-Item -ItemType Directory -Force $ResultDir|Out-Null
$pi=[Diagnostics.ProcessStartInfo]::new([IO.Path]::GetFullPath($Exe));$pi.UseShellExecute=$false;$pi.CreateNoWindow=$true;$pi.RedirectStandardOutput=$true;$pi.RedirectStandardError=$true
$arguments=@('-m',[IO.Path]::GetFullPath($ModelFile),'-c','4096','-ngl','0','-t','8','-tb','8','--parallel','1','--host','127.0.0.1','--port','18090','--alias','qwen3-4b-instruct-2507','--jinja','--no-webui','--offline','--cache-ram','0')
foreach($a in $arguments){$pi.ArgumentList.Add($a)}
$server=[Diagnostics.Process]::new();$server.StartInfo=$pi;$sw=[Diagnostics.Stopwatch]::StartNew();[void]$server.Start()
$stdout=$server.StandardOutput.ReadToEndAsync();$stderr=$server.StandardError.ReadToEndAsync()
try{
 $ready=$false
 while($sw.Elapsed.TotalSeconds -lt 120 -and -not $server.HasExited){try{$health=Invoke-RestMethod 'http://127.0.0.1:18090/health' -TimeoutSec 2;if($health.status -eq 'ok'){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 300}
 @{model='qwen3-4b-instruct-2507';runtime='llama.cpp 0.8.0 / b11960';provider='CPU (ARM64)';ready=$ready;total_seconds=$sw.Elapsed.TotalSeconds;arguments=$arguments;pid=$server.Id;exit_code=$(if($ready){0}else{1})}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $ResultDir 'load.json')
 if(-not $ready){throw 'llama-server did not become healthy within 120 seconds'}
 $env:AERIS_INFERENCE_PID="$($server.Id)"
 & $Dotnet $Dll bench 'http://127.0.0.1:18090' 'qwen3-4b-instruct-2507' $ResultDir $Repeats $Case *> (Join-Path $ResultDir 'harness.log')
 Set-Content (Join-Path $ResultDir 'harness-exit.txt') $LASTEXITCODE
}finally{
 $env:AERIS_INFERENCE_PID=$null
 if(-not $server.HasExited){$server.Kill($true);$server.WaitForExit()}
 $stdout.GetAwaiter().GetResult()|Set-Content (Join-Path $ResultDir 'server-stdout.log')
 $stderr.GetAwaiter().GetResult()|Set-Content (Join-Path $ResultDir 'server-stderr.log')
 $server.Dispose()
}

