$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'model.json') -Raw | ConvertFrom-Json
$target=Join-Path $PSScriptRoot $config.localFile
New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
if(Test-Path -LiteralPath $target){
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $config.sha256){Write-Host 'Model already present and checksum verified.';return}
    throw 'An existing model file has a different checksum. Move it aside before downloading; it will not be overwritten.'
}
$temporary=$target+'.partial'
Write-Host 'Downloading the pinned 2.50 GB model. Initial provisioning needs internet.'
Invoke-WebRequest -Uri $config.source -OutFile $temporary -UseBasicParsing
if((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $config.sha256){throw 'Downloaded checksum differs; partial file preserved for inspection.'}
Move-Item -LiteralPath $temporary -Destination $target
Write-Host 'Model downloaded and SHA-256 verified. Subsequent inference is local.'
