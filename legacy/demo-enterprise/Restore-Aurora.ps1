param([Parameter(Mandatory)][string]$Directory)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$python = Join-Path $workspace 'apps/aurora/.venv/Scripts/python.exe'
& $python -X utf8 (Join-Path $PSScriptRoot 'local_backup.py') restore --directory $Directory
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
