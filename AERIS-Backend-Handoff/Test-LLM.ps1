param([int]$Port=18090)
$ErrorActionPreference='Stop'
$body=@{model='aeris-local';messages=@(@{role='system';content='Use only supplied facts. Reply with one short sentence.'},@{role='user';content='A simulated engine selected P2 with total delay 5 minutes. State the selected option and delay.'});temperature=0;max_tokens=100;stream=$false} | ConvertTo-Json -Depth 8
$response=Invoke-RestMethod "http://127.0.0.1:$Port/v1/chat/completions" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 45
if($response.choices[0].finish_reason -ne 'stop' -or [string]::IsNullOrWhiteSpace($response.choices[0].message.content)){throw 'Inference did not complete normally.'}
$response.choices[0].message.content
Write-Host 'Transport smoke test completed. This is not a factual-quality acceptance test.'
