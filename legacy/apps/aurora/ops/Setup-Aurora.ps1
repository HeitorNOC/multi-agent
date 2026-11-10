param(
    [Parameter(Mandatory)][string]$EmbeddingWeights,
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace = (Resolve-Path (Join-Path $app '../..')).Path
$cache = Join-Path $app '.cache'
$runtime = Join-Path $app 'runtime'
$manifest = Get-Content -Raw (Join-Path $runtime 'services/embedding-manifest.json') | ConvertFrom-Json
$weightsSource = (Resolve-Path -LiteralPath $EmbeddingWeights).Path
$weightsTarget = Join-Path $app ('.models/' + $manifest.revision)

function Invoke-Checked {
    param([string]$Command, [string[]]$CommandArgs)
    & $Command @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Command falhou com código $LASTEXITCODE." }
}

function Assert-Revision {
    param([string]$Repository, [string]$Commit)
    $actual = & git -C $Repository rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $actual -ne $Commit) {
        throw "Checkout incompatível em $Repository. Revisão esperada $Commit."
    }
    & git -C $Repository diff --quiet HEAD --
    if ($LASTEXITCODE -ne 0) { throw "Há alterações em arquivos versionados de $Repository." }
}

$graph = Join-Path $workspace 'vendor/langgraph'
$rag = Join-Path $workspace 'vendor/lightrag'
Assert-Revision $graph '3c916d750575b22c464790e9774494d810ccd322'
Assert-Revision $rag 'aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a'
Invoke-Checked $Python @('-c', 'import sys; assert sys.version_info[:2] == (3, 12), "Aurora requer Python 3.12"')

foreach ($file in $manifest.model_files.PSObject.Properties) {
    $source = Join-Path $weightsSource $file.Name
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ine $file.Value.sha256) {
        throw "Hash divergente no arquivo de embeddings $($file.Name)."
    }
}
New-Item -ItemType Directory -Force -Path $weightsTarget | Out-Null
if ((Resolve-Path -LiteralPath $weightsTarget).Path -ne $weightsSource) {
    foreach ($file in $manifest.model_files.PSObject.Properties) {
        Copy-Item -LiteralPath (Join-Path $weightsSource $file.Name) -Destination $weightsTarget
    }
}

$runtimeVenv = Join-Path $app '.venv'
$embeddingVenv = Join-Path $app '.embedding-venv'
Invoke-Checked $Python @('-m', 'venv', $runtimeVenv)
Invoke-Checked $Python @('-m', 'venv', $embeddingVenv)

$pythonRuntime = Join-Path $runtimeVenv 'Scripts/python.exe'
$pythonEmbedding = Join-Path $embeddingVenv 'Scripts/python.exe'
$pipCache = Join-Path $cache 'pip'
$graphPackages = @('langgraph', 'checkpoint', 'checkpoint-postgres', 'prebuilt', 'sdk-py') |
    ForEach-Object { Join-Path $graph ('libs/' + $_) }
Invoke-Checked $pythonRuntime (@(
    '-m', 'pip', 'install', '--cache-dir', $pipCache,
    '--constraint', (Join-Path $runtime 'constraints-windows-py312.txt'),
    'aiohttp', 'asyncpg', 'cryptography', 'neo4j', 'numpy', 'psycopg[binary,pool]',
    'pgvector', $rag
) + $graphPackages)
Invoke-Checked $pythonEmbedding @(
    '-m', 'pip', 'install', '--cache-dir', $pipCache,
    '--constraint', (Join-Path $runtime 'constraints-embedding-windows-py312.txt'),
    'fastembed', 'numpy', 'tokenizers', 'onnxruntime'
)
Invoke-Checked $pythonRuntime @('-m', 'pip', 'check')
Invoke-Checked $pythonEmbedding @('-m', 'pip', 'check')
Invoke-Checked 'npm' @('--prefix', $app, 'ci', '--cache', (Join-Path $cache 'npm'), '--no-audit', '--no-fund')
Invoke-Checked 'npm' @('--prefix', $app, 'run', 'build')
