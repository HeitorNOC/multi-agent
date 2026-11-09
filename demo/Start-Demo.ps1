$ErrorActionPreference = 'Stop'
$demoRoot = $PSScriptRoot
$workspaceRoot = Split-Path -Parent $demoRoot
$demoState = Join-Path $demoRoot '.state'
New-Item -ItemType Directory -Force -Path $demoState | Out-Null
$activePath = Join-Path $demoState 'active.json'
if (Test-Path -LiteralPath $activePath) {
    $activeDemo = Get-Content -LiteralPath $activePath | ConvertFrom-Json
    try {
        $null = Invoke-RestMethod -Uri ($activeDemo.url + '/api/state') -TimeoutSec 3
        Write-Output ('Demonstração já disponível em ' + $activeDemo.url)
        return
    } catch { }
}
$runtimePython = Join-Path $workspaceRoot 'validation/integrated-pilot/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtimePython)) { throw 'O runtime da bancada precisa estar disponível; veja README.md.' }
$launcherPath = Join-Path $demoRoot 'start.py'
$demoProcess = Start-Process -FilePath $runtimePython -ArgumentList @('-X', 'utf8', ('"' + $launcherPath + '"')) -WorkingDirectory $workspaceRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $demoState 'launcher.log') -RedirectStandardError (Join-Path $demoState 'launcher-error.log') -PassThru
Write-Output ('Inicialização em segundo plano. PID: ' + $demoProcess.Id)
Write-Output ('Consulte ' + (Join-Path $demoState 'launcher.log') + ' para o endereço local; a interface mostra o andamento da ingestão.')
