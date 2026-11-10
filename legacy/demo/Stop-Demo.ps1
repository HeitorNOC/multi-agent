$ErrorActionPreference = 'Stop'
$activeDemo = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.state/active.json') | ConvertFrom-Json
$null = Invoke-RestMethod -Uri ($activeDemo.backend + '/rpc') -Method Post -ContentType 'application/json' -Headers @{'x-demo-token' = $activeDemo.token} -Body '{"action":"stop"}' -TimeoutSec 5
Write-Output 'Encerramento solicitado. Os recursos Docker desta demonstração serão removidos pelo launcher; documentos e evidências locais permanecem.'
