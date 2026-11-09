# Comandos, ambientes e falhas

Raiz de execução: C:\Users\PC\multi-agent. Testes com dados e credenciais sintéticos. Docker é local; nenhum serviço de produção ou conta de cliente foi usado.

## Inventário

Get-Content no dossiê e resultados anteriores; rg/rg --files para contratos de ingestão/journal, QueryParam, cache, workspace, storages, locks, Graphiti edges/temporal/security e saver PostgreSQL. git rev-parse/status por clone, docker version/info e imagens locais por ID/digest. Algumas consultas tentaram nomes de arquivo/globs não existentes; foram refeitas com rg --files. Nenhuma decisão se baseou no silêncio de uma busca que falhou.

Acesso a Docker/WSL dentro do sandbox restrito inicialmente negou permissão; a verificação pelo fluxo normal escalado mostrou Docker Desktop 4.93.0 e Engine 29.8.1. Não concluir daemon indisponível apenas pelo acesso negado do sandbox.

## LightRAG upstream e cérebro

```powershell
& poc/.venv/Scripts/python.exe -X utf8 -m pytest vendor/lightrag/tests/workspace/test_workspace_isolation.py vendor/lightrag/tests/pipeline/test_delete_fail_closed.py vendor/lightrag/tests/extraction/test_kg_recovery_primitives.py vendor/lightrag/tests/test_lightrag_query_validation.py vendor/lightrag/tests/llm/test_llm_cache_identity.py -q --junitxml=validation/production-readiness/evidence/lightrag-upstream.xml
& poc/.venv/Scripts/python.exe -X utf8 -m pytest validation/production-readiness/test_brain.py -q --junitxml=validation/production-readiness/evidence/brain.xml
```

62 e 3 PASS, respectivamente. O rodapé sobre modelos spaCy de smart_heading indisponíveis não corresponde a skips nas baterias selecionadas: seus XMLs têm skipped=0. Não foi homologado parsing real de DOCX/PDF por esses resultados.

## Graphiti

Clonado o repositório público e fixado HEAD 7e0342a49ce5a04f6415ac2f64ce150bb81b0689. AGENTS.md lido, sem alteração de código. Seu aviso de serviços de referência e testes dependentes de DB foi respeitado.

```powershell
git clone --depth 1 https://github.com/getzep/graphiti.git vendor/graphiti-audit
git -C vendor/graphiti-audit checkout --detach
$env:UV_PROJECT_ENVIRONMENT=(Join-Path (Get-Location) 'validation/production-readiness/graphiti-venv')
$env:UV_CACHE_DIR=(Join-Path (Get-Location) 'validation/uv-cache')
& validation/.tools/Scripts/uv.exe sync --project vendor/graphiti-audit --frozen --no-default-groups --python poc/.venv/Scripts/python.exe
& validation/.tools/Scripts/uv.exe pip install --python validation/production-readiness/graphiti-venv/Scripts/python.exe pytest==9.2.0 pytest-asyncio==1.4.1.post1
$env:GRAPHITI_TELEMETRY_ENABLED='false'
$env:DISABLE_NEO4J='1'
$env:DISABLE_FALKORDB='1'
$env:DISABLE_KUZU='1'
$env:DISABLE_NEPTUNE='1'
$env:OPENAI_API_KEY='synthetic-not-used'
$env:OPENAI_BASE_URL='http://127.0.0.1:1'
& validation/production-readiness/graphiti-venv/Scripts/python.exe -X utf8 -m pytest vendor/graphiti-audit/tests/utils/maintenance/test_temporal_edge_utils.py vendor/graphiti-audit/tests/test_edge_db_queries.py -q --junitxml=validation/production-readiness/evidence/graphiti-unit.xml
```

16 PASS, um warning Pydantic. O clone reproduzível deve ser recuperado no SHA acima, não no HEAD que existir no futuro. O lock base foi congelado; runners de teste foram adicionados no ambiente isolado, com versões registradas. Nenhum endpoint OpenAI real foi chamado.

## Identidade, custos, sandbox e catálogo

```powershell
node validation/production-readiness/identity_probe.mjs
& poc/.venv/Scripts/python.exe -X utf8 -m pytest validation/production-readiness/test_costs.py -q --junitxml=validation/production-readiness/evidence/costs.xml
& poc/.venv/Scripts/python.exe -X utf8 validation/production-readiness/sandbox_probe.py
& poc/.venv/Scripts/python.exe -X utf8 validation/production-readiness/postgres_probe.py
```

13 checks de identidade, 8 testes de custo, 6 contêineres de sandbox e 19 verificações SQL. A primeira fixture PostgreSQL falhou porque corpus_owner não tinha SELECT em doc_acl; o grant foi corrigido somente na fixture. Falha preservada em postgres-first.*.

Sandbox usa imagem Playwright oficial já local por digest, sem rede nem mounts; não executou navegador. PostgreSQL canônico usa imagem local fixa, rede none/sem portas e trust exclusivamente nessa fixture isolada. Não recomendar trust como configuração de deployment.

## Saver PostgreSQL nativo

Ambiente separado, SDKs a partir do mesmo clone LangGraph e dependências resolvidas registradas em freeze. O install deste ambiente não foi um lock oficial congelado; o manifesto conserva as versões exatas instaladas para repetir a prova.

```powershell
& validation/.tools/Scripts/uv.exe venv validation/production-readiness/postgres-runtime --python poc/.venv/Scripts/python.exe
& validation/.tools/Scripts/uv.exe pip install --python validation/production-readiness/postgres-runtime/Scripts/python.exe -e vendor/langgraph/libs/checkpoint -e vendor/langgraph/libs/langgraph -e vendor/langgraph/libs/checkpoint-postgres 'psycopg[binary,pool]>=3.2.0'
& poc/.venv/Scripts/python.exe -X utf8 validation/production-readiness/pg_saver_probe.py
```

Falhas first/second/third: ProactorEventLoop no Windows, timeout sem instrumentação e timeout na conexão após restart. Corrigido o loop da fixture para SelectorEventLoop e redescoberta de endpoint. Após reinício, a porta publicada mudou de 54084 para 54094; a retomada passou, com uma execução do nó de evidência.

Houve uma falha temporária da revisão automática por limite de uso: a ação não foi executada. Após o usuário orientar a continuação, a mesma ação foi submetida pelo fluxo normal. A tentativa seguinte falhou antes de criar volume, porque Docker Desktop estava parado; preservada em pg-saver-fourth.*. O Docker existente foi restabelecido por docker desktop start --detach, sem instalar software. A prova final passou, sem bypass de aprovação. Falhas e diagnóstico foram preservados em pg-saver-*.json/log.

A prova usa porta aleatória em 127.0.0.1 e senha efêmera passada por stdin ao worker; não exporta a DSN/senha. Campos de diagnóstico foram sanitizados. Só nomes/volumes exclusivos prefixados production-audit foram removidos pelos próprios drivers. Não fazer docker prune nem remover recursos de outros projetos.

## Reprodução e limites

Ambientes existentes, Node/pnpm/Python e setup anterior estão documentados em poc/COMMANDS.md. SHAs, locks, freezes, digests e hashes de artefatos estão no manifesto. Nenhum clone de código funcional foi alterado; os scripts novos são harnesses de qualificação, não a implementação comercial.

Os logs originais não foram reescritos para transformar falhas em sucesso. O JSON final de pg-saver é o resultado final; as tentativas preservadas continuam FAIL. O ZIP exclui venvs, caches, vendor completo, bancos e secrets. Não afirmar reprodução em outro host/Linux ou validação de todos os backends a partir desses testes Windows/Docker locais.
