$ErrorActionPreference = 'Stop'
$activeAurora = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.state/active.json') | ConvertFrom-Json
$null = Invoke-RestMethod -Uri ($activeAurora.backend+'/rpc') -Method Post -ContentType 'application/json' -Headers @{'x-demo-token'=$activeAurora.token} -Body '{"action":"stop"}' -TimeoutSec 5
Write-Output 'Encerramento solicitado. A sessão pronta será preservada para a próxima inicialização.'
$launcher = Get-Process -Id $activeAurora.launcher_pid -ErrorAction SilentlyContinue
if ($launcher) { Wait-Process -InputObject $launcher -Timeout 120 }
if (Test-Path -LiteralPath (Join-Path $activeAurora.state 'parked')) {
    Write-Output 'Instalação local pronta para retomar com Start-Aurora.ps1.'
} else {
    Write-Output 'A sessão terminou sem confirmação de retomada. Consulte os logs.'
}
