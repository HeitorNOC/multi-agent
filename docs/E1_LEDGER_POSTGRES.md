# E1 — Ledger em PostgreSQL: levantamento e plano

Status: levantamento e migration inicial prontos; **nenhuma linha de `server.ts` foi migrada**. Motivo abaixo.

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

## Próximos passos

1. Preparar o ambiente: Node 24 e PostgreSQL (Docker) para rodar a suíte.
2. Escrever testes de caracterização do journey ledger sobre o SQLite atual (fila, admissão, efeito único, retomada, revogação).
3. Extrair a porta assíncrona e a implementação SQLite; os testes continuam passando.
4. Implementar a versão PostgreSQL com a migration 001 e rodar o mesmo teste de contrato.
5. Repetir para recovery, business e brain/editorial.
6. Reexecutar as bancadas de recuperação existentes (P01, P07) contra o Postgres antes de declarar o E1 concluído.
