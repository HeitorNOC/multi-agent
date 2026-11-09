# E1 — `aurora-business`: levantamento e recomendação

Data: 09/11/2026. Status: **levantamento concluído; nenhum código migrado.** Há uma decisão de escopo pendente (ver o fim).

## O que `aurora-business` é

Não é parte do servidor da jornada. É a **camada de qualificação** que o lançador Python (`apps/aurora/ops/local_engine.py`) sobe como serviços separados, com autenticação sintética (`/** Bounded qualification slice. Synthetic authentication; no production IdP. */`). O `server.ts` e o `aurora-api` **não importam nada dele**; o único consumidor é o lançador.

| Módulo | Linhas | Papel | Armazenamento (SQLite) |
|---|---:|---|---|
| `business.ts` | 1064 | Serviço HTTP: principals, grants, jobs, aprovações, cobranças, leituras, efeitos, auditoria | `principals`, `grants`, `jobs`, `approvals`, `charges`, `reads`, `effects`, `audit`, `inference_requests` |
| `editorial.ts` | 275 | Worker de fontes canônicas (rascunho → revisão → publicação), lê o vault de Markdown | `drafts`, `audit`, `canonical` |
| `brain.ts` | 131 | Fronteira com a projeção LightRAG | `brain_releases`, `brain_control` |
| `retained.ts` + `inference_recovery.ts` + `recovery_queue.ts` + `inference.ts` | 1852 | **Autoridade de auditoria e orçamento retidos fora do backup** | `retained_receipts`, `retained_lock`, `retained_tombstones` e outras |

~77 chamadas SQL síncronas só em `business.ts`, com transações `BEGIN IMMEDIATE`.

## Achados que mudam o plano

1. **`retained` não deve ir para o PostgreSQL principal.** Ele existe para sobreviver à restauração do estado (`retained-outside-backup.sqlite`, requisito R14). Colocá-lo no mesmo banco desfaria a propriedade já qualificada. Fica em armazenamento separado, por decisão de projeto.
2. **Não há testes executáveis neste repositório.** Os testes existentes ficam em `validation/` e são integrações em Python que dependem de Docker, LangGraph, LightRAG, modelos e de venvs que agora estão fora do Git. Alguns TypeScript em `validation/` testam **cópias antigas** dos módulos. Sem rede de segurança, migrar seria editar às cegas, o oposto do que fizemos no ledger.
3. **Autenticação sintética e fatia delimitada.** O próprio código se declara descartável. O produto precisa de identidades, agentes, tarefas, entregas e aprovações próprios (épicos E2 a E7), e o modelo dessas entidades hoje não existe em `business.ts`.
4. **O ledger já tem o que o produto precisa de base**: fila, admissão idempotente, eventos auditáveis, efeito único, aprovação exata e recuperação.

## Recomendação

Não portar `business.ts` um para um. Em vez disso:

1. Manter `aurora-business` como está, **congelado como referência de qualificação**, sem migrar para PostgreSQL.
2. Construir as entidades do produto (E2 a E7) **diretamente sobre a porta do ledger**, estendendo-a por operações de domínio (identidade e grants, orçamento por trabalho, agentes, entregas), cada uma com contrato e testes nos dois adaptadores, como foi feito até aqui.
3. Reaproveitar de `business.ts` apenas as **regras** que já foram qualificadas (reserva e cobrança de unidades, aprovação exata, grants por fonte), reescrevendo-as com testes, e não o código.
4. `retained` continua separado; só se decide o armazenamento dele junto com a decisão de backup e recuperação do host (P07).

## Alternativa (se a migração 1:1 for exigida)

Seria uma sequência própria, nesta ordem, cada passo com testes de caracterização antes de mexer:

1. Testes de caracterização HTTP de `business.ts` (serviço sob stdin + HTTP, como o `aurora-api`): ~2 a 3 dias de trabalho.
2. Porta e adaptador PostgreSQL de `business.ts` (9 tabelas, ~77 chamadas): ~3 a 4 dias.
3. `editorial.ts` e `brain.ts`: ~1 a 2 dias.
4. Reexecutar as integrações de `validation/` (exige restaurar os venvs e a pilha Docker).

Estimativas grosseiras, sem medição. Custo alto para código que a própria documentação trata como fatia de qualificação.

## Decisão pendente

Seguir a **recomendação** (começar o E2 sobre o ledger, extraindo regras de `business.ts`) ou fazer a **migração 1:1** de `business.ts`, `editorial.ts` e `brain.ts`.
