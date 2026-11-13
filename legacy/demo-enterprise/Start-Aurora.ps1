param([ValidateSet(1, 2)][int]$Workers, [switch]$NewSession)

$ErrorActionPreference = 'Stop'
$auroraRoot = $PSScriptRoot
$workspaceRoot = Split-Path -Parent $auroraRoot
$auroraState = Join-Path $auroraRoot '.state'
New-Item -ItemType Directory -Force -Path $auroraState | Out-Null
$activePath = Join-Path $auroraState 'active.json'
if (Test-Path -LiteralPath $activePath) {
    $activeAurora = Get-Content -LiteralPath $activePath | ConvertFrom-Json
    try {
        $responseAurora = Invoke-RestMethod -Uri ($activeAurora.url + '/api/state') -TimeoutSec 3
        if ($responseAurora.runtime.phase -ne 'failed') {
            if ($NewSession) { throw 'A sessão existente precisa ser encerrada antes de iniciar outra.' }
            $currentWorkers = if ($null -ne $responseAurora.queue.max_workers) { $responseAurora.queue.max_workers } else { 1 }
            Write-Output ('Aurora já disponível em ' + $activeAurora.url + ' com ' + $currentWorkers + ' worker(s).')
            return
        }
        throw 'A sessão existente está em falha. Consulte os logs e encerre-a antes de iniciar outra.'
    } catch {
        if ($_.Exception.Message -like 'A sessão existente*') { throw }
    }
}
$runtimePython = Join-Path $workspaceRoot 'apps/aurora/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtimePython)) {
    throw 'Execute apps/aurora/ops/Setup-Aurora.ps1 para provisionar o ambiente do Aurora.'
}
$launcherPath = Join-Path $auroraRoot 'start.py'
$auroraArgs = @('-X','utf8',('"'+$launcherPath+'"'))
if ($PSBoundParameters.ContainsKey('Workers')) { $auroraArgs += @('--workers',$Workers) }
if ($NewSession) { $auroraArgs += '--new-session' }
$auroraProcess = Start-Process -FilePath $runtimePython -ArgumentList $auroraArgs -WorkingDirectory $workspaceRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $auroraState 'launcher.log') -RedirectStandardError (Join-Path $auroraState 'launcher-error.log') -PassThru
Write-Output ('Inicializando Aurora em segundo plano. PID: '+$auroraProcess.Id)
Write-Output ('Endereço local em '+(Join-Path $auroraState 'launcher.log'))
