# Comandos e histórico — 04/11/2026

Executados da raiz `C:\Users\PC\multi-agent`. Caminhos `.state` são descartáveis por instalação e não devem ser distribuídos como configuração de produção.

## Inspeção

Lidos STATUS/dossiê A0–A4, engine/protocolo/provider/harness do integrated-pilot, controles/authority_client/budget_probe de concurrent-reconciliation, editorial TypeScript e testes. Consultado vendor/langgraph/AGENTS.md; não se alterou código vendor e a ferramenta opcional Corridor não estava disponível.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -c "import langgraph.graph,langgraph.checkpoint.postgres; print(langgraph.graph.__file__); print(langgraph.checkpoint.postgres.__file__)"
git -C vendor/langgraph status --short
node --version
```

LangGraph/checkpointer vieram do checkout fixado e o diff vendor permaneceu vazio. Novos arquivos são código da bancada própria, não patch ao runtime.

## Ensaios integrados

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/langgraph-business-flow/test_flow.py -q -s --junitxml=validation/langgraph-business-flow/first-run.xml
```

Primeira execução: uma API, PASS. Artefatos `first-run.log/xml` e `evidence/first-run.json`.

Após adicionar segunda API e reforçar checagens transacionais de ACL/lease, a execução seguinte falhou no código de recusa de quota. Preservada em `two-api-failed.log/xml` e `evidence/two-api-failed.json`. Não foi relaxado o critério 429.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe validation/langgraph-business-flow/diagnose_quota.py validation/langgraph-business-flow/evidence/quota-diagnostic-before.json
& validation/integrated-pilot/.venv/Scripts/python.exe validation/langgraph-business-flow/diagnose_quota.py validation/langgraph-business-flow/evidence/quota-diagnostic-stack.json
node --test validation/langgraph-business-flow/editorial_read.test.ts
```

O diagnóstico usa backups SQLite de leitura da instalação falha e cria APIs sobre cópias em outro diretório; não altera os bancos da evidência original. Antes do fix: 47×429/1×503 e depois 42×429/6×503, com stack apontando a inicialização editorial. Uma primeira prova com escritor aberto passou e não foi considerada reprodução. A prova de leitores simultâneos falhou por lock e foi preservada antes de corrigir o código.

Primeira tentativa do diagnóstico sem escalonamento encontrou WinError 10013 no socket local; serviços foram encerrados no finally, e repetição autorizada obteve as respostas reais. Isso foi falha de permissão do ambiente de execução, não do produto.

## Correção e verificação final

```powershell
node --test validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-business-flow/editorial_read_worker.ts
& validation/integrated-pilot/.venv/Scripts/python.exe validation/langgraph-business-flow/diagnose_quota.py validation/langgraph-business-flow/evidence/quota-diagnostic-after.json
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/langgraph-business-flow/test_flow.py -q -s --junitxml=validation/langgraph-business-flow/final-run.xml
```

12 testes Node PASS, strict PASS, diagnóstico 48×429/zero erros internos, E2E final PASS. O TypeScript instalado sob vendor/paperclip foi usado somente como compilador já disponível; isso não reintroduz Paperclip como componente.

O harness provisiona PostgreSQL por digest, gera credenciais efêmeras em memória, inicia provider Python já existente e APIs TypeScript, executa workers como processos separados e injeta saídas 73/74 deliberadas. Aplica rótulo `qualification=<installation>`, confere esse rótulo antes de `docker rm -f` e `docker volume rm`, sem prune ou remoção de recursos de outras rodadas. Segredos não entram nas evidências exportadas.

Os logs pytest incluem aviso de configuração futura de pytest-asyncio; o ensaio é síncrono e não usa fixture assíncrona desse plugin. `pip freeze` no venv antigo falhou porque ele não contém pip; nenhuma instalação foi feita para contornar. Inventário observado foi obtido por importlib.metadata, sem tratar isso como um lock novo.
