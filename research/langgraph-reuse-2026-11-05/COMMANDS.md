# Execução e procedência — 05/11/2026

Pesquisa web explícita solicitada pelo usuário, incluindo YouTube. Busca inicial misturou resultados relevantes com páginas genéricas; foram descartados os genéricos e resumos não primários. Documentação oficial e fontes dos projetos foram abertas; vídeos tiveram apenas descrições/metadados disponíveis, sem transcrição integral.

## Inspeção local e snapshots públicos

```powershell
git -C vendor/langgraph rev-parse HEAD
git -C vendor/langgraph status --porcelain
rg -n 'RetryPolicy|TimeoutPolicy|error_handler|set_node_defaults' vendor/langgraph/libs/langgraph/langgraph/types.py vendor/langgraph/libs/langgraph/langgraph/graph/state.py
rg -n 'retry_policy|heartbeat|checkpointer' vendor/langgraph/libs/langgraph/langgraph/func/__init__.py
```

SHA `3c916d750575b22c464790e9774494d810ccd322`, sem alterações no clone. Inspecionados os mecanismos no código já fixado, além da documentação atual. Deep Agents e LangChain não estavam instalados; `langchain-core` local é 1.7.4.

Um script stdlib consultou `api.github.com/repos/<repo>` e `commits/<default_branch>`, fixou SHA e leu arquivos via `raw.githubusercontent.com/<repo>/<sha>/<path>`, guardando só README/licenças/código selecionado. Nenhum arquivo local foi enviado. Nenhum código baixado foi instalado ou executado. Arquivos e hashes: [source-manifest.json](source-manifest.json).

## Prova dirigida sem LLM

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest research/langgraph-reuse-2026-11-05/test_native.py --basetemp=research/langgraph-reuse-2026-11-05/.temp-first -q -s --junitxml=research/langgraph-reuse-2026-11-05/native.xml > research/langgraph-reuse-2026-11-05/native.log 2>&1
```

Primeira execução FAIL em 10,60 s, após os dois primeiros checkpoints. Queda do processo antes de checkpoint recuperável do caso externo gerou `EmptyInputError` ao retomar com `None`. Log/JUnit/captura preservados em `native-first.*` e `evidence/first-results.json`.

Aplicado padrão oficial de admissão/outbox fora do grafo, conservando input e chave empresarial; fallback de novo input só após `EmptyInputError`. O fornecedor sintético deduplica pelo ID persistente; sem esse contrato não há permissão de repetir cegamente.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest research/langgraph-reuse-2026-11-05/test_native.py --basetemp=research/langgraph-reuse-2026-11-05/.temp-second -q -s --junitxml=research/langgraph-reuse-2026-11-05/native.xml > research/langgraph-reuse-2026-11-05/native.log 2>&1
```

PASS completo em 10,92 s, quatro checkpoints do mesmo teste. Subprocessos são separados, saver PostgreSQL real, `durability="sync"`, `@task`, `interrupt`, `Command`, pending writes e RetryPolicy nativos. Zero modelos/tokens medidos; não se afirma gratuidade de um fornecedor comercial. O helper verifica ownership por rótulo antes de cleanup Docker; sem prune, produção, mensagens ou compras.

Os subprocessos recebem DSN/paths de fixture pelo stdin, sem impressão de credenciais; stderr exportado passa pela redação do helper. SQLite serve como fornecedor/admissão de teste, não como decisão final de banco empresarial. Não foram migrados os ledgers atuais nem repetido V1: suas falhas continuam registradas.

## Conferência

O manifesto final verifica os nove arquivos de terceiros contra seus hashes, contadores da prova, JUnit, links locais e hashes dos artefatos/código. A leitura de documentação não foi contada como teste executado; a prova dirigida não é homologação de Deep Agents, Agent Server ou dos casos empresariais anteriores.
