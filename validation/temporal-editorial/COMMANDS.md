# Comandos e falhas — 04/11/2026

PowerShell no workspace C:\Users\PC\multi-agent. Graphiti SHA `7e0342a49ce5a04f6415ac2f64ce150bb81b0689`, versão 0.31.2. Nenhuma alteração vendor. Neo4j/PostgreSQL/Keycloak mantêm digests anteriores. GRAPHITI_TELEMETRY_ENABLED=false em todos os processos Graphiti.

## Ambiente isolado

```powershell
$env:UV_CACHE_DIR="$PWD/validation/uv-cache"
& validation/.tools/Scripts/uv.exe venv --python validation/integrated-pilot/.venv/Scripts/python.exe validation/temporal-editorial/.venv
& validation/.tools/Scripts/uv.exe pip install --python validation/temporal-editorial/.venv/Scripts/python.exe -e vendor/graphiti-audit aiohttp 'PyJWT[crypto]' pytest
& validation/.tools/Scripts/uv.exe pip install --offline --python validation/temporal-editorial/.venv/Scripts/python.exe asyncpg httpx
```

Primeira tentativa de instalar asyncpg sem rede autorizada falhou em DNS; foi preservada e resolvida com o cache local offline. httpx precisou ser instalado explicitamente: o código Graphiti importa esse módulo e a resolução atual de dependências não o trouxe. Não foi falha de inferência. O freeze observado está em evidence/environment-freeze.txt.

## Editorial

```powershell
node --test validation/temporal-editorial/editorial.test.ts
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/temporal-editorial/editorial.ts validation/temporal-editorial/editorial.test.ts
```

Node 24.20.0, TypeScript 7.0.2 e tipos Node 24.13.3 existentes no workspace. Usar esse compilador não adota o control plane Paperclip. Primeira verificação TS tratou o diretório como CommonJS; package.json explicitando type=module corrigiu o modo de compilação. Dez testes finais passaram. A regressão de comparação lexicográfica de datas com fração de segundo foi reproduzida (red), corrigida com comparação temporal SQLite e repetida (green). Logs preservados.

## Aceitação temporal real

```powershell
$env:PYTHONIOENCODING='utf-8'
$env:GRAPHITI_TELEMETRY_ENABLED='false'
$env:TEMPORAL_MODEL='gpt-6.1-terra'
& validation/temporal-editorial/.venv/Scripts/python.exe -X utf8 -m pytest validation/temporal-editorial/test_temporal.py -s -q --tb=short --junitxml=validation/temporal-editorial/evidence/temporal.xml
# Arquivar os arquivos de evidência de topo em evidence/terra antes da próxima execução.
$env:TEMPORAL_MODEL='gpt-6.1-sol'
& validation/temporal-editorial/.venv/Scripts/python.exe -X utf8 -m pytest validation/temporal-editorial/test_temporal.py -s -q --tb=short --junitxml=validation/temporal-editorial/evidence/temporal.xml
# Arquivar em evidence/sol antes do teste de falha da publicação.
```

O resultado pytest negativo **é mantido**, porque a aceitação temporal não foi satisfeita. O teste executou também publicação, idempotência de release publicado, ACL, revogação e restart; execution_completed não significa aprovação de todos os critérios. O SDK nativo faz extração, deduplicação, datação e invalidação; não se editaram arestas ou gabaritos. Busca híbrida nativa com RRF, sem cross-encoder simulado. ONNX pré-treinado real, mesmos pesos/hashes das rodadas anteriores.

Limite de 48 chamadas por instalação; Sol autorizado pelo usuário para escalada quando necessário. O adaptador Codex limita tempo, usa sandbox read-only e não propaga senhas/tokens de apps aos processos de inferência. JSON de saída é validado pelos modelos Pydantic nativos. Tokens são registrados, sem converter em fatura monetária não observada. Skill OpenAI Docs aplicada conforme orientação já lida na conversa; [modelo Sol e CLI](https://learn.chatgpt.com/docs/models), [JSONL/saída estruturada](https://learn.chatgpt.com/docs/non-interactive-mode).

## Falhas operacionais e ensaio adicional

attempt-1 falhou em 123,35 s antes do modelo: a criação concorrente duplicada de índices e o limite de 128 processos do Neo4j fizeram o helper JVM falhar. A aplicação passou a aguardar a tarefa de índices que o driver já inicia; SEMAPHORE_LIMIT=2 e pids-limit=256, mantendo 1 GB e 1 CPU. Sem remoção dos controles ou mudança de imagem. A leitura de _init_task é uma dependência privada do SHA fixado que exige atenção em upgrades.

```powershell
$env:TEMPORAL_MODEL='gpt-6.1-sol'
& validation/temporal-editorial/.venv/Scripts/python.exe -X utf8 -m pytest validation/temporal-editorial/test_publication.py -s -q --tb=short --junitxml=validation/temporal-editorial/evidence/publication.xml
& validation/temporal-editorial/.venv/Scripts/python.exe -X utf8 validation/temporal-editorial/diagnose_temporal.py
```

O teste adicional injeta perda antes do commit editorial, confirma graph_ready e 503 em consultas, altera o arquivo sem aprovação, reinicia a API e exige conciliação do snapshot original sem novas chamadas ao modelo. A API source-asof deve devolver a fonte publicada original e abster-se para um instante anterior à publicação. Isso não transforma o FAIL nativo de histórico de fatos em PASS.

Somente recursos Docker temporal-pilot-<id> são removidos. Não há prune ou exclusão recursiva de arquivos do usuário. .state, bancos privados, pesos e ambientes não integram o pacote. O daemon não é despausado se houver intervenção manual.
