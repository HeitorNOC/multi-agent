param(
    [Parameter(Mandatory)]
    [string] $Output
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '../../apps/aurora/.venv/Scripts/python.exe'
$runner = Join-Path $PSScriptRoot 'run.py'
& $python -X utf8 $runner baseline $Output
if ($LASTEXITCODE -ne 0) { throw 'Falha na prova negativa da implementação inicial' }

$tag = 'aurora-engineering-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$password = [guid]::NewGuid().ToString('N')
$container = docker run --rm -d --pull=never --name $tag -p '127.0.0.1::5432' `
    -e "POSTGRES_PASSWORD=$password" postgres:16-alpine
if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar o PostgreSQL do ensaio' }

$priorDsn = $env:AURORA_ENGINEERING_DSN
try {
    $address = docker port $container '5432/tcp'
    if ($LASTEXITCODE -ne 0 -or $address -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Porta de loopback do PostgreSQL indisponível'
    }
    $port = $Matches[1]
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        docker exec $container pg_isready -h 127.0.0.1 -U postgres *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'PostgreSQL do ensaio indisponível' }

    $env:AURORA_ENGINEERING_DSN = "postgresql://postgres:${password}@127.0.0.1:${port}/postgres"
    & $python -X utf8 $runner first $Output
    if ($LASTEXITCODE -ne 88) { throw "Interrupção inesperada do primeiro worker ($LASTEXITCODE)" }
    Write-Output 'Worker interrompido após checkpoint da implementação, antes de QA.'

    & $python -X utf8 $runner resume $Output
    if ($LASTEXITCODE -ne 0) { throw 'Retomada sem entrega aprovada para revisão humana' }
    Write-Output 'Retomada concluída com entrega para revisão humana.'
} finally {
    $env:AURORA_ENGINEERING_DSN = $priorDsn
    docker stop $container | Out-Null
}
