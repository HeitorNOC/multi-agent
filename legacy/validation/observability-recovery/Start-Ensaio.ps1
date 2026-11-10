$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$stateRoot = Join-Path $workspaceRoot 'demo-enterprise/.state'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$activePath = Join-Path $stateRoot 'active.json'
if (Test-Path -LiteralPath $activePath) {
    $previous = Get-Content -LiteralPath $activePath | ConvertFrom-Json
    try {
        $current = Invoke-RestMethod -Uri ($previous.url + '/api/state') -TimeoutSec 3
        if ($current.runtime.run_profile -eq 'observability-v1' -and $current.runtime.phase -ne 'failed') {
            Write-Output ('Ensaio instrumentado já ativo em ' + $previous.url)
            return
        }
    } catch {}
    Copy-Item -LiteralPath $activePath -Destination (Join-Path $stateRoot 'original-before-observability.json')
}
$runtimePython = Join-Path $workspaceRoot 'validation/integrated-pilot/.venv/Scripts/python.exe'
$launcher = Join-Path $workspaceRoot 'demo-enterprise/start.py'
$arguments = @('-X','utf8',('"'+$launcher+'"'),'--run-profile','observability-v1')
$process = Start-Process -FilePath $runtimePython -ArgumentList $arguments -WorkingDirectory $workspaceRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateRoot 'launcher-observability.log') -RedirectStandardError (Join-Path $stateRoot 'launcher-observability-error.log') -PassThru
Write-Output ('Ensaio novo em segundo plano. PID: '+$process.Id+'; teto: 40 reservas, separado da rodada histórica de 55.')
