# Backlog do MVP — módulos da especificação funcional

Origem: *Especificação funcional do sistema empresarial com agentes de IA* (09/11/2026, inferida de vídeo) e o estado atual do Aurora. O documento descreve só a interface de um produto de terceiros; aqui cada módulo vira entrega com critério de aceite verificável. O núcleo já existente (fila durável, aprovação exata, recibos, recuperação) **não é refeito**: os módulos novos o usam.

Decisões vigentes: provedor local via CLI oficial (Codex ou Claude Code) autenticada pelo usuário; provedor remoto (API) só depois do produto, pelo mesmo contrato [`model_provider.py`](../apps/aurora/runtime/services/model_provider.py). Uma máquina por instalação. Dados sintéticos até haver gate de produção.

## Ordem sugerida

| # | Épico | Situação hoje | Depende de |
|---|---|---|---|
| E0 | Fundação: repositório, CI, contrato de provedor | **Feito** neste ciclo (parcial: falta migrar o ledger, ver E1) | — |
| E1 | Ledger em PostgreSQL (P13) | **Feito** para o ledger da jornada (ver [E1_LEDGER_POSTGRES](E1_LEDGER_POSTGRES.md)); `aurora-business` congelado ([decisão](E1_AURORA_BUSINESS.md)) | E0 |
| E2 | Conversa com o Chief of Staff | **Feito** (versão por regras; ver abaixo) | E1 |
| E3 | Cérebro: upload, consulta com citação | Motor e grafo prontos; falta UI de ingestão | E1 |
| E4 | Agentes: ativar do catálogo e criar o seu | Catálogo de 21 agentes | E1 |
| E5 | Entregas: artefato, revisão, aceite | Relatório de decisão e aprovação exata | E2, E4 |
| E6 | Rotinas agendadas | **Ausente** | E4, E5 |
| E7 | Integrações (uma primeiro) | Só WhatsApp/Kafka no `omnichannel` | E4 |
| E8 | Command Center e organograma funcionais | Painéis parciais | E2–E6 |
| E9 | Loja e workspaces de marketing | Ausente | fase 2 |

## Critérios de aceite por épico

**E1 — Ledger PostgreSQL.** Migrations versionadas para jobs, events, effects, job_queue e job_admissions. A suíte atual de recuperação passa sem mudar de comportamento (sem efeito duplicado, unknown nunca vira sucesso). Rollback documentado.

**E2 — Conversa.** O gestor envia uma intenção; o Chief of Staff responde ou abre um trabalho. A resposta mostra se virou trabalho, quem recebeu e o estado. Histórico persistente por empresa e usuário.

  *Entregue (09/11/2026):* porta do ledger com conversas e mensagens (SQLite e PostgreSQL), `ConversationService`, interface `ChiefOfStaff` com implementação determinística por regras que escolhe entre os cenários da política, rotas `/api/conversations` e painel React. Abrir o trabalho e gravar a resposta acontecem na mesma transação; reenvio com `client_message_id` não duplica; recusas da admissão são explicadas. Pendente: Chief of Staff com modelo (via `ModelProvider` local), identidade corporativa (hoje operador local ou usuário do piloto) e aviso ativo quando o parecer fica pronto (hoje a conversa mostra o estado ao ser relida).

**E3 — Cérebro.** Upload de arquivo com tipo, dono, versão, data e permissão. Consulta devolve a resposta com citação clicável até a fonte original. Duas fontes conflitantes resultam em abstenção ou apontam a vigente. Revogar uma fonte a retira das respostas seguintes.

**E4 — Agentes.** Separar `AgentTemplate` (catálogo), `Agent` (instalado na empresa) e `AgentExecution` (instância). "Criar meu agente" gera um agente com instruções, conhecimento e ferramentas permitidas. Dois agentes distintos na mesma tarefa produzem execuções distintas, com ferramentas registradas.

**E5 — Entregas.** Toda saída vira `Deliverable` com fontes e versão. Fluxo: rascunho → revisão → aceito ou rejeitado, com justificativa e auditoria. Rejeitar reabre o trabalho sem duplicar efeitos.

**E6 — Rotinas.** Agendamento por horário e recorrência. Disparo, retry com limite e histórico por execução. Reinício do processo não perde nem duplica uma rotina. Respeita fila, orçamento e aprovação.

**E7 — Integrações.** Um conector real (sugestão: arquivos locais ou e-mail). Escopo por agente, credencial fora do código e do log, revogação, auditoria. Leitura e escrita autorizadas funcionam; ação não autorizada é bloqueada.

**E8 — Command Center.** Mostra trabalhos ativos, aprovações pendentes, falhas, consumo de modelo e entregas recentes com dados do backend. O organograma abre o trabalho e o agente a partir do nó.

## Uso da assinatura e limite de cota (provedor local)

Como o uso é pela conta do usuário, a cota é o recurso escasso. Medidas já previstas ou a implementar:

- **Orçamento por trabalho em chamadas** (`max_model_calls`) já existe; expor na UI e tornar configurável por empresa.
- **Admissão e fila** já limitam concorrência (1 a 2 workers); adicionar limite por janela de tempo (chamadas por hora) e pausa automática ao detectar erro de cota.
- **Prioridade**: aprovações e retomadas passam à frente de rotinas.
- **Rotinas fora do pico**: agendar por padrão fora do horário de trabalho do gestor.
- **Cache de resultados** pelo hash do prompt já registrado em `model-calls.jsonl`; reaproveitar quando fonte e instruções não mudaram.
- **Modelo por tarefa**: modelo menor para classificação e extração, maior só para síntese e decisão.
- **Medir antes de otimizar**: o registro de uso por chamada (tokens, duração, modelo) é a base de qualquer decisão.

## Fora do escopo agora

Provedor remoto, cobrança, identidade corporativa (SSO), multi-máquina, Loja e workspaces de marketing. Entram depois do produto funcional, conforme decisão registrada.
