# Dossiê de transferência para Codex — Plataforma empresarial multiagente
**Data de referência:** 2026-11-03  
**Origem:** Conversa “Analisar sistema de agentes” e anotações transferidas de investigação no ChatGPT Work.  
**Natureza:** Contexto e ordem de investigação técnica, NÃO aprovação prévia de nenhuma arquitetura, biblioteca ou operação comercial.

> **IMPORTANTE PARA O CODEX:** Este arquivo reúne o contexto substantivo disponível, mas não contém uma exportação literalmente integral, mensagem por mensagem, do histórico da conversa. Não alegue ter recebido ou lido o histórico integral se ele não estiver acessível no seu ambiente. Pergunte ao usuário apenas por elementos realmente indispensáveis que não estejam aqui.

## 0. Missão imediata
Realizar uma **prova de conceito reprodutível, usando código-fonte real**, para determinar se a plataforma open source **Paperclip** pode servir como control plane/gestão organizacional no sistema descrito abaixo, integrada a **LangGraph em Python** e **LightRAG**, preferencialmente **sem fork** do Paperclip. Examinar profundamente código e testes reais: adapters externos, ciclo de tarefas, autorização, heartbeats, filas, recuperação, custos, identidade, plugins, segregação e APIs. Não presumir “reutilizável” por existir no produto. Classificar cada componente como reutilizar, adaptar externamente, precisar de fork ou rejeitar. Testar antes de declarar sucesso. Apresentar o que foi realmente executado, versões/commits e evidências, inclusive falhas.

**Usuário autoriza continuar no Codex para estudo, execução de testes e PoC.** Não autorizou instalação de produção, compras, contratações de infraestrutura, publicação de código, acesso a segredos reais, alterações em projetos existentes ou despesas de APIs. Preferir simulações, fixtures e serviços locais sem custos até autorização explícita. Não começar a implementar todo o produto.

## 1. Escopo do produto — NÃO DESCARACTERIZAR
- Produto robusto, comercializável, implantado **separadamente para cada empresa cliente**. Mesmo código-base reaproveitável, configurações e integrações customizadas, **um cérebro central por instalação**, dados, segredos, execução, logs, políticas e orçamento isolados por empresa. **Não é** uma plataforma pública multi-tenant onde clientes simplesmente se cadastram.
- Centro de comando visual futurista, semelhante a uma UI JARVIS holográfica 3D, com grafo vivo/clicável de departamentos, agentes, conhecimento e ferramentas. Não é só decoração.
- **Cérebro empresarial persistente** com documentos, estrutura semântica de conhecimento, relações entre departamentos, indexação e busca híbrida, referências de fonte, versionamento, proveniência, vigência temporal, ACL/autorização. Não é um único prompt nem simples chat com RAG. Ex.: Marketing, Financeiro, Comercial, Engenharia, Políticas, Produtos são domínios exemplificativos, não esquema rígido.
- Fluxo conceitual: **Gestor humano/CEO → Chief of Staff AI → Controlador Adaptativo → equipe dinâmica de agentes** (especialistas por necessidade, paralelismo, revisão), consultando diretamente o cérebro e chamando ferramentas externas autorizadas por MCP/APIs. Especialistas podem colaborar transversalmente sem exigir mudança do organograma.
- **Chief of Staff** é a interface de planejamento, síntese, comunicação e acompanhamento do executivo. **Controlador Adaptativo** decide estratégia técnica, concorrência, seleção de capacidades, orçamento, risco e escalonamento. **Paperclip** (se aprovado) controla registro organizacional, responsabilidades, objetivos, atribuições, aprovações, custos. Impedir a existência de três autoridades concorrentes para a mesma decisão.
- Agentes/cargos **NÃO** são fixos. CEO, CMO, CFO, CTO, copywriter etc. apenas exemplos. Pode propor agente permanente (mediante política e aprovação) ou instanciar especialistas temporários dentro de limites prévios. Catálogo por capacidades, não apenas títulos.
- Modos: assessoramento ao gestor (planeja/propõe) e execução delimitada/autônoma com human-in-the-loop, auditoria e políticas.
- Reutilizar bibliotecas e sistemas prontos. **Não reimplementar LightRAG, Graphiti, LangGraph ou a lógica integral do Paperclip** apenas para padronizar linguagem.
- Preferências tecnológicas: usuário não gosta de NestJS; valoriza TypeScript, mas concordou com **Python para motor IA** devido ao ecossistema. Stack híbrida candidata: UI React/TypeScript (JARVIS/Three.js); plataforma empresarial TypeScript (Fastify se houver necessidade, não obrigatório); AI runtime Python + LangGraph; conhecimento LightRAG e avaliação Graphiti; PostgreSQL; MCP; Temporal/Kafka/Redis apenas se justificados. Não construir dezenas de microserviços por estética.
- JARVIS referência: https://github.com/adewaskar/jarvis (React+Vite+Three.js+GLSL, bridge e integrações; uso no produto dependerá de auditoria técnica/licença/ativos).
- Obsidian/Markdown pode ser camada de edição opcional, nunca dependência obrigatória de cada cliente; considerar Markdown canônico, knowledge API própria, grafo/retrieval.
- Não presumir que Paperclip seja fundação definitiva: pode acabar sendo referência, dependência parcial, fork controlado ou rejeitado.

## 2. Pesquisa acadêmica do usuário: Controlador Adaptativo
Existe pré-projeto de mestrado UFRPE 2026 intitulado **“ANÁLISE DE DESEMPENHO E DEPENDABILIDADE DE SISTEMAS COMPUTACIONAIS E INTELIGENTES BASEADOS EM AGENTES: UMA AVALIAÇÃO ARQUITETURAL EM SISTEMAS DISTRIBUÍDOS”** (arquivo conhecido do histórico: `pre-projeto-mestrado-projeto-9.pdf` na Biblioteca do usuário). Explora:
- **A0:** chamada direta ao LLM;
- **A1:** agente único com ferramentas e memória/RAG;
- **A2:** workflow modular;
- **A3:** equipe multiagente limitada com coordenador e especialistas;
- **A4:** arquitetura adaptativa que inicia com opção simples e escala com dependência, incerteza, risco, orçamento e paralelismo.
- Avaliar sucesso correto/seguro, p95 latência, custo por tarefa/entrega, robustez, recuperação, observabilidade, aprovações.
- A pesquisa acadêmica inspira o controlador, **mas não reduz nosso produto a chatbot single-agent**; ele continua estruturalmente multiagente, mesmo quando uma tarefa específica exige execução simples.
- Adicionar logs estruturados de decisões do controlador e razões auditáveis da composição/escalonamento.

Referências científicas discutidas (validar contexto e utilidade, NÃO afirmar leitura integral sem fazê-la):
- LightRAG (EMNLP 2025): https://aclanthology.org/2025.findings-emnlp.568/ | https://github.com/HKUDS/LightRAG
- OG-RAG (EMNLP 2025): https://aclanthology.org/2025.emnlp-main.1674/
- EMG-RAG (EMNLP 2024): https://aclanthology.org/2024.emnlp-main.281/
- COLLABMEM (EMNLP 2026): https://aclanthology.org/2026.emnlp-main.1194/
- PlugMem (ICML 2026): https://proceedings.mlr.press/v306/yang26g.html
- SCAIR (ACL Industry 2026): https://aclanthology.org/2026.acl-industry.76/
- MRAgent (ICML 2026): https://proceedings.mlr.press/v306/ji26d.html
- Strong RAG baselines 2025: https://aclanthology.org/2025.emnlp-main.1656/
- Multiagent failure taxonomy 2025: https://arxiv.org/abs/2503.13657
- Graphiti temporal graph: https://github.com/getzep/graphiti

## 3. Projetos reais levantados e decisões NÃO definitivas
- **Paperclip** https://github.com/paperclipai/paperclip — principal candidato para organização, hierarquia, tarefas, aprovações, custos e heartbeats; a adoção depende de teste de código e extensibilidade.
- **LangChain/LangGraph** (Python) — candidato principal para Chief of Staff, Controlador Adaptativo, especialistas, execução com estado e checkpoints.
- **LightRAG** https://github.com/HKUDS/LightRAG — candidato ao conhecimento empresarial e busca híbrida/grafo.
- **Graphiti** https://github.com/getzep/graphiti — avaliar memória temporal se LightRAG isolado não satisfizer.
- **Letta** https://github.com/letta-ai/letta — referência para memória persistente/compartilhada de agentes.
- **Eigent** https://github.com/eigent-ai/eigent — referência a equipes em produção e UI TypeScript + motor Python.
- **CrewAI** https://github.com/crewAIInc/crewAI — comparação de papéis/delegação, não decisão fechada.
- **OpenAgents** https://github.com/openagents-org/openagents — colaboração humano-agente.
- **OpenHands** https://github.com/OpenHands/OpenHands — isolamento/executores de engenharia.
- **Orchester** https://github.com/lucasmailland/orchester — analogia de orquestrador + especialistas + memória; repositório com adoção pública historicamente muito menor; não escolher só por aderência conceitual.
- **JARVIS** https://github.com/adewaskar/jarvis — referência de interface visual.
- Dados anteriores de estrelas, forks, issues e releases são instantâneos/voláteis; coletar métricas atuais do GitHub com timestamps. Popularidade não prova robustez/segurança.

## 4. Fontes OFICIAIS Paperclip a revisar no COMMIT FIXADO
Principais:
- https://github.com/paperclipai/paperclip
- https://github.com/paperclipai/paperclip/blob/master/docs/start/architecture.md
- https://github.com/paperclipai/paperclip/blob/master/docs/adapters/overview.md
- https://github.com/paperclipai/paperclip/blob/master/docs/adapters/creating-an-adapter.md
- https://github.com/paperclipai/paperclip/blob/master/docs/adapters/http.md
- https://github.com/paperclipai/paperclip/blob/master/server/src/adapters/http/execute.ts
- https://github.com/paperclipai/paperclip/blob/master/server/src/adapters/http/remote-fetch.ts
- https://github.com/paperclipai/paperclip/blob/master/packages/adapter-utils/src/types.ts
- https://github.com/paperclipai/paperclip/blob/master/server/src/services/heartbeat/queue.ts
- https://github.com/paperclipai/paperclip/blob/master/server/src/services/heartbeat/recovery.ts
- https://github.com/paperclipai/paperclip/blob/master/server/src/services/issues.ts
- https://github.com/paperclipai/paperclip/blob/master/server/src/services/authorization.ts
- https://github.com/paperclipai/paperclip/blob/master/server/src/services/access.ts
- `packages/db` e migrations, `packages/shared`, APIs/rotas de agentes/tarefas, checkout, plugins, orçamentos, aprovadores, segredos, flags e auth.
- Documentação LangGraph checkpoint/persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- SDK/REST LightRAG documentados no repositório oficial.

**Achados anteriores baseados em inspeção estática seletiva; recertificar contra código/commit atual:**
1. Paperclip apresenta control plane organizacional: React/Vite UI, backend Node/Express/TypeScript, banco PostgreSQL/Drizzle (o modo local pode usar PGlite), adapters para Claude/Codex/process/HTTP.
2. Modelo `reportsTo` define uma árvore de supervisão, diferente da topologia temporária de colaboração e execução LangGraph.
3. Tarefas têm um responsável e checkout atômico; subtarefas cognitivas do LangGraph NÃO precisam virar issues Paperclip. Só trabalhos com responsabilidade organizacional própria deveriam virar issues.
4. Scheduler/heartbeat, fila, recuperação e serviços de issues são interdependentes e complexos; evitar fork desses serviços a menos que evidência exija.
5. Adapter HTTP dispara webhook, é apropriado a chamadas externas mas não demonstra sozinho ciclo de vida completo assíncrono; resposta HTTP 2xx não é sinônimo de trabalho terminado. Paperclip separa estados de run/task, confirmar comportamento real.
6. Interface de adapter `AdapterExecutionContext` / `AdapterExecutionResult` pode suportar usage/cost per model, estado de sessão, erros; confirmar tipos precisos. Documentação sugere **adapter como plugin npm externo** registrado no host, em vez de modificar Paperclip.
7. HTTP remote-fetch possui controles SSRF e restringe endpoints privados; implantação dedicada deve permitir somente origens internas específicas.
8. Paperclip tem autorização e domínio de organização, mas isso não garante ACL no LightRAG ou permissão em MCP; exigir identidade assinada/permissões verificadas em cada fronteira.
9. Diferentes versões de docs mencionaram `timeoutSec`/`timeoutMs`; **não copiar configurações sem validar schema atual**.
10. Não houve execução do Paperclip, instalação, teste de segurança, PoC real nem benchmark no histórico original. Relatos de “código avaliado” significam inspeção estática selecionada, não auditoria integral.

## 5. Conteúdo VISUAL e TRANSCRIÇÕES — investigação Work
A investigação examinou **10 vídeos** (vídeo Maestros da IA + **9/9** aulas MMX Paperclip) através de **transcrições automáticas completas + quadros/telas capturadas em trechos**. NÃO assistiu continuamente cada segundo. Não auditou código nem executou os exemplos. Não reanalisou o Instagram original. Distinguir claims do criador de prova técnica.

### 5.1 Maestros da IA
Vídeo: https://www.youtube.com/watch?v=3RpdA7MYyAw&t=315s (~18:52)
- 1:49–2:00 (visual): organograma com CEO, Copywriter, Designer, Revisor, Publicação, Pesquisador.
- ~3:07 (visual): Audit/Timeline com barras/agentes; 269 runs, 16 agentes, duração/tokens eram EXEMPLO, não benchmark.
- 5:15–5:35 (visual): intro Paperclip e animação explicativa, não demo técnica de adapter.
- ~8:13 (visual): Claude Code no terminal usado para instalação assistida; script não auditado.
- ~14:47 (visual): organograma com executores Codex, Hermes, OpenClaw, Pi; heterogeneidade visual não prova segurança ou interoperabilidade real.
- Transcrição: debates/reuniões, verificação de fontes, artefatos, harness/meta-harness, implantação VPS, onboarding, orçamento, tokens.
- Recomendações: encerrar debates por limites de rodada/custo/qualidade; consenso entre agentes ≠ verdade. Não tratar instruções sobre assinaturas, preços e autenticação dos vídeos como regras atuais.

### 5.2 Playlist MMX
Playlist: https://www.youtube.com/playlist?list=PLZslvC3k6NibmbMzfuyc3UGXkIC5k6YvC (~27 min somados).
1. Aula 1 `mZeRen2sKXk` https://www.youtube.com/watch?v=mZeRen2sKXk — explicação empresa/CEO, agentes, Docker Manager e Traefik (visual); heartbeat (transcrição).
2. Aula 2 `f2eian-bR_U` https://www.youtube.com/watch?v=f2eian-bR_U — implantação Hostinger VPS, Paperclip/Traefik, Docker; imagem exibida `ghcr.io/hostinger/hvps-paperclip:latest` é distribuição Hostinger, **não igual automaticamente ao upstream**. Fixar versão, evitar `latest`.
3. Aula 3 `gU5BrKo_iHk` https://www.youtube.com/watch?v=gU5BrKo_iHk — Codex via dispositivo (`codex login --device-auth` dentro de contêiner), nenhuma execução dos comandos aqui; auth do executor NÃO é autorização para ferramentas nem separação entre empresas.
4. Aula 4 `WItGcCiQRKw` https://www.youtube.com/watch?v=WItGcCiQRKw — onboarding Company→Agent→Task→Launch; TechCo; CEO, CTO aprovado, organograma; runtime/modelo por agente.
5. Aula 5 `FrYvRd0KX_I` https://www.youtube.com/watch?v=FrYvRd0KX_I — Issues/Kanban: In Review, Blocked, Done, Cancelled; não foi reproduzida transição completa de uma mesma tarefa.
6. Aula 6 `tgqcHHxiwfk` https://www.youtube.com/watch?v=tgqcHHxiwfk — contratação CMO e “require board approval for new hires” configurável; para nosso produto manter aprovação para agentes permanentes inicialmente.
7. Aula 7 `JLnGSWK4bJY` https://www.youtube.com/watch?v=JLnGSWK4bJY — agent dashboard, skills, permissões, heartbeat 3600→600 s, Budget Disabled/Unlimited, possível alerta 80%; **“Bypass sandbox” estava ativado no demo** e não deve ser copiado. Presença de UI de orçamento não prova teto efetivo.
8. Aula 8 `77uTzIqw8SQ` https://www.youtube.com/watch?v=77uTzIqw8SQ — Brave Search, Resend, chaves de API, selagem/referência de segredos e concessão de ferramentas ao CTO/Founding Engineer. Não prova escopo e segurança efetiva.
9. Aula 9 `kAGzMnQ3_Cs` https://www.youtube.com/watch?v=kAGzMnQ3_Cs — Issue atribuída CTO, pesquisa e digest, comentários; e-mails aparentemente entregues com fontes, mas sem validação independente da origem/exatidão e do provedor. Texto livre concedendo acesso futuro NÃO deve autorizar ferramenta por si só.

**Lições para produto:** Paperclip mostra organograma/tarefas/aprovações/configuração de modelos, budgets e ferramentas. Não comprova sem testes: idempotência, interrupção/retomada, isolamento, aplicação de budgets, runtime sandbox, autorização cross-service, integração LangGraph/LightRAG.

## 6. Arquitetura HIPOTÉTICA a testar, não impor
```
[Gestor humano]
       |
[JARVIS UI — React/TS, Three.js — separado]
       |
[Paperclip? Control Plane — gestão/objetivos/issues/órgão/aprovações]
       |  (adapter npm EXTERNO TypeScript ou HTTP inicial)
[Integration Boundary — identidade/assinatura, run/task, idempotência]
       |
[Python AI Runtime — FastAPI apenas como fronteira interna, LangGraph]
       | Chief of Staff -> Adaptive Controller -> especialistas dinâmicos
       +-> [LightRAG — knowledge API, fontes, ACL a validar]
       +-> [MCP Gateway — policy enforcement por operação]
       +-> [checkpoint / state store]
       |
[PostgreSQL + storage + audit + observability]
```
- No status `202 Accepted` ou na resposta HTTP de um processo iniciado, **não** marcar tarefa concluída sem critério real. Definir ciclo assíncrono/ack/completion/cancellation e reconciliar estado com Paperclip.
- Tarefa Paperclip = unidade de responsabilidade empresarial; nó/etapa LangGraph = trabalho cognitivo. Evitar registrar cada tool-call como Issue.
- Paperclip responsável pelo disparo do *run* no domínio organizacional; LangGraph responsável pelas etapas do grafo. Evitar wake duplicado via cron/heartbeat + LangGraph + Temporal. Temporal opcional apenas para workflows realmente longos não bem cobertos por LangGraph.
- Tokens/custos do subagente devem reconciliar com custos Paperclip e ferramentas externas; restrição por orçamento real, não UI.
- Regras de segurança em cada boundary (Paperclip, Knowledge, MCP). Não confiar em role informado pelo LLM.
- Uma instalação por cliente: não confundir recurso company-scoped interno do Paperclip com isolamento físico/operacional do nosso produto.
- Interface JARVIS não faz parte da prova inicial de execução, adiar UI até provar o backend.
- Obsidian é opcional, não pré-requisito.

## 7. Plano de execução em fases — O QUE CODEX DEVE FAZER
### Fase A — reconhecimento e inventário reproduzível
1. Verificar acesso de rede, Git, Docker/Compose, pnpm/Node, Python, PostgreSQL e ambiente; documentar versões.
2. Clonar Paperclip upstream e **fixar SHA/tag explícitos**. Clonar/checkar LangGraph, LightRAG conforme necessário; registrar versões e licenças reais. Não escolher random branch ou imagem `latest`.
3. Inventariar README, diagramas, `package.json`, testes, CI, padrões de config, APIs relevantes, schema/migrations, plugins e contratos. Comparar com achados desta nota — corrigir imprecisões.
4. Traçar **o caminho exato** `issue/assignment → wake/heartbeat → adapter.execute → HTTP/worker → callback/update issue → usage/cost → recover`, com links **arquivo:linha** no SHA fixado.
5. Traçar **autorização/identidade** por ator humano, token de agente, tarefa, ferramenta, conteúdo, empresa; where enforced. Abrir tests existentes e anotar lacunas.
6. Levantar padrões alternativos (plugin externo, serviço sidecar, adapter embutido, fork) e custo de manutenção.

### Fase B — executar baseline, SEM alterações
1. Seguir passos oficiais da versão fixada para subir Paperclip local, preferindo Docker isolado e credenciais de teste; sem segredos pessoais.
2. Rodar testes upstream relevantes; registrar comandos, logs sanitizados, tempos, resultados, falhas.
3. Criar empresa fictícia, agente e issue fictícios. Exercitar permissões e status existentes.
4. Confirmar que shutdown/restart/heartbeat/task checkout funcionam como documentação.

### Fase C — PoC do boundary
1. **Primeiro usar adapter HTTP built-in** para mapear comportamento exato e limitações, com executor stub local; verificar HTTP 200/202/4xx/5xx, timeout, retry, headers, SSRF/allowlist.
2. Se insuficiente, **adapter plugin TS externo** usando contratos oficiais + serviço Python com LangGraph. Isolar alterações sem editar Paperclip core. Implementar somente o mínimo para provar protocolo; não construir produto.
3. LangGraph mínimo com Chief of Staff stub + 2 especialistas simulados, checkpoint se necessário; run ID idempotente; tasks Paperclip não devem duplicar.
4. LightRAG testado com documentos sintéticos de empresa fictícia, retrieval com IDs/fontes e tentativas de acesso cruzado. Se dependências de modelo forem pagas, usar mocks/fixtures para pipeline primeiro e deixar teste LLM real como pendente. Não declarar qualidade de RAG validada por mocks.
5. Design mínimo de eventos `accepted/running/waiting_approval/completed/failed/cancelled`, compatível com Paperclip real. Não criar APIs imaginárias: mapear schemas reais. Trabalhar com tokens e identidades.
6. Registrar modelos/custos/artefatos verificáveis e checkpoints se suportados.

### Fase D — bateria de testes de falha e segurança
Cenários obrigatórios:
- `runId` entregue 2x, corrida simultânea, worker reinicia no meio;
- timeout depois de side effect (ex.: stub de e-mail) e retry: **não pode duplicar efeito**;
- callbacks fora de ordem, status atrasado, cancelamento em cada etapa;
- erro LLM ou MCP, retentativas limitadas, stale checkpoint, perda de rede;
- tentativa de agente sem permissão acessar ferramenta/knowledge confidencial;
- tentativa de cross-company (empresas fictícias A/B); apesar de implantação dedicada, testar scoping;
- orçamento agregado em runs concorrentes, orçamento mensal versus per task/run; custo estimado versus real;
- contratação permanente sem aprovação; agente temporário somente permitido dentro de policy;
- spoofed signed context, token vazado/revogado, SSRF/URLs internas;
- restart/backup-restore do banco/cache e restauração segura;
- rastreabilidade run/task/agent/company, observabilidade e export de evidências.
Assumir acesso e dados sintéticos; nenhum ataque sobre infraestrutura de terceiros.

### Fase E — relatório de decisão e recomendação de próximo passo
Gerar `README.md`/`REPORT.md` dentro da POC com:
- SHA Paperclip, versões, ambiente, modo de execução, comandos e logs evidenciados.
- Matriz requisito→arquivo/contrato→teste→resultado `PASS/FAIL/BLOCKED/NOT TESTED`.
- Matriz severidade (criticidade, probabilidade, mitigação, owner).
- Classificação por componente: **adotar por API / plugin externo / fork necessário / rejeitar**.
- Custo de manutenção/upgrade e risco de licença/distribuição.
- Decisão sobre **Paperclip como control plane** com critérios de aceitação explícitos, não entusiasmo.
- Alternativa caso Paperclip falhe: utilizar LangGraph + API/organização própria mínima, ou outro projeto existente, justificando evitar reimplementação ampla.
- Recomendar o segundo experimento só após o primeiro ser honestamente mensurado.

## 8. Critérios de aprovação / Go-No-Go
`GO` somente se:
1. Teste ponta-a-ponta Paperclip→executor LangGraph→(LightRAG sintético)→Paperclip reprodutível.
2. Estado de tarefa/reflexo da execução honesto; HTTP ack ≠ conclusão.
3. Sem duplicação de efeito externo por retry, com teste reproduzido.
4. Permissões e isolamentos aplicados em servidores, não somente prompts.
5. Segurança de credenciais e sandbox demonstrada com configurações seguras.
6. Orçamento/custos conciliáveis com múltiplos agentes e chamadas.
7. Sem patch extenso em scheduler/issues/auth/DB core, ou custo de fork explicitamente aceito.
8. Cancelamento/recovery e trace IDs suficientemente estáveis.
9. Nenhuma dependência obrigatória da conta pessoal Claude Code/Codex do cliente; avaliar API keys service accounts e condições atuais dos provedores.
10. Instalação por cliente com secrets, backups e telemetria isolados, sem mistura de dados.

Caso não haja API adequada, o resultado pode ser **NO-GO Paperclip** sem invalidar a arquitetura geral.

## 9. Observabilidade, testes comparativos e produto
- Coletar completion correto, p50/p95 latência, custo/entrega aceita, tokens, número de intervenções, loops de delegação, retrabalho e erros.
- Testar A1/A2/A3/A4 com cenários comparáveis para alimentar Controlador Adaptativo, sem otimizar só quantidade de agentes.
- Exemplo empresarial: “Por que vendas caíram?” (dados sintéticos de Vendas/Marketing/Financeiro, conhecimento cruzado, revisão antes de qualquer ação de CRM).
- Exemplo de tool side effect: e-mail falso enviado a inbox simulada com idempotency key; confere run, aprovação e uma entrega.
- Critério de resposta correta = evidências e fontes, não consenso de agentes.
- Logs devem evitar PII, segredos, conteúdo confidencial.

## 10. Pedido de saída do Codex e regras de comunicação
Comece por relatar ambiente disponível e commit escolhido. Mostre o plano e avance para testes reais **nesta sessão**, sem prometer trabalho posterior. Mantenha progresso e um registro de decisões. Cite arquivos/linhas reais do clone e comandos executados. NUNCA confundir pesquisa no navegador, vídeo ou mock com integração validada. Não publicar repositórios ou instalar em VPS de cliente sem autorização. Não mudar a proposta do usuário (sem cadastro multi-tenant público, sem NestJS compulsório, sem coordenadores fixos, sem Python proibido).
Ao final, entregar resultados, repositório/arquivos da POC, relatório de riscos e recomendação `GO/CONDITIONAL/NO-GO` para Paperclip. Se houver bloqueio de rede, informar e ainda produzir testes locais dos contratos (rotulados claramente como simulação), sem falsear integração.

## 11. Informações originais que podem exigir recuperação
- O primeiro vídeo Instagram, originalmente anexado à conversa, não foi revisto na pesquisa Work.
- O pré-projeto UFRPE e outras conversas do usuário não estão embutidos neste documento; a descrição acima cobre suas contribuições arquiteturais conhecidas.
- Nenhum repositório privado do usuário foi identificado/autorizado aqui; não modificar código existente por suposição.
- O usuário pediu explicitamente “reúna todas as informações que o Codex precisa ... mande tudo para ele”. Esta transferência deve preservar o contexto sem alegar acesso automático ao chat inteiro. Perguntar somente se algum dado essencial não puder ser recuperado.

## 12. Links de referência adicionais
- Paperclip architecture: https://github.com/paperclipai/paperclip/blob/master/docs/start/architecture.md
- Paperclip adapters: https://github.com/paperclipai/paperclip/blob/master/docs/adapters/overview.md
- Paperclip external plugin guidance: https://github.com/paperclipai/paperclip/blob/master/docs/adapters/creating-an-adapter.md
- Paperclip HTTP: https://github.com/paperclipai/paperclip/blob/master/docs/adapters/http.md
- LangGraph persistence: https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx
- LightRAG: https://github.com/HKUDS/LightRAG
