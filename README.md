# Aurora

Plataforma empresarial multiagente. O gestor conversa com o **Chief of Staff**, que escala
**especialistas**. Eles analisam usando somente as fontes do **Cérebro** (a base de conhecimento
da empresa) e devolvem um parecer com citações. Nada sai para fora sem **aprovação humana do
parecer exato**.

O modelo roda no computador da empresa, pela CLI oficial (Claude Code ou Codex) já autenticada
na conta da própria pessoa. O Aurora nunca lê nem guarda credenciais.

## Estrutura

```
apps/api/        API (Node 24 + TypeScript, Fastify, Zod) — SQLite ou PostgreSQL
  src/main.ts        ponto de entrada
  src/server.ts      raiz de composição (único lugar que conhece as implementações)
  src/config.ts      configuração AURORA_* validada
  src/shared/        ids com marca, erros, relógio, JSON canônico
  src/platform/      banco, trilha de eventos, HTTP, modelo, workers
  src/modules/       jobs · knowledge · open-work · conversations · recovery · agents ·
                     deliverables · routines · integrations · overview
  src/tools/         migração de dados da v1
apps/web/        interface (Vite + React + Tailwind + shadcn/ui), servida pela API
  src/app/           layout com sidebar, rotas, tema
  src/features/      uma pasta por área do menu
  src/lib/           cliente da API e formatação
apps/runtime/    worker Python (LangGraph com checkpoints em PostgreSQL)
docs/            plano da v2
legacy/          v1 congelada (bancada Aurora, investigação, evidências)
```

Cada módulo segue a mesma divisão: `domain/` (regras puras), `application/` (casos de uso),
`infrastructure/` (SQL) e `http/` (rotas). Os detalhes estão em [docs/REPLANEJAMENTO_V2.md](docs/REPLANEJAMENTO_V2.md).

## Como rodar

```bash
npm run install:all
```

```bash
npm run setup:runtime
```

```bash
npm run build
```

```bash
npm start
```

A interface fica em `http://localhost:<porta>` (a API imprime o endereço ao subir; fixe com
`AURORA_PORT`). Para desenvolver a interface com recarga automática, suba a API com
`AURORA_PORT=4100` e rode `npm run dev:web`.

Sem nenhuma variável, a API usa SQLite em `apps/api/data/aurora.db`, deixa os trabalhos na fila
(sem worker) e responde o Cérebro de forma extrativa (sem modelo). Para o fluxo completo:

| Variável | Para quê |
| --- | --- |
| `AURORA_DATABASE_URL` | PostgreSQL (`postgres://...`); sem ela, SQLite em `AURORA_SQLITE_PATH` |
| `AURORA_WORKER_COMMAND` | worker como lista JSON, por exemplo `["apps/runtime/.venv/Scripts/python.exe","-I","apps/runtime/open_worker.py"]` (no Linux/macOS, `.venv/bin/python`) |
| `AURORA_CHECKPOINT_DSN` | PostgreSQL dos checkpoints do LangGraph |
| `AURORA_MODEL_PROVIDER` | `claude`, `codex` ou `none` |
| `AURORA_CHIEF_ENGINE` | `rules` ou `model` (o Chief of Staff na conversa) |
| `AURORA_KNOWLEDGE_ANSWERER` | `extractive` ou `model` (as respostas do Cérebro) |
| `AURORA_QUEUE_CAPACITY`, `AURORA_RESUME_RESERVE`, `AURORA_MAX_WORKERS` | capacidade da fila |
| `AURORA_TIMEZONE` | fuso das rotinas e do painel (IANA); padrão: o do computador |

A lista completa e os padrões estão em [apps/api/src/config.ts](apps/api/src/config.ts).

## Verificar

```bash
npm run verify
```

Com `AURORA_TEST_POSTGRES_URL` definida, os testes rodam também no PostgreSQL e incluem os
cenários de ponta a ponta com o worker Python real.

## Garantias

- Transações serializadas e atômicas nos dois bancos; nenhuma leitura parcial.
- O efeito aprovado é executado uma única vez; repetir devolve o mesmo recibo.
- A aprovação vale só para o parecer exato (hash do trabalho, do relatório e do efeito).
- Cada chamada ao modelo tem recibo. Uma chamada sem recibo depois de uma queda nunca é repetida
  sozinha: o trabalho vai para a central de recuperação e uma pessoa decide, com justificativa.
- Os agentes só leem fontes abertas a toda a empresa, vigentes e não substituídas. Toda citação
  precisa ter sido entregue ao trabalho. O Chief of Staff só escala agentes contratados.
- O efeito aprovado gera a entrega na mesma transação do recibo; só a versão aceita sai da empresa.
- Cada horário de uma rotina vira no máximo um trabalho, mesmo depois de reiniciar.
- Integrações agem só com a permissão dada; o que não foi autorizado é recusado e registrado.

## Áreas

Command Center, Conversa, Trabalhos, Entregas, Rotinas, Cérebro, Agentes (catálogo e time),
Organograma, Integrações, Governança (central de recuperação), Configurações e o assistente
"Montar sua empresa". O andamento e os próximos passos estão em [docs/REPLANEJAMENTO_V2.md](docs/REPLANEJAMENTO_V2.md).
