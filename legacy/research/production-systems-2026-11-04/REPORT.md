# Sistemas empresariais em operação: comparação sem compromisso de stack

Data: 04/11/2026. Pesquisa pública confrontada com dossiê e resultados locais; nenhuma nova execução integrada.

## Decisão

**Produção do protótipo: NO-GO no estado atual. Continuidade da qualificação: recomendada, com alternativas.** Existem sistemas operacionais combinando planejamento, especialistas, conhecimento e ações governadas. Isso sustenta investigar o produto, sem comprovar nossa implementação.

LangGraph, LightRAG e Graphiti são candidatos substituíveis. O requisito é uma autoridade de workflow, não uma biblioteca específica. A retirada do Paperclip como fundação não demonstrou impossibilidade universal: a auditoria encontrou integração possível e limitações no recorte testado.

## Casos e força da evidência

| Sistema | Evidência encontrada | Aplicação e limite |
|---|---|---|
| LinkedIn Hiring Assistant | Engenharia do operador: supervisor, planejamento/execução, especialistas e memória. A plataforma combina mensagens internas com LangGraph/LangChain e provedores próprios. | Referência forte para camada própria sobre componentes prontos; a plataforma interna completa não é um pacote aberto instalável. |
| Anthropic Research | Operador descreve passagem a produção, delegação, avaliações, observabilidade, retomada e coexistência de versões durante implantação. | Referência de recuperação e esforço proporcional à tarefa. Prompts publicados não equivalem ao sistema inteiro disponível. |
| Uber Genie / Enhanced Agentic RAG | Operador relata uso interno, avaliação especializada e falhas que impediram expansão. A melhoria usa LangGraph sobre Langfx. | Referência para avaliar documentos e qualidade antes de ampliar acesso. A expansão da versão melhorada ainda estava em curso no relato. |
| Elastic AI Assistant / Automatic Import | Engenharia descreve LangGraph para geração de ES\|QL e pacotes de integração, com observabilidade e componentes existentes. | Exemplo de produto especializado sobre motores. Código público e disponibilidade comercial não autorizam qualquer reutilização. |
| Glean | Fornecedor descreve planejamento adaptativo e grafo empresarial com permissões; documentação detalha autorização. | Referência próxima do cérebro empresarial, mas plataforma comercial, não biblioteca incorporável. Comportamento de permissões depende da superfície de entrega. |
| ServiceNow | Operador relata agentes em atendimento, segurança e suporte interno, integrados ao trabalho humano. | Referência de sistema empresarial com ações e supervisão; indicadores internos não se transferem ao nosso cenário. |
| Maersk com Dify Enterprise | Caso do fornecedor afirma substituição da plataforma interna após comparação, cerca de 90 aplicações e 25 mil usuários ativos no fim de 2025. | Justifica investigar adaptação de plataforma pronta. Números não auditados independentemente aqui; edição comunitária não equivale à Enterprise. |
| Onyx | Repositório e licença permitem inspecionar base de conhecimento/agentes, com núcleo e edição empresarial distintos. | Candidato para conhecimento/conectores. Nesta rodada não obtivemos relato de operador suficiente para equipará-lo aos demais casos ou comprovar orquestração completa. |

Fontes primárias por caso:

- LinkedIn: [plataforma, setembro/2025](https://www.linkedin.com/blog/engineering/generative-ai/the-linkedin-generative-ai-application-tech-stack-extending-to-build-ai-agents), [Hiring Assistant, outubro/2025](https://www.linkedin.com/blog/engineering/ai/how-we-engineered-linkedins-hiring-assistant).
- Anthropic: [engenharia do Research, junho/2025](https://www.anthropic.com/research/multi-agent-research-system).
- Uber: [Enhanced Agentic RAG, maio/2025](https://www.uber.com/us/en/blog/enhanced-agentic-rag/).
- Elastic: [engenharia, agosto/2024](https://www.elastic.co/blog/building-automatic-import-attack-discovery-langchain), [documentação atual](https://www.elastic.co/docs/explore-analyze/ai-features/automatic-import).
- Glean: [Agentic Engine 2](https://www.glean.com/blog/live-fall-25-agentic-engine2-performance), [permissões](https://docs.glean.com/agents/concepts/sharing-permissions), [implantação](https://docs.glean.com/get-started/build/about-self-hosted).
- ServiceNow: [relato de uso interno](https://www.servicenow.com/uk/blogs/2026/how-is-servicenow-using-ai-agents).
- Dify: [caso Maersk](https://dify.ai/solutions/logistics-and-supply-chain), [implantação local](https://docs.dify.ai/en/self-host/deploy/quick-start/docker-compose).
- Onyx: [repositório](https://github.com/onyx-dot-app/onyx), [licença](https://github.com/onyx-dot-app/onyx/blob/main/LICENSE).

## Requisitos preservados e lacunas

O [dossiê](../../poc/DOSSIER.md) continua válido. Não se reduz o produto a chat com RAG ou organograma de agentes fixos.

| Requisito nosso | O que ainda precisamos demonstrar |
|---|---|
| CEO → Chief of Staff → controlador A0–A4 → equipes por capacidades | Estratégia, risco, orçamento, concorrência, escalonamento e ausência de autoridades conflitantes. Os supervisores dos casos não comprovam nosso controlador. |
| Cérebro central persistente | Separação de fontes aprovadas, fatos e assessoramento; snapshots, vigência/publicação, proveniência e leitura original sem regeneração. |
| Instalação por cliente | Isolamento de dados, segredos, execução, logs e orçamento; quem opera, atualiza e acessa a instalação. Conta de nuvem própria não implica controle operacional integral. |
| ACL atual e revogação | Autorização durante execução, leitura histórica, ferramentas, exportação e canais compartilhados; revogação resistente a rollback. |
| Sandbox | Bloqueio de escape, rede/arquivos/segredos proibidos, injeção documental e efeitos remotos após cancelamento. |
| Recuperação e custo | Deduplicação, recibos, fencing, quotas por trabalho, resultado desconhecido, restore, migração, RPO/RTO e custo monetário atribuível. |
| Produto próprio | TypeScript empresarial, UI React/JARVIS funcional, conectores e Obsidian/Markdown opcional; motores Python aceitos, sem reinvenção por linguagem. |

Não acrescentar bancos, filas ou microserviços por estética. Nenhum PASS anterior se transfere automaticamente a outro motor ou versão.

## Rotas recomendadas para comparação

1. **Camada própria + componentes:** bancada atual como referência. Maior alinhamento à propriedade do produto, com trabalho operacional ainda pendente.
2. **Adaptar plataforma pronta:** Dify como candidato à base de workflows; Onyx como candidato ao módulo de conhecimento. Não juntar todos por padrão. Se Dify assumir workflows, substituirá a autoridade atual. OpenCompany, AgentScope e Eigent continuam candidatos da [triagem anterior](../alternatives-2026-11-03/REPORT.md), sem aprovação por semelhança conceitual.
3. **Adotar plataforma comercial:** Glean/ServiceNow como comparação funcional e operacional, ou alternativa de produto se implantação, controle e custo forem compatíveis. Não são motores abertos intercambiáveis.

Próximo passo: [comparação com critérios eliminatórios e ensaios iguais](VALIDATION_PLAN.md). Criar apenas contratos e regras de negócio ausentes; substituir integralmente motores exige demonstrar por que opções prontas não servem.

## Ressalvas e falhas da pesquisa

- Relato do operador é mais concreto que logo/README, mas não é certificação independente. Métricas internas não são nosso SLA, capacidade ou custo.
- Dify possui condições adicionais sobre workspaces/multitenancy e frontend/marca. Não presumir licença Apache pura nem autorização genérica de distribuição com marca própria. [Licença](https://github.com/langgenius/dify/blob/main/LICENSE).
- Onyx reserva diretórios `ee` à licença empresarial; restante MIT e componentes de terceiros têm condições próprias. Mapear cada recurso à edição. [Licença](https://github.com/onyx-dot-app/onyx/blob/main/LICENSE).
- Essas licenças foram consultadas em `main`, referência mutável. Não houve novo checkout fixado nem auditoria jurídica; fixar SHA/imagens/licenças antes de instalar.
- Não encontramos nesta rodada evidência suficiente de operador empresarial para qualificar LightRAG standalone para nosso conjunto de requisitos. Isso é lacuna de evidência, não prova de ausência de uso.
- Zep gerenciado e Graphiti framework não são ofertas equivalentes. Adoção de um não aprova automaticamente o outro nem resolve a falha temporal local. [Distinção oficial](https://help.getzep.com/zep-vs-graphiti).
- Nenhuma nova suite, inferência, instalação ou medição de custo foi executada nesta pesquisa. Achados locais negativos permanecem.

**Conclusão: arquitetura em qualificação; stack aberta à substituição; produção ainda NO-GO.**
