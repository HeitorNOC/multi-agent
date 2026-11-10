$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$stateRoot = Join-Path $PSScriptRoot '.state'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$activePath = Join-Path $stateRoot 'active.json'
if(Test-Path -LiteralPath $activePath){
    $current = Get-Content -LiteralPath $activePath | ConvertFrom-Json
    try { $status = Invoke-RestMethod -Uri ($current.url+'/api/recovery/session') -TimeoutSec 3; if($status.enabled){ Write-Output ('Central já disponível: '+$current.url); return } } catch {}
}
$python = Join-Path $workspaceRoot 'validation/integrated-pilot/.venv/Scripts/python.exe'
$script = Join-Path $PSScriptRoot 'start_console.py'
$centralProcess = Start-Process -FilePath $python -ArgumentList @('-X','utf8',('"'+$script+'"')) -WorkingDirectory $workspaceRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateRoot 'launcher.log') -RedirectStandardError (Join-Path $stateRoot 'launcher-error.log') -PassThru
Write-Output ('Inicializando central local; PID '+$centralProcess.Id+'. Nenhum modelo será chamado. Endereço no log privado da central.')
