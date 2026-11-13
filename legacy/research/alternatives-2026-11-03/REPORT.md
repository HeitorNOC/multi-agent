# Alternativas após a retirada do Paperclip — 2026-11-03

**Decisão do usuário:** retirar Paperclip das opções de fundação e procurar soluções mais alinhadas. A auditoria anterior fica preservada como evidência histórica; não será convertida em afirmação de incapacidade intrínseca. A falha de cancelamento remoto também envolvia o boundary experimental desenvolvido na PoC.

**Resultado desta rodada:** triagem de dez repositórios com SHAs fixados, documentação, manifests, arquivos de arquitetura e alguns arquivos de execução/testes. Não instalamos essas alternativas, não rodamos suas suites e não fizemos integração nova. Nenhuma está aprovada. Claims de produção nos READMEs pertencem aos mantenedores.

## Resposta à pergunta: construíram do zero?

A evidência mostra diferentes combinações de código de produto e infraestrutura pronta. Criar a camada empresarial própria não exige criar um motor de agentes, mecanismo RAG ou scheduler durável próprio. A pergunta útil passa a ser: qual responsabilidade cada projeto implementou e qual delegou a bibliotecas/serviços existentes?

| Projeto | Solução observada | Parte própria / reutilização | Papel sugerido |
|---|---|---|---|
| Eigent | Desktop com equipe multiagente | UI React/TS/Electron e integração próprias; Python/FastAPI; CAMEL Workforce | Prioridade: aplicação de equipes e composição do runtime |
| CAMEL | Framework multiagente | Primitivas próprias de agentes/Workforce, modelos/tools como integrações | Alternativa de motor a comparar com LangGraph, não camada adicional obrigatória |
| OpenCompany (zeenie-ai) | Empregados formados por líder/especialistas, tarefas/delegação, integrações | Loop de agente Python próprio com SDKs de modelos; Temporal para durabilidade; UI React/React Flow | Prioridade: produto próximo do conceito e arquitetura de execução |
| AgentScope 2.0 | Framework, serviço de agentes, times, permissões, sandbox e memória plugável | Primitivas/TeamPipeline próprias; SDKs de modelos, FastAPI, backends de memória como ReMe | Prioridade: runtime e contrato de interrupção, comparado ao LangGraph |
| OpenAgents | Workspace/rede de colaboração humano-agente | Protocolo e pipeline de eventos próprios; FastAPI/SQLAlchemy/PostgreSQL no workspace; agentes externos | Prioridade: colaboração, identidade/eventos e integração de runtimes |
| Onyx | Conhecimento empresarial, conectores, busca/agentes | Produto de busca/ingestão e permissões; infraestrutura de indexação/modelos/storage pronta | Referência para cérebro/ACL; não demonstrado como orquestrador empresarial completo |
| CrewAI | Framework de equipes e Flows | Abstrações próprias de agents/tasks/crews/flows, com SDKs/storage/ferramentas existentes | Comparação de motor; separar OSS de AMP empresarial |
| OpenCompany (useopencompany) | Workspace com tarefas duráveis e wiki | Camada empresarial TS própria; Vercel AI SDK, Hono/Fastify, Postgres/Drizzle e serviços externos | Referência de decomposição; não prioridade para base local independente |
| Dify | Plataforma de workflows/RAG/plugins | Produto e engine de workflows próprios; integrações/infra prontas | Referência de ferramentas e knowledge pipelines; escopo/licença exigem filtro |
| Open Agent Platform | Interface sobre LangGraph e LangConnect | UI/configuração em cima de runtime e RAG existentes | Somente referência histórica: repositório arquivado |

## 1. Eigent / CAMEL: reutilizar o motor e construir a experiência

O README declara CAMEL como framework multiagente; backend/pyproject.toml fixa camel-ai[eigent]==0.2.91a7. backend/app/utils/workforce.py importa CAMEL ChatAgent, TaskChannel, eventos e Workforce como classe base; também liga journal/runtime próprios. Portanto há reutilização observável do framework, e a aplicação acrescenta experiência visual, integração e controles próprios. Não foi apenas uma UI genérica em volta de prompts.

**Aprendizado aplicável:** desenvolver a experiência JARVIS/empresarial sobre um runtime pronto pode ser uma separação válida. **Não demonstrado:** cérebro empresarial com ACL/tempo/proveniência; isolamento operacional por instalação; custos e cancelamento sob falha. Desktop local não equivale a implantação empresarial multiusuário. Root LICENSE/README indicam Apache-2.0, mas package.json informa MIT: registrar essa divergência para inventário antes de reutilizar/distribuir.

Fontes: [Eigent README](https://github.com/eigent-ai/eigent/blob/4958c94bd91faf4e0bfff270a971d4d1810fb6db/README.md), [dependência fixada](https://github.com/eigent-ai/eigent/blob/4958c94bd91faf4e0bfff270a971d4d1810fb6db/backend/pyproject.toml), [uso de CAMEL no código](https://github.com/eigent-ai/eigent/blob/4958c94bd91faf4e0bfff270a971d4d1810fb6db/backend/app/utils/workforce.py), [CAMEL](https://github.com/camel-ai/camel/blob/123f0c60f6efce7b420d6de2c3e046adb1f2cacc/README.md).

## 2. OpenCompany / zeenie-ai: o produto conceitualmente mais próximo encontrado nesta rodada

O projeto descreve um empregado como workflow com lead, especialistas, ferramentas, contexto, memória e skills. Documenta tarefas com atribuição, submissão e revisão. O README apresenta React/React Flow e backend Python. A documentação identifica run_native_agent_loop/ChatUnifier como camada própria, com SDKs nativos de provedores. Temporal aparece no manifest e na arquitetura de atividades/workflows para execução durável.

**Aprendizado aplicável:** o produto implementa organização/delegação e usa uma infraestrutura pronta para durabilidade. **Ressalva central:** Stop é documentado como bloquear novas admissões e deixar trabalho admitido terminar; não significa interrupção instantânea de todos os efeitos. Precisamos definir pausa, cancelamento e drenagem separadamente e testar. A memória descrita por agente/conversação não comprova cérebro empresarial semântico compartilhado com ACL e vigência. Temporal tem custo operacional e só deve entrar se justificar a lacuna real, preservando um único dono de cada agenda/estado.

Fontes: [produto](https://github.com/zeenie-ai/OpenCompany/blob/dc69aec7cfa70732de486512c1ba424bb855fd52/README.md), [loop próprio](https://github.com/zeenie-ai/OpenCompany/blob/dc69aec7cfa70732de486512c1ba424bb855fd52/docs-internal/agent_architecture.md), [Temporal](https://github.com/zeenie-ai/OpenCompany/blob/dc69aec7cfa70732de486512c1ba424bb855fd52/docs-internal/TEMPORAL_ARCHITECTURE.md), [Stop/Resume](https://github.com/zeenie-ai/OpenCompany/blob/dc69aec7cfa70732de486512c1ba424bb855fd52/docs-internal/temporal-workflow-control.md).

## 3. AgentScope 2.0: investigar o runtime atual, evitando documentação antiga

O README atual apresenta TeamPipeline, ferramentas/permissões/HITL, workspace/sandbox, serviço FastAPI e memória com backends intercambiáveis. Há implementação de TeamPipeline com tratamento de asyncio.CancelledError e propagação de UserInterruptEvent, além de arquivo de testes de cleanup. Isso é evidência estática mais concreta que apenas o nome de uma feature, mas não executamos esses testes nem demonstramos término de efeito remoto.

O repositório AgentScope Runtime separado anuncia integração das capacidades no AgentScope 2.0 e migração para o projeto principal. Portanto a investigação deve usar a geração atual. A marcação production-ready do README não substitui nossos gates; o pyproject também classifica o projeto como Beta. Seu suporte multi-tenant é uma capacidade interna: nossa entrega continua uma instalação por cliente.

Fontes: [AgentScope](https://github.com/agentscope-ai/agentscope/blob/9668b4c90c70cc214e1b7bb65dec2a6e70b90010/README.md), [TeamPipeline](https://github.com/agentscope-ai/agentscope/blob/9668b4c90c70cc214e1b7bb65dec2a6e70b90010/src/agentscope/pipeline/_team_pipeline.py), [teste de cleanup](https://github.com/agentscope-ai/agentscope/blob/9668b4c90c70cc214e1b7bb65dec2a6e70b90010/tests/pipeline_team_cleanup_test.py).

## 4. OpenAgents: colaboração como infraestrutura própria

O workspace possui backend FastAPI/SQLAlchemy e PostgreSQL, frontend Next.js/React e protocolo de eventos com join/leave/discover. A documentação descreve pipeline de auth/workspace/persistence, visibilidade de eventos e grupos. A camada de rede é própria; integrações de framework existem como opções no SDK.

**Aprendizado aplicável:** permitir que especialistas colaborem por eventos/canais sem transformar cada interação em organograma ou issue. **Não demonstrado:** catálogo dinâmico governado, reservas financeiras agregadas, recuperação de trabalho completo ou ACL de documentos e ferramentas. Visibilidade de eventos não é automaticamente permissão sobre conteúdo. SQLite mencionado no registry da arquitetura e PostgreSQL no workspace são componentes diferentes; não confundir os dois caminhos.

Fontes: [workspace](https://github.com/openagents-org/openagents/blob/6a330c789c321bdce5856578b7c47c2539ea7fc6/workspace/README.md), [arquitetura](https://github.com/openagents-org/openagents/blob/6a330c789c321bdce5856578b7c47c2539ea7fc6/docs/concepts/architecture.mdx), [grupos](https://github.com/openagents-org/openagents/blob/6a330c789c321bdce5856578b7c47c2539ea7fc6/docs/tutorials/agent-groups-permissions.mdx).

## 5. Onyx: estudar o conhecimento empresarial de forma independente

O projeto apresenta ingestão de múltiplas fontes com metadados/permissões e implantação self-hosted. O código de autorização consultado trata permissões por grupos e recursos. É uma referência para descobrir como conectores e autorização chegam à busca, não prova de um grafo de conhecimento temporal ou do nosso controlador.

Há separação entre código fora de ee sob MIT e diretórios ee com licença empresarial. Não presumir que a feature de segurança desejada esteja na edição redistribuível nem que CE/EE sejam equivalentes. Antes de escolher como dependência, rastrear exatamente qual feature depende de qual arquivo/licença. Nesta rodada não fizemos essa qualificação.

Fontes: [README](https://github.com/onyx-dot-app/onyx/blob/332b908f4a05090882ffaf7219d904c467bb7ce1/README.md), [política de licenças](https://github.com/onyx-dot-app/onyx/blob/332b908f4a05090882ffaf7219d904c467bb7ce1/LICENSE), [autorização](https://github.com/onyx-dot-app/onyx/blob/332b908f4a05090882ffaf7219d904c467bb7ce1/backend/onyx/auth/permissions.py).

## 6. Demais filtros

- **CrewAI:** documentação recomenda Flows como estrutura de estado/controle que contém Crews e agentes. O framework declara primitivas próprias; a plataforma comercial AMP é outra camada. Vale comparar com LangGraph no mesmo cenário, sem colocar dois coordenadores sobre a mesma decisão. [Fonte](https://github.com/crewAIInc/crewAI/blob/86dca29b536d700b69a97a3592857d5f9d4a8873/docs/edge/en/concepts/production-architecture.mdx).
- **useopencompany/opencompany:** distinto de zeenie-ai. README detalha Next.js, Hono, Fastify, Neon/Drizzle, WorkOS, Electric e AI Gateway. Declara que o setup ainda é orientado aos mantenedores e não documenta um caminho local independente de credenciais da organização. É boa referência TS para módulos empresariais/wiki/execução, mas esse setup aumenta adaptação ao nosso modelo dedicado por cliente. [Fonte](https://github.com/useopencompany/opencompany/blob/9c910df0d575d8420d43d04aca2ac0c91788eb69/README.md).
- **Dify:** é relevante para workflows, RAG e integrações; ainda não demonstrou a composição dinâmica/organização/cérebro exigidos aqui. A licença é Apache modificada com condições próprias, inclusive sobre frontend/marca e certos usos. A hipótese de instalação dedicada não resolve automaticamente todas as condições. Não priorizar como base sem avaliar aderência e distribuição comercial. [README](https://github.com/langgenius/dify/blob/eea40c683bbc8d2a396f80ee25ebfef1555a84ad/README.md), [licença](https://github.com/langgenius/dify/blob/eea40c683bbc8d2a396f80ee25ebfef1555a84ad/LICENSE).
- **Open Agent Platform:** arquivado no GitHub e README recomenda outro produto. Usava LangGraph deployments + LangConnect; demonstra composição de componentes, porém não é recomendação de base nova. A disponibilidade/licença do servidor de deployment é questão separada do MIT da UI. [Fonte](https://github.com/langchain-ai/open-agent-platform/blob/6a2ea0a3d019c20550b8d88ca0ed4d57df774ac8/README.md).

## Recomendações de pesquisa e próxima prova

**Prioridade de inspeção:** (1) OpenCompany/zeenie-ai e Eigent para a aplicação empresarial/equipe; (2) AgentScope 2.0 e OpenAgents para runtime, eventos e colaboração; (3) Onyx para conhecimento/ACL. CAMEL e CrewAI entram na comparação de motores com LangGraph. Os dez projetos não viram dez dependências.

Duas hipóteses permanecem abertas:

1. Adaptar uma aplicação completa próxima da proposta, se contratos/licença/isolamento satisfizerem os testes sem reescrever seu núcleo.
2. Compor bibliotecas maduras de execução e conhecimento, implementando uma camada empresarial própria e pequena para responsabilidades, capacidades, políticas, approvals, budgets e auditoria. Isso não equivale a reimplementar os motores.

O roteiro de teste para os finalistas deve ser igual: explicar queda de vendas com dados sintéticos de três departamentos; criar especialistas temporários por capacidades; recuperar fontes; revisar; aguardar aprovação; executar e-mail em inbox simulada. Em seguida: cancelamento antes/depois da admissão do efeito, duplicação, worker morto e retomado, limite de custo concorrente e tentativa de acesso a documento confidencial. Sem custos de APIs, produção ou segredos reais nesta fase.

Antes de executar: identificar engine/framework, banco/fila/checkpoints, identidade/ACL, extensão pública, restrições de licença/serviços externos e testes reais no SHA. Resultado final só após execução. As suites identificadas nesta pesquisa foram lidas seletivamente, não rodadas.

## Invariantes preservados

Instalação separada por empresa, um cérebro central persistente por instalação, ACL/proveniência/fontes/versões/tempo; Chief of Staff separado do Controlador Adaptativo; agentes por capacidades, temporários limitados e permanentes aprovados; colaboração transversal; JARVIS funcional com grafo vivo; Obsidian opcional; TypeScript/Python híbridos, sem NestJS compulsório; sem microserviços/fila/Temporal apenas por estética; nenhuma obrigação de conta pessoal; orçamento/política/auditoria server-side. LangGraph, LightRAG e Graphiti continuam candidatos, sem obrigação de permanecer se outra opção demonstrar melhor aderência; não serão reimplementados apenas para padronizar linguagem.

## Evidência e limites da coleta

inventory.json guarda SHA, data UTC, licença informada pelo GitHub, árvore de caminhos e hashes/URLs dos snapshots em sources/. Os SHAs são snapshots de pesquisa, não releases homologadas; versões transitivas não foram instaladas. Fonte do fabricante é descrição a verificar, não prova de robustez. README/manifests permitem afirmar dependências presentes; a ausência de uma dependência não prova ausência de toda integração possível.
**Atualização:** esta triagem estática foi seguida por validação de componentes em `../../validation/REPORT.md`. A recomendação preliminar de Eigent como aplicação de referência não equivale a backend aprovado; a rodada seguinte encontrou timeouts. Consultar o relatório novo para resultados de execução.
