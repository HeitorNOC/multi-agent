$ErrorActionPreference = 'Stop'
$activePath = Join-Path $PSScriptRoot '.state/active.json'
$current = Get-Content -LiteralPath $activePath | ConvertFrom-Json
Invoke-RestMethod -Method Post -Uri ($current.backend+'/rpc') -ContentType 'application/json' -Headers @{'x-demo-token'=$current.token} -Body '{"action":"stop"}' | Select-Object stopping
