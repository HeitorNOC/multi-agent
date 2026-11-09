# Comandos e reprodução

PowerShell, diretório `C:\Users\PC\multi-agent`. Requer Python 3.12, uv, Docker Linux e rede para instalar dependências/baixar imagens. Docker deve estar ativo; não despausar se houver intervenção manual do operador. Execuções Docker passam pelo fluxo normal de aprovação do ambiente.

As dependências efetivas estão em `evidence/environment-freeze.txt`; os editables precisam dos SHAs vendor registrados em `manifest.json`. O freeze é registro de ambiente, não lock universal multiplataforma. A receita abaixo reconstrói o ambiente e deve ser comparada com ele antes de ensaios subsequentes.

```powershell
$env:UV_CACHE_DIR = "$PWD\.uv-cache"
uv venv --python 3.12 validation/integrated-pilot/.venv
uv pip install --python validation/integrated-pilot/.venv/Scripts/python.exe -e vendor/langgraph/libs/checkpoint -e vendor/langgraph/libs/checkpoint-postgres -e vendor/langgraph/libs/langgraph -e vendor/langgraph/libs/prebuilt -e vendor/langgraph/libs/sdk-py -e vendor/lightrag 'langgraph-sdk==0.4.11' 'psycopg[binary,pool]==3.3.7' asyncpg pgvector neo4j 'PyJWT[crypto]' aiohttp pytest pytest-asyncio
uv pip freeze --python validation/integrated-pilot/.venv/Scripts/python.exe
$env:PYTHONIOENCODING = 'utf-8'
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/integrated-pilot/test_installation.py -s -q --junitxml=validation/integrated-pilot/evidence/integration.xml *> validation/integrated-pilot/evidence/integration.log
```

Último comando executado: exit 0, 1 passed in 277.38s. O harness registra comandos Docker por argumentos em código: `docker run` com digests, `pg_dump -Fc`, `pg_dumpall --globals-only`, `neo4j-admin database dump/load`, `pg_restore --exit-on-error`, criação de volumes vazios e remoção dos recursos próprios. Não há `docker system prune` nem exclusão global.

Antes de repetir, arquive as evidências atuais: os nomes `integration.*` são sobrescritos. A primeira tentativa interrompida e a execução completa anterior foram preservadas em `evidence/attempt-1` e `attempt-2`. O warning pytest sobre escopo de loop não impediu execução; não foi ocultado.

Após o PASS, foi tentada a inspeção independente:

```powershell
docker ps -a --filter name=integrated-pilot- --format '{{.Names}}'
docker volume ls --filter name=integrated-pilot- --format '{{.Name}}'
docker network ls --filter name=integrated-pilot- --format '{{.Name}}'
```

Resultado: daemon manualmente pausado; exit 1, sem inventário. O cleanup registrado pelo próprio teste teve quatro volumes e rede removidos. Não foi desfeita a pausa manual.

Para gerar o pacote verificável sem backups/segredos: `& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/integrated-pilot/package.py`. O script inclui somente arquivos de topo e árvores explícitas corpus/evidence; verifica CRC e hash de cada entrada.
