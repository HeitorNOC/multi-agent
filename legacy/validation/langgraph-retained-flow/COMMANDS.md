# Comandos, evidências e falhas — 04/11/2026

Workspace: `C:\Users\PC\multi-agent`. Leitura de STATUS, resultados anteriores, `authority_client.py`, `freshness.py`, `freshness_authority.py`, testes da autoridade e fluxo TypeScript. Não se alterou vendor LangGraph.

## Testes da autoridade

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/langgraph-retained-flow/test_budget.py validation/concurrent-reconciliation/test_authority.py --basetemp=validation/langgraph-retained-flow/.unit-final -q --junitxml=validation/langgraph-retained-flow/budget-final.xml
& validation/integrated-pilot/.venv/Scripts/python.exe validation/langgraph-retained-flow/make_proof_fixture.py
node --test validation/langgraph-retained-flow/proof.test.ts validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-retained-flow/retained.ts validation/langgraph-retained-flow/proof.test.ts
```

Primeira execução Python sem basetemp falhou em setup, sem testar funcionalidade. A prova pública é gerada por Store real e não exporta chave privada. Usar o compilador existente em vendor/paperclip não adota Paperclip como plataforma.

## Integração e retomada

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/langgraph-retained-flow/test_signed_flow.py --basetemp=validation/langgraph-retained-flow/.integration-final -q -s --junitxml=validation/langgraph-retained-flow/signed-final.xml
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/langgraph-business-flow/test_flow.py --basetemp=validation/langgraph-retained-flow/.baseline-regression -q -s --junitxml=validation/langgraph-retained-flow/baseline-regression.xml
```

A primeira tentativa integrada (`signed-attempt-1`) falhou por daemon Docker ausente. A inspeção encontrou o executável em `C:\Users\PC\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`; foi iniciado com `Start-Process -WindowStyle Hidden`. A API Docker voltou como 29.8.1. Não houve instalação de Docker, mudança de contexto ou início de aplicações de produção.

O harness reaproveita Lab/provider/worker anteriores, provisiona PostgreSQL por digest e gera identidades locais aleatórias. A autoridade usa outra store/processo/chave, que ficam fora de g1/g2. `sqlite3.Connection.backup` captura os bancos parados; `pg_dump -Fc -n runtime` captura checkpoints; `pg_restore --exit-on-error` restaura em volume/container novos com papel de runtime recriado. Diretórios de restauração têm IDs próprios; originais são preservados.

Variantes adulteradas são cópias separadas: uma zera contadores locais, outra modifica texto publicado. Nenhum dado real é alterado. Após encerrar processos, cleanup confere o rótulo `qualification=<installation>` antes de remover somente contêineres/volumes do ensaio. Não há prune nem exclusão recursiva de diretórios do usuário.

Foram preservados resultados intermediários em `evidence/attempt-2.json`, `evidence/pre-idempotency-pass.json` e logs correspondentes. A regressão do harness anterior atualiza seu `evidence/results.json` de execução mais recente; JUnit/logs e negativos originais daquela rodada permanecem. Manifests históricos continuam associados às capturas originais, não são retroativamente atualizados para o código novo.

Não se abriram conexões com modelos, Glean ou ServiceNow. Não houve compra, deploy ou solicitação comercial. Recursos locais foram consumidos; unidades reservadas não são cobrança monetária. O aviso pytest-asyncio sobre escopo futuro de fixtures foi mantido nos logs.
