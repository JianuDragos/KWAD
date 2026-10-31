param(
    [string]$ModelId = 'unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_0'
)
$ErrorActionPreference = 'Stop'

$cli = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GenieX CLI\geniex.exe'))
if (-not (Test-Path -LiteralPath $cli)) {
    throw "GenieX CLI not found: $cli. Install the Qualcomm GenieX Windows ARM64 CLI first."
}

Write-Host "Downloading the pinned NPU model variant: $ModelId"
& $cli pull $ModelId --model-hub hf
if ($LASTEXITCODE -ne 0) {
    throw "GenieX model download failed with exit code $LASTEXITCODE."
}

Write-Host 'NPU model is installed in the per-user GenieX cache.'
