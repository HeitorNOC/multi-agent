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
| `AURORA_AUTH` | `local` (padrão: uso individual no próprio computador, sem login) ou `accounts` (cada pessoa entra com a própria conta) |
| `AURORA_GOOGLE_CLIENT_ID`, `AURORA_GOOGLE_CLIENT_SECRET` | liga Google Drive e Gmail em Integrações (e o "Entrar com Google" no modo com contas) |
| `AURORA_SECRET_KEY` | chave do cofre de tokens das integrações (64 hex); sem ela, o Aurora cria `aurora.key` ao lado dos dados |
| `AURORA_MICROSOFT_CLIENT_ID`, `AURORA_MICROSOFT_CLIENT_SECRET`, `AURORA_MICROSOFT_TENANT` | liga o botão "Entrar com Microsoft"; o tenant é `common` (padrão), `organizations` ou o id do diretório da empresa |

A lista completa e os padrões estão em [apps/api/src/config.ts](apps/api/src/config.ts).

### Acesso

Por padrão o Aurora roda sem login, para uma pessoa no próprio computador (`AURORA_AUTH=local`).
Com `AURORA_AUTH=accounts`, no primeiro acesso o Aurora pede a conta do dono (e-mail e senha, ou Google/Microsoft). Ela fica
com tudo o que já tinha sido feito como operador local. Depois, só entra quem o dono liberar em
**Configurações › Acesso**: a pessoa entra com Google ou Microsoft usando o e-mail liberado, ou
cria uma senha em "Criar conta". A sessão fica num cookie HttpOnly por 30 dias; senhas são
guardadas só como hash (scrypt). Do Google e da Microsoft o Aurora guarda apenas quem é a pessoa,
nenhum token.

Para ligar o login com Google, crie um "ID do cliente OAuth" do tipo **Aplicativo da Web** no
Google Cloud e cadastre o endereço de retorno `http://localhost:<porta>/api/auth/oauth/google/callback`
(fixe a porta com `AURORA_PORT`). Na Microsoft, registre um aplicativo no Entra ID com a plataforma
**Web** e o retorno `http://localhost:<porta>/api/auth/oauth/microsoft/callback`. A tela de
Configurações mostra os endereços exatos.

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
- Os agentes só leem fontes vigentes e não substituídas: as abertas a toda a empresa e as restritas
  em que foram incluídos. Na Estação, só o que a pessoa que pergunta também pode ler. Toda citação
  precisa ter sido entregue ao trabalho. O Chief of Staff só escala agentes contratados.
- Toda rota da API exige uma pessoa identificada (sessão) ou, no uso individual, o operador local.
- O efeito aprovado gera a entrega na mesma transação do recibo; só a versão aceita sai da empresa.
- Cada horário de uma rotina vira no máximo um trabalho, mesmo depois de reiniciar.
- Integrações agem só com a permissão dada; o que não foi autorizado é recusado e registrado.

## Áreas

Command Center, Conversa, Trabalhos, Entregas, Rotinas, Cérebro, Agentes (catálogo e time),
Organograma, Integrações, Governança (central de recuperação), Configurações e o assistente
"Montar sua empresa". O andamento e os próximos passos estão em [docs/REPLANEJAMENTO_V2.md](docs/REPLANEJAMENTO_V2.md).

## Documentação

- [Guia do Aurora](docs/GUIA.md): o que é e como usar, sem jargão.
- [Arquitetura e fluxos](docs/ARQUITETURA.md): tecnologias, módulos, fluxos e garantias.
- [Dados, Cérebro e agentes](docs/DADOS_CEREBRO_AGENTES.md): onde tudo fica, envio e busca no Cérebro, recuperação após falhas, orquestração e o que cada agente faz.
