# Atualização para a conversa original — plataforma multiagente

Use este resumo e o relatório técnico completo anexo para atualizar a proposta de observabilidade e orquestração. Estado conferido em 05/11/2026 no workspace `C:\Users\PC\multi-agent`. Foram lidos código/evidências e consultados os serviços locais, sem novas inferências ou E2E nesta documentação.

## Decisão e escopo

Mantemos **camada própria TypeScript + runtime Python/LangGraph + LightRAG**, com instalação dedicada por empresa e cérebro lógico central. **LangGraph é o único owner de workflow**. PostgreSQL/pgvector e Neo4j são usados no conhecimento; PostgreSQL também persiste checkpoints. A API empresarial das demos usa **SQLite**, e a migração do domínio para PostgreSQL ainda não aconteceu.

Paperclip saiu da arquitetura ativa. Corrigir uma conclusão antiga: a reavaliação demonstrou composição por adaptador externo sem fork; sua impossibilidade técnica **não foi confirmada**. Há dependência residual de build: React/esbuild/TypeScript são resolvidos nos node_modules daquele clone. A distribuição própria ainda precisa de locks/configuração independentes.

Existe MVP local demonstrável, mas **produção permanece NO-GO**. As demos foram autorizadas como entregas delimitadas após um gate negativo; não encerraram os bloqueios nem demonstraram viabilidade empresarial completa.

## Código e serviços existentes

- `demo/`: ACME/vendas-estoque; `server.ts`, `policy.ts`, `worker.py`, `start.py`, React/TS, testes e scripts PowerShell.
- `demo-enterprise/`: Aurora; catálogo de 21 agentes, corpus, política, worker com subgrafos, UI, scripts e testes. Reutiliza `demo/server.ts`.
- `validation/`: bancadas reutilizadas, especialmente `brain-recovery`, `concurrent-reconciliation`, `langgraph-business-flow`, `langgraph-retained-flow`, `governed-recovery`, `detached-inference` e `investment-gate`.
- `docs/`: desenho-alvo, R01–R21, plano e backlog; vários registros são históricos, não capacidades já entregues.
- `research/`, `poc/`, `vendor/`: pesquisa, auditorias e clones, não distribuição comercial.

Versões: Node 24.20.0; Python 3.12.14; TypeScript 7.0.2; React 19.2.8; esbuild 0.28.2; LangGraph 1.2.19; checkpoint 4.3.1; checkpoint-postgres 3.2.0; LightRAG 1.5.8; modelo das demos `gpt-6.1-terra` via Codex CLI; embedding MiniLM ONNX local de 384 dimensões.

Na captura: ACME `http://127.0.0.1:59587`; Aurora `http://127.0.0.1:58678`. Ambos ready, portas efêmeras de sessão, sem workers ativos. Não são deployments produtivos.

## Endpoints reais

API compartilhada: `GET /api/state`; `POST /api/jobs`; `POST /api/jobs/{id}/approve|reject|resume`. Rotas internas tokenizadas: `POST /internal/snapshot|event|plan|review|effect`. UI servida por `/`, `/app.js`, `/app.css`.

Backend Python: `POST /rpc` com `status`, `worker_config`, `retrieve`, `llm`, `stop`. Serviço LightRAG: `/rpc` assinado por HMAC; embedding: `/embed` assinado. Todos locais, com portas internas dinâmicas. A API tem checagem de Host/Origin e limite de corpo, mas **não há login empresarial**. Não existem API geral de busca/upload, SSE/WebSocket, cancelamento durável por trabalho ou health/readiness dedicados. A UI usa polling; Aurora a cada 1.300 ms.

## Orquestração e memória

ACME: Chief → dois especialistas → síntese → aprovação/interrupt → efeito local. Aurora: Chief seleciona diretorias → `Send` para subgrafos → especialistas → consolidação de cada diretor → síntese → aprovação → efeito local. Máximo de quatro diretorias/oito agentes; todos os excluídos recebem justificativa. O Chief é adicional aos 21 papéis do catálogo. Só os selecionados geram inferência.

Checkpoints PostgreSQL com `AsyncPostgresSaver`, `durability='sync'`, thread por trabalho; retomadas em processos novos. API guarda jobs, eventos, decisões, aprovação e recibo em SQLite. Slots de modelo persistem antes da inferência e vinculam prompt/resultado; unknown impede repetição automática.

Separar fonte canônica, projeção LightRAG, memória de execução e histórico original de decisões. Projeções atuais são por documento/versão, não um grafo corporativo global já validado. Staging usa revisor/assinatura de fixture, não editor humano na UI. Graphiti não está no runtime; Obsidian é opcional.

## Resultados comprovados

**ACME:** E2E PASS em 35,77 s, cinco checkpoints de aceite. Três documentos reais do corpus fictício; Chief e dois especialistas acertaram queda de receita de 20%, ausência de rupturas e causa não comprovada. Aprovação exata; saída controlada 88 depois de recibo e antes do checkpoint; retomada manteve o mesmo recibo e um efeito, sem inferência adicional. Quatro testes de política/API e strict passaram. Os dois trabalhos estão completed; a segunda aprovação foi explicitamente pedida pelo usuário e está registrada. Uso: 11 chamadas.

**Aurora:** 16 fontes vigentes + uma histórica não indexada; cenário empresarial fictício com várias áreas. Campanha: oito agentes selecionados/executados, 13 inativos, parecer **FAIL**. Incidente: quatro selecionados/executados, 17 inativos, parecer aceito e **awaiting_approval**, sem efeito. Seleção = execução = slots conferida nos dois. Incidente acertou 1.200 contatos potenciais e 65 minutos restantes; exfiltração não confirmada. Retomada não aumentou chamadas.

A campanha perdeu a reconciliação entre 5.000 pedidos no briefing e 5.000 unidades explicadas no Comercial; não consolidou 11.000 unidades combinadas com Orion/falta de 8.000. O verificador rejeitou o candidato. A causa entre retrieval e sumarizações ainda não foi isolada. **Resultado global Aurora FAIL**, preservado, sem relaxar gabarito. Oito testes de política, dois de embeddings, regressão HTTP compartilhada e strict passaram. Uso atual: 32 chamadas; entre tentativas Aurora, 55 reservas incluindo uma desconhecida. Tokens são medidos; custo monetário não.

Há PASS históricos de checkpoints, leases, fencing, ACL, idempotência, autoridade Ed25519 e restore frio local em novos volumes, com escopos diferentes. Não transferir automaticamente esses PASS ao produto atual.

## Bloqueios atuais

Quatro critérios de recuperação do gate V1 continuam reprovados: três janelas de `business_read_commit` — após intenção, após commit local e após recibo local antes de confirmar na autoridade — e encerramento de inferência sem recibo. O sistema bloqueia com segurança, mas não recupera operacionalmente a categoria. Checkpoint/restore não resolve sozinho o protocolo empresarial. Heartbeat automático opcional passou em ensaio delimitado; isso não homologa todos os caminhos.

Também faltam controlador A0–A4 completo, fontes/documentos arbitrários, gateway MCP/APIs, conectores reais, sandbox geral, identidade/ACL corporativas, cancelamento geral, PostgreSQL empresarial/migrations, DR externo/PITR/HA, orçamento em moeda e carga representativa. Keycloak/OpenFGA foram adiados pelo usuário; Glean/ServiceNow só tiveram estudo documental, sem instâncias.

## Observabilidade: atualizar a proposta a partir disto

Hoje há eventos locais por trabalho, timeline, estados, PIDs/exit codes, planos, fontes/hashes, slots, uso/tokens, métricas de embedding, recibos, provas e JUnit. **Não há stack distribuída de tracing/monitoramento integrada**. LangSmith tracing está desativado no spawn. Logs do fixture podem conter conteúdo completo; não estão homologados para dados confidenciais.

Precisamos correlacionar instalação, trabalho, thread/checkpoint, nó/task/parent, capacidade, plano/política/aprovação, fontes/trechos/versões/hashes, slot/modelo/recibo, intenção/recibo de efeito e epoch de lease. Trace deve acompanhar o workflow sem virar outro scheduler.

Prioridade: medir a cobertura e a transferência da evidência entre retrieval → especialista → diretor → síntese → verificador, para localizar o defeito Aurora. Separar saúde de serviço de sucesso correto/seguro do trabalho; registrar bloqueio/unknown e idade, não só HTTP 200. Métricas: qualidade/citações/conflitos, custo e latência por entrega/etapa, retrabalho/intervenção humana, motivos A0–A4, selecionados versus executados, replay sem nova inferência, recuperação e efeitos indevidos. Escolha de ferramentas de observabilidade ainda é proposta, não adoção.

## Git e próximos passos

A raiz **não é repositório Git**, portanto não há commits próprios verificáveis. Upstreams ativos: LangGraph `3c916d750575b22c464790e9774494d810ccd322`; LightRAG `aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a`. Manifests são rastreabilidade provisória: Aurora 25/25 conferidos; manifesto ACME antigo diverge em `server.ts`, posteriormente adaptado para Aurora. Regressão passou, mas o E2E ACME original não foi repetido inteiro nessa revisão.

Próximos passos: corrigir/requalificar quatro casos V1; instrumentar e resolver reconciliação Aurora; tornar política autoritativa na apresentação; criar repositório/locks/migrations próprios; instrumentar produto e só depois qualificar piloto com dados/ações reais.

Preservar R01–R21: instalação dedicada, cérebro central, histórias distintas, permissões, Chief/controlador A0–A4, equipes por capacidades, humano conforme risco, owner único, sandbox/ferramentas, recibos/unknown, orçamento, restore/antirollback, observabilidade/privacidade, JARVIS/3D, reaproveitamento TS/Python, Obsidian opcional, escala progressiva e condições comerciais. As fotos recebidas são referência visual; a UI atual é SVG 2D, não a experiência 3D completa.
