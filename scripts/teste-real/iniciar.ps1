# Sobe o Aurora para o teste real (docs/TESTE_REAL_WEBCHAT.md): modelo ligado no Chief, no Cerebro
# e no worker, dados separados em apps/api/data/teste-real. Defina antes, na sua sessao:
#   $env:AURORA_CHECKPOINT_DSN = "postgresql://postgres:SUA_SENHA@localhost:5432/aurora_checkpoints"
# (Arquivo so com ASCII: o PowerShell 5.1 le UTF-8 sem BOM como ANSI.)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $env:AURORA_CHECKPOINT_DSN) { throw "Defina AURORA_CHECKPOINT_DSN antes (docs/TESTE_REAL_WEBCHAT.md, secao 3)." }

$python = Join-Path $root "apps\runtime\.venv\Scripts\python.exe"
$worker = Join-Path $root "apps\runtime\open_worker.py"
$data = Join-Path $root "apps\api\data\teste-real"
New-Item -ItemType Directory -Force $data | Out-Null

$env:AURORA_PORT = "4300"
$env:AURORA_SQLITE_PATH = Join-Path $data "aurora.db"
$env:AURORA_WORKER_COMMAND = ConvertTo-Json -Compress @($python, "-I", $worker)
$env:AURORA_WORKER_CWD = Join-Path $root "apps\runtime"
$env:AURORA_MODEL_PROVIDER = "claude"
$env:AURORA_CHIEF_ENGINE = "model"
$env:AURORA_KNOWLEDGE_ANSWERER = "model"

Write-Host "Aurora (teste real) em http://localhost:4300 - dados em $data"
npm --prefix (Join-Path $root "apps\api") start
