# Catálogo empresarial do Aurora

O catálogo reúne 10 diretorias e 37 especialistas. O Chief of Staff fica acima das diretorias e seleciona um subconjunto para cada tarefa. A mesma estrutura pode servir a setores diferentes porque os papéis descrevem capacidades e entregas. O desenho preserva as funções existentes e separa as lacunas com maior impacto no roteamento. [Catálogo em uso](../demo-enterprise/catalog.json)

## Referências e decisões

- A APQC publica uma classificação transversal de processos e versões por setor. Usei a transversal para verificar se o catálogo cobre estratégia, produto, comercial, entrega, atendimento e funções de suporte. As dez diretorias são uma adaptação para o Aurora. [APQC](https://www.apqc.org/resource-library/resource-collection/apqcs-process-classification-framework-pcf-cross-industry-and)
- O O*NET distingue gestão de sistemas, desenvolvimento de software e QA. No Aurora, a Diretoria de Tecnologia mantém Dados e Segurança e ganha papéis separados para liderança técnica, desenvolvimento, testes e plataforma. [O*NET](https://www.onetonline.org/find/career?c=060104)
- O Copilot permite especializar agentes com instruções e ferramentas próprias, como revisão de código e segurança. A experiência de produção do Anthropic Research mostra um coordenador delegando tarefas específicas e reunindo os resultados. O LangGraph apresenta equipes hierárquicas como subgrafos supervisionados. Usei essas referências para definir papéis com entregas distintas e manter a hierarquia do Aurora. [GitHub Copilot](https://docs.github.com/en/copilot/concepts/customizations/custom-agents) · [Anthropic Research](https://www.anthropic.com/research/multi-agent-research-system) · [LangGraph](https://www.langchain.com/blog/langgraph-multi-agent-workflows)

| Diretoria | Especialistas disponíveis |
| --- | --- |
| Executiva | Negócios, portfólio e gestão de projetos |
| Produtos e serviços | Gestão de produto, design de experiência e desenho de serviços |
| Marketing | Campanhas, preço promocional e conteúdo |
| Comercial | Operações comerciais, contas e propostas |
| Atendimento e clientes | Atendimento, sucesso do cliente e análise da experiência |
| Operações | Suprimentos, logística, compras e qualidade de processos |
| Finanças | Controladoria, tesouraria, planejamento financeiro e contabilidade |
| Pessoas | Recrutamento, capacidade e desenvolvimento de pessoas |
| Jurídico | Conformidade, contratos, privacidade, riscos e controles |
| Tecnologia | Tech Lead, engenharia backend, engenharia frontend, QA, plataforma e confiabilidade, engenharia de dados, análise de dados e segurança |

Para um trabalho de engenharia, Produto entra quando é preciso definir requisitos, Tecnologia conduz o recorte técnico, QA verifica critérios de aceitação e Plataforma entra quando o escopo inclui entrega ou operação. Comercial cuida da oportunidade e da negociação. Atendimento cuida da solicitação do cliente e do acompanhamento após a venda. Marketing cuida de posicionamento, campanhas e conteúdo. Cada papel traz no catálogo um foco e referências para o corpus fictício da demonstração. As referências são insumos consultivos e podem deixar lacunas sobre um assunto específico.

## Operação e limites

O catálogo alimenta o planejador do Chief, o mapa 3D e a lista operacional. Com mais especialistas, o mapa mantém os nós acessíveis e dá rótulo visível a diretores, agentes mobilizados e ao nó em inspeção. A política atual limita cada tarefa a quatro diretorias, um ou dois especialistas por diretoria e oito agentes no total. O catálogo define quem pode ser escolhido. Os papéis de engenharia estão disponíveis para análise e planejamento consultivos. Edição de repositório, execução de testes por agentes e aprovação de mudanças dependem de um fluxo de desenvolvimento com ferramentas e permissões próprias.

Hoje os especialistas selecionados executam antes da revisão do diretor. Para o ensaio de autonomia, o grupo escolhido pelo Chief passa a ser o conjunto autorizado de onde o diretor decide quem acionar. A coordenação técnica por Tech Lead é uma responsabilidade descrita no catálogo. O despacho do Tech Lead para outros agentes depende desse ensaio e de um contrato de delegação próprio. [Critério de delegação](../reports/aurora-piloto-handoff.md#critério-do-próximo-ensaio-de-delegação)

## Verificação

Três pedidos fictícios passaram pelo prompt de planejamento com o catálogo completo, GPT-6.1 Terra e o validador de equipes do Aurora. Cada plano incluiu os papéis esperados e passou pelas regras de hierarquia, exclusões e orçamento. No pedido de atendimento, o Chief também acionou Sucesso do Cliente para diferenciar suporte inicial de gestão de relacionamento. O ensaio mediu roteamento em uma amostra pequena, sem executar as tarefas. [Planos observados](../reports/aurora-catalogo-roteamento.json)

| Pedido | Equipe selecionada |
| --- | --- |
| Planejar endpoint de webhook com idempotência e revisão técnica | Tecnologia, Tech Lead e Backend |
| Planejar triagem e escalonamento de chamados | Atendimento e Clientes, Atendimento e Sucesso do Cliente |
| Comparar cenários de orçamento e projeções | Finanças e Planejamento Financeiro |

Passaram oito verificações Node de política e atividade de agentes, o build, a checagem TypeScript e o teste das visualizações no Edge em desktop e mobile. Na regressão do piloto, quatro testes passaram e quatro variantes ficaram fora desta seleção. O caso integrado usou API, LangGraph e PostgreSQL locais com provedor controlado. As referências dos 47 papéis foram conferidas contra as 16 fontes vigentes do corpus fictício. [JUnit do piloto](../validation/aurora-local-restart/catalog-routing.xml)
