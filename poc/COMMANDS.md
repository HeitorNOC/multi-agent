# Registro de comandos e falhas

Logs de execução em evidence/. Os primeiros inventários/leituras apareceram no terminal da conversa; não houve transcript byte a byte de toda a sessão. Esta lista reconstrói as invocações, sem apagar falhas.

## Ambiente e fontes

- Get-Location, rg --files e Get-ChildItem -Force: workspace inicial vazio.
- ZIP aberto com System.IO.Compression.ZipFile.OpenRead e StreamReader.ReadToEnd: único Markdown de 27.520 bytes lido integralmente; cópia DOSSIER.md.
- git --version; docker --version; docker compose version; docker info --format '{{.ServerVersion}}'; pnpm --version; node --version; Python do runtime --version. Versões no manifesto. Docker sem daemon; alias WindowsApps Python inacessível; Python runtime 3.12.14 funcional.
- git ls-remote https://github.com/paperclipai/paperclip.git HEAD: DNS falhou no sandbox; repetição escalada retornou SHA.
- git clone https://github.com/paperclipai/paperclip.git vendor/paperclip
- git -C vendor/paperclip checkout --detach 1e3ab690b072bbf6a1c1f1d0454ea49315b2074c
- git clone --depth 1 https://github.com/langchain-ai/langgraph.git vendor/langgraph; switch --detach no clone: 3c916d750575b22c464790e9774494d810ccd322.
- git clone --depth 1 https://github.com/HKUDS/LightRAG.git vendor/lightrag; switch --detach no clone: aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a.
- git status no sandbox falhou com worktree/permission denied; repetição escalada confirmou diff versionado vazio nos três clones.
- Inspeção seletiva de AGENTS/rules, manifests/lock/CI, HTTP/remote-fetch, issues/checkout, assignment wake, queue/runtime/completion/recovery, auth/authorization/access, budgets, schemas, loaders e testes. SOURCE_TRACE.md fornece linhas reais; não se afirma leitura de todos os 1.541 testes.

## Instalação (cwd vendor/paperclip)

1. pnpm install --frozen-lockfile --ignore-scripts → paperclip-install.log: pnpm11 incompatível com patches do lock, exit 1.
2. npx --yes pnpm@9.15.4 install --frozen-lockfile --ignore-scripts → paperclip-install-pnpm9.log: PASS, 1m08. Lockfile intacto; não usamos --no-frozen-lockfile.
3. npx --yes pnpm@9.15.4 --filter @paperclipai/plugin-sdk ensure-build-deps → sdk-build-deps.log: compila shared/SDK, PASS.
4. Python runtime -m venv poc/.venv; pip install dos seis pacotes locais LangGraph/checkpoint/sqlite/prebuilt/SDK e LightRAG, pytest/pytest-asyncio → python-install.log. Resolução final capturada em requirements.lock.txt e python-direct-provenance.json; não há hash de cada wheel transitivo.

## Testes upstream

Primeira tentativa, cwd raiz, --config server/vitest.config.ts e filtros server/src: não encontrou testes (includes relativos ao cwd); upstream-baseline.log, exit 1.

Comandos corrigidos: cwd vendor/paperclip/server; prefixo comum `npx --yes pnpm@9.15.4 exec vitest run --config vitest.config.ts`; PAPERCLIP_TELEMETRY_DISABLED=1.

- Baseline: src/adapters/http/execute.test.ts src/__tests__/http-adapter-remote-fetch.test.ts src/__tests__/remote-http-rebinding.test.ts src/__tests__/authorization-service.test.ts src/__tests__/issues-checkout-wakeup.test.ts src/services/heartbeat/queue.test.ts src/services/heartbeat/recovery.test.ts src/services/heartbeat/budget-cancellation.test.ts → upstream-baseline-server.log.
- Após SDK: src/services/heartbeat/queue.test.ts src/services/heartbeat/recovery.test.ts src/services/heartbeat/budget-cancellation.test.ts src/__tests__/heartbeat-cost-accounting.test.ts src/__tests__/heartbeat-retry-scheduling.test.ts src/__tests__/issues-checkout-wakeup.test.ts → upstream-heartbeat-after-sdk.log.
- Segurança/budget: src/__tests__/budgets-service.test.ts src/__tests__/budget-enforcement-scoping.test.ts src/__tests__/budget-live-attempts.test.ts src/__tests__/authorization-run-context.test.ts src/__tests__/remote-http-endpoint-guard.test.ts src/services/heartbeat/run-control.test.ts → upstream-security-budget.log.

Não somar contadores como testes únicos: há sobreposição de arquivos/execuções.

Baseline servidor: `node --import ./server/node_modules/tsx/dist/loader.mjs server/src/index.ts`, cwd upstream; PAPERCLIP_HOME=poc/paperclip-home, config exclusiva, HOST=127.0.0.1 PORT=3199 SERVE_UI=false e telemetry disabled. paperclip-server.log: 421 migrations/startup. GET health no sandbox bloqueou socket; E2E escalado consultou API com sucesso.

## PoC

Comandos no README; logs correspondem ao basename dos scripts. Probe TS inicial falhou por CommonJS/top-level await; corrigido com poc/package.json type:module, sem alterar upstream. Falha preservada em http-probe-initial-failure.log.

- python -m pytest poc/test_boundary.py -v --junitxml=poc/evidence/boundary-python.xml: 5 PASS/8,32s.
- python -m pytest -c poc/pytest.ini poc/test_boundary.py -v --junitxml=poc/evidence/boundary-python-final.xml: 8 PASS/3,48s.
- python -m pytest vendor/lightrag/tests/workspace/test_workspace_path_validation.py vendor/lightrag/tests/workspace/test_workspace_sanitization.py -q --junitxml=poc/evidence/lightrag-upstream.xml: 42 PASS, 4 FAIL por FastAPI ausente (SDK-only, sem extras API/parser).
- node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/http_probe.ts
- node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/live_e2e.ts
- node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/fault_probe.ts
- node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/postgres_restore.ts
- python poc/gather_evidence.py: manifesto, hashes, source trace e métricas GitHub com timestamps. open_issues_count inclui PRs, não é contagem de bugs.

O primeiro comando de geração consolidada dos documentos excedeu o limite de tamanho de CreateProcess no Windows (erro 206); documentos gravados em chamadas menores. Escritas/rede/processos precisaram de escalonamento de ferramenta pelo perfil inicial read-only; isso não autorizou produção.

## Encerramento e entrega

A primeira restauração PostgreSQL falhou por postmaster.pid órfão. Após comprovar processo ausente e porta recusada, a cópia fria foi iniciada sem o marcador copiado e preservou issue/run/receipts: PASS; original não alterado. Logs iniciais preservados. A instância baseline verificada (Node PID 30812, porta3199) foi encerrada; cleanup.log confirma ausência de listeners nas portas 3199/3200/54329/54339/54349. Marcadores e diretórios de teste foram preservados.

Verificação final: pytest oito PASS/3,10s; diff versionado vazio nos três clones; links locais, 55 linhas da matriz e scan de padrões de credenciais nos logs. verification.json registra limites do scan. Pacote ZIP exclui bancos, venv, node_modules e caches. SHA256SUMS.txt registra os arquivos entregues.
