# v1 congelada

Tudo que existia antes da v2 está aqui, com a mesma estrutura relativa de antes (`legacy/apps/aurora`
corresponde ao antigo `apps/aurora`, e assim por diante). Os caminhos internos da v1 continuam
válidos dentro desta pasta.

- `apps/aurora/` — bancada Aurora (interface 3D, runtime Python da v1, central de recuperação antiga).
- `apps/omnichannel/` — vertical de atendimento (WhatsApp); referência para as integrações da v2.
- `packages/aurora-api/` — API da v1 (journey ledger, conversa, Cérebro, trabalho aberto).
- `packages/aurora-business/` — fatia de qualificação; não portada.
- `demo/`, `demo-enterprise/`, `poc/`, `validation/`, `research/`, `reports/`, `vendor/`, `evidence/`
  — investigação, ensaios e evidências históricas.
- `docs/` — documentos da v1. O plano em vigor é [docs/REPLANEJAMENTO_V2.md](../docs/REPLANEJAMENTO_V2.md).
- `README.md` e `package.json` — os da raiz na época da v1.

Nada aqui é distribuído com a v2 nem recebe correções. Dados de uma instalação da v1 passam para a
v2 com `npm --prefix apps/api run migrate:v1 -- --from-sqlite <journey.sqlite>` (ou
`--from-postgres <url> [--from-schema <esquema>]`).
