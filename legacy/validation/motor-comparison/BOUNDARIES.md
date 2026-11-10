# Fronteiras propostas após o comparativo

Proposta técnica, ainda sem implementação de produto ou deploy. O objetivo é reutilizar motores, conhecimento e governança, mantendo nossa camada para a política e os contratos empresariais.

## Distribuição de responsabilidades

| Responsabilidade | Reuso proposto | O que cabe à nossa camada |
|---|---|---|
| Organização, objetivos, responsáveis, contratação e aprovações | Paperclip por API/plugin se qualificado | Mapear identidades/políticas e adaptar a UI; não reimplementar seu control plane integral por preferência de linguagem |
| Workflow e estado da execução | LangGraph + saver | Definir etapas, limites, estratégia, correlação e política de retomada |
| Capacidade cognitiva e ferramentas | SDKs/provedores existentes; AgentScope opcional se justificar | Catálogo por capacidades, autoridade restrita e autorização de cada operação |
| Cérebro empresarial | LightRAG; Graphiti segue em avaliação para requisitos temporais | Knowledge API, metadados canônicos, ACL e integração de fontes; não reescrever retrieval/grafo |
| Colaboração | OpenAgents por API se necessário | Adaptador de eventos, inbox/outbox e identidade; não adicionar outro coordenador |
| Interface | React/TypeScript/Three.js próprios | JARVIS funcional com tarefas, aprovações, evidências e grafo clicável |
| Reserva e conciliação | Reusar governança/custos disponíveis após validar contrato | Reserva de execução/efeito, recibos e conciliação de todos os agentes sem dupla contabilização |

Nossa camada continua sendo trabalho relevante. O harness demonstra contratos; sua contagem de linhas não permite estimar prazo/custo do produto. Uma estimativa confiável depende da escolha do control plane, fontes e efeitos externos reais e requisitos operacionais de cada instalação.

## Contratos a congelar antes de implementar o produto

- **Identidade:** instalação, empresa interna, principal, tarefa/run, escopos, validade e versão de policy. O servidor deriva a autoridade da credencial; não aceita role ou company arbitrários do modelo.
- **ControllerDecision:** estratégia A0–A4, motivo, capacidades, concorrência, orçamento, risco e gatilhos de escalonamento. Chief of Staff comunica/sintetiza; controlador escolhe; LangGraph executa. Contratação permanente passa pela governança, temporário respeita limites prévios.
- **KnowledgeQuery/Result:** identidade autorizada, domínio/filtros, fontes com IDs e versões, proveniência, vigência e ACL. Resultado do workflow/checkpoint não é substituto do cérebro central persistente.
- **Approval:** operação e payload canônico, intenção, fontes relevantes/versões, hash e principal aprovador. Alterações materiais invalidam a aprovação anterior.
- **Budget:** período por instalação/empresa, unidade monetária base, reserva por tarefa/run, tarifas, margem, gasto parcial, consumo agregado e obrigação pendente. Cancelamento de executor não apaga custo já incorrido.
- **Effect:** chave empresa+intenção+operação vinculada a payload estável, estado pendente, recibo consultável e conciliação. Provedor sem idempotência/lookup exige outro desenho; não prometer exactly-once por ter UNIQUE local.
- **Events:** schema/version, event_id e correlação instalação/tarefa/run/agent, ordenação/fences, outbox e inbox com digest de payload. Repetição no transporte pode ocorrer; reexecução do efeito não deve ocorrer.
- **Recovery:** propriedade/lease da execução, checkpoint compatível, estado externo incerto e prova de parada. Não liberar trabalho dependente só porque o HTTP terminou ou o modelo escreveu done.

Na fixture, os estados relevantes foram created → running → waiting_approval → approved → effect_pending → completed, com cancel_requested/cancelled e budget_exceeded. São estados do contrato próprio do experimento; o mapeamento para Paperclip deve usar suas APIs e schemas reais, sem criar estados inexistentes no upstream.

## Deployment e sequência de qualificação

Instalação dedicada por cliente, com dados, secrets, logs, políticas, orçamento e backups isolados. Mesma base reutilizável, configuração por cliente, um cérebro central. Fronteiras lógicas não exigem um microserviço para cada bloco. TypeScript continua candidato para a camada empresarial e Python para IA; este harness Python não alterou essa preferência. Não adotar NestJS, Kafka, Temporal ou Redis por estética.

Próxima prova: mapear estes contratos para o componente real de governança escolhido e exercitar uma instalação dedicada com PostgreSQL e corpus representativo, mantendo o LangGraph como único dono do workflow. Qualificar fontes/ACL/híbrido/tempo, migração e backup, sandbox, custos reais de teste quando autorizados e APIs de efeito com garantias verificáveis. OpenAgents só entra como dependência obrigatória se houver necessidade concreta de sua colaboração além da delegação interna do motor.

A UI JARVIS permanece adiada até esses contratos e garantias serem aceitos. Não mudar a arquitetura para SaaS público, organograma fixo ou cérebro reduzido a chat/RAG simples.
