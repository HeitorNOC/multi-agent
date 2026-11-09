# PoC Paperclip + LangGraph + LightRAG

**Decisão: NO-GO para adoção no estado auditado.** O fluxo sem fork funcionou com dados sintéticos; cancelamento remoto falhou e há gates empresariais abertos. Veja [REPORT.md](REPORT.md), [MATRIX.csv](MATRIX.csv), [SOURCE_TRACE.md](SOURCE_TRACE.md) e [COMMANDS.md](COMMANDS.md).

O dossiê integral está em [DOSSIER.md](DOSSIER.md). Não recebemos a exportação literal da conversa original. Não houve modelos pagos, produção, publicação ou mudanças no core.

## Reprodução em PowerShell

Execute da raiz `multi-agent`. Requer Git, Node >=24.11 e Python 3.12. Recrie os clones em vendor e faça checkout detached dos SHAs de `evidence/manifest.json`. O lock Python tem caminhos relativos à raiz; não é um lock de hashes de wheels.

```powershell
python -m venv poc/.venv
./poc/.venv/Scripts/python.exe -m pip install -r poc/requirements.lock.txt
Push-Location vendor/paperclip
npx --yes pnpm@9.15.4 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@9.15.4 --filter @paperclipai/plugin-sdk ensure-build-deps
Pop-Location
$env:PAPERCLIP_TELEMETRY_DISABLED='1'
$env:LANGSMITH_TRACING='false'
$env:LANGCHAIN_TRACING_V2='false'
./poc/.venv/Scripts/python.exe -m pytest -c poc/pytest.ini poc/test_boundary.py -v
node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/http_probe.ts
node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/live_e2e.ts
node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/fault_probe.ts
node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs poc/postgres_restore.ts
```

`live_e2e.ts` usa portas 3200/54339, cria home novo e encerra os filhos Node/Python. No Windows, o banco pode deixar postmaster.pid órfão: consultar logs e diagnosticar somente o diretório de teste antes de repetir. `postgres_restore.ts` é um experimento separado de cópia fria em 54349 e exige comprovar que o cluster de origem está parado. Não encerre serviços desconhecidos.

## Conteúdo

- `http_probe.ts`: adapter HTTP upstream real contra stub local; 200/202, 400/500, headers, timeout, cancelamento, repetição e SSRF.
- `adapter/index.ts`: plugin TS externo carregado pela API oficial. Espera conclusão Python e atualiza issue com JWT do run.
- `runtime.py`: aiohttp interno, LangGraph real com Chief of Staff, controlador, dois especialistas paralelos e revisão; SQLite/checkpoint e LightRAG reais com embeddings/tokenização determinísticos.
- `test_boundary.py`: oito testes de replay, autorização, orçamento fictício, checkpoints e restore SQLite. Reabrir conexão não equivale a matar worker; teste separado usa dois processos Python sucessivos para checkpoint.
- `live_e2e.ts`: company/agent/issue → assignment/heartbeat → plugin → LangGraph/LightRAG → PATCH autenticado → succeeded/done; inclui hire gate, cross-company e revogação.
- `fault_probe.ts`: replay simultâneo, assinatura/contexto e efeito depois de timeout. Sucesso diagnóstico significa que a falha foi reproduzida, não requisito aprovado.
- `gather_evidence.py`: SHAs, hashes, proveniência, versões e referências imutáveis arquivo:linha.

## Limites

LightRAG usa `ainsert_custom_kg` com chunks preparados e retrieval naive. Não testamos extração documental, ranking semântico, embeddings reais, ACL intradomínio, qualidade LLM, vigência temporal ou cérebro completo. O próprio upstream exclui esse caminho custom KG da garantia journaled de recuperação documental.

A aprovação é bool de fixture; o MCP é uma caixa de e-mail SQLite simulada. O orçamento Python é uma reserva fictícia, não teto mensal integrado. A PoC não demonstra service accounts, sandbox empresarial, cancelamento durável nem DR completo. Nenhum desses limites foi substituído por mock e declarado validado.

Logs, JSON e JUnit ficam em `evidence/`. venv, node_modules, bancos e caches são excluídos do pacote de entrega. Os três clones mantiveram arquivos versionados intactos.
