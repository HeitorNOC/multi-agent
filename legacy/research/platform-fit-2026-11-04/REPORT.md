# Aderência à plataforma empresarial: comparação e provas

Data: 04/11/2026. Continuação autorizada da [pesquisa transversal](../production-systems-2026-11-04/REPORT.md), agora com inspeção fixada, testes reais de componentes e exame dirigido de Glean/ServiceNow. Usuário confirmou que não possui instância de avaliação desses dois produtos.

**Decisão: continuar a comparação; produção permanece NO-GO.** A bancada atual segue como referência. Graphon entra como alternativa de motor; Dify e Onyx são candidatos condicionais. Glean e ServiceNow permanecem alternativas comerciais a avaliar, sem execução nativa nesta rodada.

## Resultado técnico executado

45 testes upstream Graphon passaram, incluindo snapshots e pausa/retomada; quatro testes upstream Dify passaram com o sinal externo de parada simulado. O sandbox fixado foi executado por API real: autenticação e casos básicos de isolamento tiveram resultados favoráveis, mas espera e loop foram interrompidos por syscall proibida, sem comprovar o timeout. Não há GO de segurança ou compatibilidade. Versões, comandos, logs, JUnit e limitações estão em [RESULTS.md](../../validation/platform-fit-2026-11-04/RESULTS.md).

## Comparação por responsabilidade

| Opção | Papel possível | Camada própria e adaptações | Decisão desta rodada |
|---|---|---|---|
| Bancada própria + LangGraph | Plataforma empresarial e execução, com motores de conhecimento externos | Completar controlador, contratos TypeScript, operação e gates já identificados | Referência de comparação; sem produção |
| Graphon separado | Motor de grafos/execução | Nosso controle empresarial, persistência, identidade, orçamento, efeitos e adaptadores permanecem necessários | Admitir no próximo ensaio de motor; não substituir ainda |
| Dify completo | Plataforma pronta de workflows, conhecimento, plugins e edição | Fachada de produto e políticas; escolher se será a autoridade do workflow. Mapear edição, licença e APIs | Candidato condicional, sem prova integrada |
| Onyx | Módulo de conhecimento/conectores/busca | Autoridade canônica, vigência, histórico de assessoramento e política empresarial continuam a exigir validação própria | Candidato de módulo; não produto completo aprovado |
| Glean | Contexto empresarial, busca e agentes via APIs | Instalação/contrato compatíveis, fronteira entre nosso controlador e seus agentes, autoria e exportação do histórico | Alternativa comercial documental, teste pendente de acesso |
| ServiceNow | Processos, equipes de agentes, ações e governança empresarial | Grande parte do produto passa a depender da plataforma contratada; integração e regras específicas continuam próprias | Alternativa comercial documental, teste pendente de acesso |

## Glean: aproximação funcional forte, controles a verificar

O anúncio técnico de segurança descreve **customer-managed deployment**, com controle de implantação, conectividade privada e chaves do cliente, e identifica recursos ainda em beta. Isso amplia a leitura anterior baseada na modalidade Customer Hosted gerenciada: são descrições de ofertas distintas a esclarecer na configuração contratada. Não é correto descartar Glean por presumir somente SaaS ou somente operação pelo fornecedor. Exigir matriz de responsabilidades da oferta concreta. [Anúncio oficial](https://www.glean.com/blog/agentic-security-aware), [documentação de implantação](https://docs.glean.com/get-started/build/about-self-hosted).

O guia de agentes descreve execução durável, aprovação/retomada e cancelamento cooperativo. Também restringe leitura, resposta e cancelamento de execução durável ao usuário iniciador. Isso pode exigir mediação na nossa camada para continuidade organizacional e dupla aprovação, sem compartilhar tokens entre pessoas. Precisamos testar esse contrato no ambiente real. [Guia de integração](https://developers.glean.com/guides/agents/overview).

Autorização deve ser avaliada por superfície: respostas públicas em canal Slack usam acesso amplo definido pela plataforma, não verificação de cada documento contra cada participante. Para nosso requisito, começar por web/API com identidade explícita e entrega privada; qualquer canal compartilhado deve passar ensaio próprio. [Permissões](https://docs.glean.com/agents/concepts/sharing-permissions).

Controles de gasto publicados incluem limites e bloqueios; entretanto a API de Usage tem endpoints experimentais. Avaliar headroom sobre consumo acumulado não demonstra reserva atômica para uma tarefa de várias etapas. Não substituir nossa admissão/orçamento por uma consulta de saldo sem teste concorrente. [Controles de uso](https://www.glean.com/blog/go-cost-governance-2026), [API e estágio de maturidade](https://developers.glean.com/api/platform-api/usage-overview), [semântica de headroom](https://developers.glean.com/api/platform-api/platform-usage-limits-evaluate).

**Ainda sem evidência:** custo contratado, exportação/restauração completa do cérebro, correção retroativa canônica, saída original imutável com ACL atual, anti-rollback, RPO/RTO e enquadramento comercial da nossa interface por cliente. Grafo empresarial e memória não comprovam esses contratos.

## ServiceNow: alternativa de plataforma inteira, inclusive implantação própria

A publicação de produto descreve Private Stack/Self-Hosted, operação pelo cliente/parceiro e AI Agents desde Zurich, com diferenças de disponibilidade em relação à nuvem. Há opções de modelos e créditos Now Assist; o caminho de implantação envolve dimensionamento e workshop comercial. Exigir a matriz da família/release e do produto contratados antes de concluir aderência ou custo. Não foi instalado nenhum software ServiceNow. [Publicação oficial de implantação](https://www.servicenow.com/community/product-launch-blogs/self-hosted-offering-deploy-the-full-servicenow-ai-platform-on/ba-p/3524144).

O SDK documenta separadamente quem pode invocar (`securityAcl`) e com qual identidade ocorre a execução (`runAsUser`/`runAs` ou `dataAccess`). A autorização de entrada não garante privilégio mínimo das ferramentas. Nosso ensaio deve comparar chamador restrito e conta de execução privilegiada, com ações simuladas e revogação. [Guia oficial do SDK](https://servicenow.github.io/sdk/guides/building-ai-agents-guide).

O documento de consumo vigente em 24/08/2026 mede Assists, inclusive em subprodução. A tabela indica 25/50/150 para faixas de workflow; não é preço em moeda. A redação do intervalo pequeno e médio deixa quatro ações sem enquadramento explícito no trecho consultado: pedir esclarecimento, sem inventar uma faixa. Entitlements vêm do contrato. [Tabela oficial](https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/legal/sn-assist-overview.pdf).

Precisamos verificar correções de segurança aplicáveis à família e apps: o índice oficial inclui advisory de escalada de privilégio na plataforma de IA. Não houve avaliação de instância ou exploração de serviço de terceiros. [Índice oficial de advisories](https://trust.servicenow.com/notifications/?type=cve_publication).

**Ainda sem evidência:** licença/OEM para nossa forma de distribuição, custo por instalação/cliente, conectores necessários na modalidade local, histórico imutável exigido, recuperação independente e orçamento atômico por trabalho. Control Tower como governança não demonstra controle transacional de todo efeito externo.

## Dify, Graphon e Onyx: o que o código acrescentou

Dify fixa um commit Git de Graphon apesar da dependência nominal 0.8.0: testar apenas o pacote publicado não reproduziria necessariamente a aplicação. O motor separado declara Apache-2.0 e fronteiras para integração, justificando teste como componente próprio. O restante da plataforma conserva sua licença e requisitos. [Manifest Dify fixado](https://github.com/langgenius/dify/blob/eea40c683bbc8d2a396f80ee25ebfef1555a84ad/api/pyproject.toml), [motor fixado](https://github.com/langgenius/graphon/tree/4fa22141774dff80e90e4dfa98ea3e6fbf0421bb).

O wrapper de parada do Dify rejeita novas inclusões; o nó em andamento pode terminar. O serviço KnowledgeFS consultado usa escopos de chave de dataset e épocas de autorização; chave não vinculada pode alcançar espaços do tenant. Isso não demonstra ACL por usuário final de todos os documentos. Exigir identidade e escopo na nossa fronteira. [Parada](https://github.com/langgenius/dify/blob/eea40c683bbc8d2a396f80ee25ebfef1555a84ad/api/core/app/apps/workflow/stop_aware_ready_queue.py), [autorização](https://github.com/langgenius/dify/blob/eea40c683bbc8d2a396f80ee25ebfef1555a84ad/api/services/knowledge_fs/service_api_authorization.py).

O Compose define 47 serviços, muitos condicionados a profiles; isso **não significa** que todos sejam necessários ou iniciados. Há tags mutáveis e opções opcionais com privilégios elevados: produzir composição mínima e fixar digests antes de homologar. Não executamos esse Compose. [Composição fixada](https://github.com/langgenius/dify/blob/eea40c683bbc8d2a396f80ee25ebfef1555a84ad/docker/docker-compose.yaml).

Onyx Lite desativa conectores e RAG; não o usar como atalho para declarar o cérebro testado. A licença EE permite testes, mas produção exige licença/assinatura apropriada e tem condições de distribuição/modificações. A existência de teste de permissões que importa EE não prova a mesma capacidade na edição comunitária. [Lite](https://github.com/onyx-dot-app/onyx/blob/332b908f4a05090882ffaf7219d904c467bb7ce1/deployment/docker_compose/docker-compose.onyx-lite.yml), [licença EE](https://github.com/onyx-dot-app/onyx/blob/332b908f4a05090882ffaf7219d904c467bb7ce1/backend/ee/LICENSE), [teste de contrato](https://github.com/onyx-dot-app/onyx/blob/332b908f4a05090882ffaf7219d904c467bb7ce1/backend/tests/external_dependency_unit/auth/test_permission_projection_contract.py).

## Próxima decisão concreta

**Atualização posterior do usuário, 04/11/2026:** continuar com LangGraph. A comparação de execução com Graphon proposta abaixo fica retirada da fila ativa; seus resultados permanecem como evidência histórica. Dify não será introduzido como segundo orquestrador. Glean, ServiceNow e Onyx continuam referências/candidatos de módulos compatíveis com essa direção, sujeitos aos requisitos anteriores. Próximo ensaio ativo: fluxo empresarial com LangGraph, seleção de capacidade, aprovação, efeito externo simulado, orçamento e retomada em processo novo. Produção segue não aprovada.

1. Executar uma mesma tarefa pequena de negócio na bancada e no Graphon: seleção de capacidade, aprovação, chamada externa simulada, interrupção e retomada em processo novo. Não combinar dois motores controlando o mesmo trabalho.
2. Exigir persistência de admissão/efeito e orçamento, além de snapshot do motor. Medir qualidade/custo com modelo somente depois dessa fronteira operacional; manter testes sem modelo onde ele não é necessário.
3. Para Dify/Onyx completos, resolver edição/licença e configuração mínima antes de baixar e operar a plataforma inteira. A integração deve preservar os históricos canônicos separados e ACL atual.
4. Para Glean/ServiceNow, usar o [roteiro de avaliação](COMMERCIAL_EVALUATION.md) quando houver acesso. Sem instância, não declarar PASS nativo nem simular como se fosse o fornecedor. Contratação e contato externo não foram feitos.

Todos os requisitos anteriores permanecem: instalação isolada por cliente, cérebro lógico persistente, Chief of Staff/controlador A0–A4, equipes por capacidades, TypeScript empresarial/UI JARVIS, motores Python possíveis, MCP/APIs autorizadas, Obsidian opcional e uma autoridade de workflow. Não se reimplementa motor RAG ou grafo só para padronizar linguagem. A homologação de grande empresa continua distinta destes ensaios pequenos.
