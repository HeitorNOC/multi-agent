# PostgreSQL portatil do teste real, so neste computador (sem servico do Windows, sem senha).
# Escuta apenas em 127.0.0.1:5433; autenticacao "trust" restrita a conexoes locais.
# Uso: ./scripts/teste-real/postgres.ps1 [iniciar|parar|status]
# (Arquivo so com ASCII: o PowerShell 5.1 le UTF-8 sem BOM como ANSI.)
param([ValidateSet("iniciar", "parar", "status")] [string]$acao = "iniciar")
$ErrorActionPreference = "Stop"

$base = Join-Path $env:LOCALAPPDATA "aurora-pg"
$bin = Join-Path $base "pgsql\bin"
$data = Join-Path $base "data"
$log = Join-Path $base "postgres.log"
$port = 5433
if (-not (Test-Path (Join-Path $bin "pg_ctl.exe"))) { throw "PostgreSQL nao encontrado em $bin (veja docs/TESTE_REAL_WEBCHAT.md, secao 2)." }

function Running { & (Join-Path $bin "pg_ctl.exe") status -D $data *> $null; return $LASTEXITCODE -eq 0 }

switch ($acao) {
  "parar" { if (Running) { & (Join-Path $bin "pg_ctl.exe") stop -D $data -m fast | Out-Null }; Write-Host "PostgreSQL parado."; return }
  "status" { if (Running) { Write-Host "PostgreSQL rodando em 127.0.0.1:$port" } else { Write-Host "PostgreSQL parado." }; return }
}

if (-not (Test-Path (Join-Path $data "PG_VERSION"))) {
  & (Join-Path $bin "initdb.exe") -D $data -U postgres --auth=trust --encoding=UTF8 --locale=C | Out-Null
  Add-Content -Encoding ascii (Join-Path $data "postgresql.conf") "`nlisten_addresses = '127.0.0.1'`nport = $port`n"
  Write-Host "Banco inicializado em $data"
}
if (-not (Running)) {
  # Desligado deste terminal: com a saida ligada a um pipe, o PowerShell esperaria o servidor terminar.
  Start-Process -FilePath (Join-Path $bin "pg_ctl.exe") -ArgumentList @("start", "-D", "`"$data`"", "-l", "`"$log`"") -WindowStyle Hidden
  $ready = Join-Path $bin "pg_isready.exe"
  for ($i = 0; $i -lt 30; $i++) { & $ready -h 127.0.0.1 -p $port -q; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 1 }
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL nao subiu; veja $log" }
}
$exists = & (Join-Path $bin "psql.exe") -h 127.0.0.1 -p $port -U postgres -tAc "select 1 from pg_database where datname = 'aurora_checkpoints'"
if ($exists -ne "1") { & (Join-Path $bin "createdb.exe") -h 127.0.0.1 -p $port -U postgres aurora_checkpoints }
Write-Host "PostgreSQL rodando em 127.0.0.1:$port (banco aurora_checkpoints)"
