# E1 — Ledger em PostgreSQL: levantamento e plano

Status (09/11/2026): **o servidor sobe e funciona sobre PostgreSQL.** A porta `JourneyLedger` cobre jornada, eventos, fila, admissão, efeitos, revogações, destino do piloto e a central de recuperação, com adaptadores SQLite e PostgreSQL que passam no mesmo contrato (35 testes cada). As 24 provas HTTP do servidor real passam nos dois armazenamentos.

| Peça | Arquivo | Situação |
|---|---|---|
| Porta (interfaces de domínio) | `packages/aurora-api/ledger/journey-ledger.ts` | pronta |
| Adaptador SQLite | `ledger/sqlite-journey-ledger.ts` | pronto (mutex, trava de agendador) |
| Adaptador PostgreSQL | `ledger/postgres-journey-ledger.ts`, `postgres-migrate.ts` | pronto (advisory locks, migrations) |
| Escolha do driver | `ledger/open-ledger.ts` | pronta; `config.ledger` |
| Contrato executável | `ledger/journey-ledger.contract.ts` | 35 testes, roda nos dois adaptadores |
| Caracterização HTTP | `packages/aurora-api/test/` | 24 testes, rodam sobre SQLite e sobre PostgreSQL |
| Central de recuperação | `recovery.ts` | migrada para a porta (assíncrona) |
| Migração de dados SQLite → PostgreSQL | `ledger/sqlite-to-postgres.ts`, `migrate-cli.ts` | pronta; verificada por hash e ponta a ponta |
| Trava do agendador | adaptadores | SQLite: `scheduler-owner.sqlite`; PostgreSQL: advisory lock de sessão |

**Escolher o armazenamento** (configuração da instalação, lida pelo servidor):

```json
{ "ledger": { "driver": "postgres", "connectionString": "postgres://...", "schema": "opcional" } }
```

Sem `ledger`, o servidor usa SQLite no diretório de estado, como antes.

**Migrar uma instalação existente de SQLite para PostgreSQL:**

1. Pare o servidor da instalação (a CLI recusa se a origem estiver em uso).
2. Simule primeiro; nada é gravado:

```bash
node packages/aurora-api/ledger/migrate-cli.ts --state <diretorio-de-estado> --url postgres://... --installation <id> [--schema <nome>] --dry-run
```

3. Repita sem `--dry-run`. A cópia roda numa transação e só confirma depois de conferir contagem e hash do conteúdo de cada tabela e a ordem de listagem dos trabalhos.
4. Acrescente `ledger` à configuração e inicie o servidor.

A origem nunca é alterada, então voltar atrás é remover `ledger` da configuração. O destino precisa estar vazio; a CLI não sobrescreve dados. Bancos antigos, sem as colunas de identidade dos eventos, recebem as mesmas identidades legadas que o servidor atribui ao abri-los. O `--installation` precisa ser o mesmo da configuração (ele entra na identidade legada e na trava do agendador).

**Rodar os testes:**

```bash
npm run test:api                                   # SQLite (o do PostgreSQL é ignorado)
AURORA_TEST_POSTGRES_URL=postgres://postgres:dev@127.0.0.1:55432/aurora_dev npm run test:api
AURORA_TEST_LEDGER=postgres AURORA_TEST_POSTGRES_URL=... npm run test:api   # servidor inteiro sobre PostgreSQL
```

Ainda fora da porta: os bancos de `aurora-business` e os `retained` (que devem permanecer separados), o outbox de telemetria e os estados Python.

Histórico do levantamento, ainda válido para as próximas fases:

## O que existe hoje (levantado no código)

Não há um ledger: há **vários bancos SQLite independentes**, todos via `node:sqlite` síncrono (`DatabaseSync`).

| Banco / origem | Conteúdo | Chamadas SQL | Observação |
|---|---|---|---|
| `journey.sqlite` (`aurora-api/server.ts`) | jobs, events, effects, job_queue, job_admissions, revogações do piloto | ~36 no arquivo, ~30 transações | Alvo principal do E1 |
| `scheduler-owner.sqlite` | trava exclusiva do agendador (`BEGIN EXCLUSIVE`) | 1 | Vira advisory lock |
| `recovery.ts` | sessões e comandos da central humana | — | Mesma migration |
| `business.sqlite` (`business.ts`) | principals, grants, jobs, approvals, charges, effects, audit, inference_requests | ~267 no total dos pacotes | Fase seguinte |
| `brain.ts`, `editorial.ts` | releases, drafts, canonical, audit | — | Fase seguinte |
| `retained.ts` | recibos retidos, lock, tombstones | — | **Não migrar para o mesmo banco** (ver abaixo) |

Há ainda estados SQLite do lado Python (`native.py`, `local_engine.py`).

## Por que não migrei `server.ts` ainda

1. **Toda a camada é síncrona.** PostgreSQL via `pg` é assíncrono; cada uma das ~30 transações `transaction(() => {...})` vira `await`, e isso muda a ordem de execução dentro dos handlers HTTP. Não é troca de driver.
2. **As garantias de recuperação foram qualificadas contra a semântica do SQLite** (`BEGIN IMMEDIATE`, escritor único, `synchronous=FULL`). No Postgres é preciso reprovar o mesmo comportamento com travas de linha, `SERIALIZABLE` ou advisory locks.
3. **`aurora-api` e `aurora-business` não têm testes.** Sem rede de segurança, migrar é editar às cegas. Os testes de caracterização vêm primeiro.
4. **Ambiente de verificação ausente nesta máquina:** Node 20 (o código exige 24 para `node:sqlite`) e nenhum PostgreSQL local. Há Docker e `nvm`, ainda não usados.

## Decisões de projeto

- **Estratégia estrangulador, uma store por vez.** Introduzir uma porta assíncrona (`LedgerStore`) com duas implementações, SQLite (atual) e PostgreSQL. Um **teste de contrato único** roda contra as duas. Trocar de uma para outra é configuração.
- **Ordem:** (1) journey ledger, (2) recovery, (3) business, (4) brain/editorial.
- **Mapeamento sem mudança de regra:** datas continuam `TEXT` ISO (preserva hashes gravados); booleanos continuam `0/1`. Ver [001_journey_ledger.sql](../packages/aurora-api/migrations/001_journey_ledger.sql).
- **Equivalências de semântica:**
  - `BEGIN IMMEDIATE` → transação com `SELECT ... FOR UPDATE` nas linhas afetadas ou `pg_advisory_xact_lock` por job.
  - `BEGIN EXCLUSIVE` do `scheduler-owner` → `pg_try_advisory_lock` de sessão; o processo que não obtém a trava encerra.
  - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`; `.changes` → `rowCount`.
  - `lastInsertRowid` → `RETURNING seq`.
- **`retained.ts` fica fora do banco de backup.** Os recibos retidos e a autoridade existem para sobreviver à restauração do estado principal (o arquivo se chama `retained-outside-backup`). Colocá-los no mesmo PostgreSQL desfaria a propriedade qualificada (R14). Devem permanecer em instância, banco ou arquivo separado, com backup distinto.
- **Perfil local simples:** como a instalação é de uma máquina, o PostgreSQL roda local (container ou serviço). O SQLite continua como fallback de desenvolvimento enquanto a porta existir.

## Ambiente de verificação (validado em 09/11/2026)

- Node 24 sem trocar o padrão da máquina: `export PATH="/c/Users/consenso/AppData/Local/nvm/v24.19.0:$PATH"`. `node:sqlite` funciona e `npm run verify` passa.
- PostgreSQL descartável: `docker run -d --name aurora-pg-dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=aurora_dev -p 127.0.0.1:55432:5432 postgres:16`.
- A migration 001 foi aplicada duas vezes sem erro (idempotente) e criou as 11 tabelas.
- A suíte do `omnichannel` passou 5/5 contra esse Postgres (`OMNICHANNEL_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:55432/omni_test`).

## Próximos passos

1. **`aurora-business`** (business, brain, editorial) para a mesma porta ou uma porta própria. `retained` continua em armazenamento separado (ver decisões acima).
2. ~~Migrar dados existentes~~ **feito** (ver acima). Pendente: migrar também os estados que ficam fora do `journey.sqlite` quando entrarem na porta.
3. **Reexecutar as bancadas de recuperação** (P01, P07) contra o PostgreSQL, incluindo backup e restauração do banco, antes de declarar o E1 concluído.
4. **Carga e concorrência real**: dois processos disputando o lock, pool sob carga e latência por operação. O contrato prova correção, não desempenho.
5. Backup operacional do PostgreSQL local (hoje o procedimento cobre SQLite e volumes de LightRAG).
