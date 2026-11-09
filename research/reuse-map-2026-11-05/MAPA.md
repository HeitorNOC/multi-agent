# Mapa de reaproveitamento da plataforma empresarial

05/11/2026. Orientação do usuário: compor a solução com processos/componentes existentes, maduros e usados por várias organizações, adequando-os ao domínio. A unidade de decisão passa a ser a responsabilidade técnica que um componente entrega. Pesquisas, demonstrações e artigos devem resultar em escolhas de integração e testes dirigidos.

## Direção de engenharia

Reutilizar motores, protocolos, bibliotecas, infraestrutura e padrões existentes. A camada própria integra identidade, conhecimento, planejamento, autorização, execução e experiência empresarial. Antes de implementar um subsistema genérico, verificar se um componente existente cobre o contrato e quanto custa integrá-lo/manter sua distribuição.

O código específico deve se concentrar nos contratos do produto: instalação por empresa, catálogo de capacidades, CoS/controlador A0–A4, fluxos e fontes aprovados, versões, aprovação do payload exato, orçamento por trabalho, conciliação e interface JARVIS. Mesmo nesses contratos, usar persistência, criptografia, identidade, telemetria e mecanismos de execução prontos.

Não há percentual de reutilização medido. Contar bibliotecas não mede esforço poupado. A decisão por componente registra superfície substituída, adaptação, dependências, licença, comportamento diante de falha e prova de integração.

## Primeira matriz concreta

| Processo | Base reutilizável | O que ela já oferece | Adaptação nossa / prova necessária | Situação |
|---|---|---|---|---|
| Execução e retomada | **LangGraph core** | Grafos, subgrafos, tasks, checkpoints, interrupção/replay e retry | Admissão durável, contratos de negócio, recibos e recuperação das janelas concretas | Motor escolhido; integração parcial já executada |
| Planejamento/delegação/contexto | **Deep Agents**, seletivamente | Harness, subagentes como ferramenta e middlewares | Equipes por capacidade, grants explícitos, limites globais, observabilidade e comparação de qualidade/custo | Biblioteca candidata, pin/dependências ainda separados |
| Recuperação por conhecimento | **LightRAG** + PostgreSQL/pgvector + Neo4j | Extração/indexação e busca por vetor/grafo | Governança de fontes/versões/ACL, publicação e história; avaliação factual, relacional e global | Motor integrado em recorte pequeno; sem aprovação geral de qualidade |
| Login/federação/identidade | **Keycloak** | OIDC/SAML, sessões e administração de identidade | Realm/configuração da instalação, vínculo com grants, propagação de identidade e revogação | Candidato preferencial já investigado; não reimplementar IdP |
| Decisões de acesso granular | **OpenFGA** | Motor de relações/permissões, APIs/SDKs e testes de modelos | Nosso modelo de fontes/trabalhos/agentes; consistência, revogação, contexto confiável e enforcement | Novo candidato específico para avaliação dirigida |
| Acesso a modelos | **LiteLLM**, ou adaptador direto se o gateway não se justificar | Interface comum, roteamento e medição de consumo | Compatibilidade do provedor, limites de retry, privacidade, atribuição por trabalho e licença de recursos necessários | Candidato; integridade da distribuição e dependências precisam qualificação |
| Execução de código não confiável | **gVisor/runsc** como componente de isolamento | Runtime OCI com kernel de aplicação e isolamento adicional | Host Linux, compatibilidade do workload, rede, mounts, segredos, timeout/cancelamento e custo | Candidato de infraestrutura; não instalado ou homologado aqui |
| Persistência/consistência | **PostgreSQL** e mecanismos nativos | Transações, constraints, locking, backup e recuperação | Schema e invariantes do negócio, restauração conjunta e fronteira externa | Já usado; preservar ensaios e fechar lacunas de protocolo |
| Telemetria | **OpenTelemetry** e backend compatível a selecionar conforme necessidade | Instrumentação e propagação de traces/métricas | Correlação do trabalho/agente/efeito, sanitização e retenção por cliente | Direção de reutilização; sem produto novo aprovado |
| UI e edição | **React/TypeScript/Three.js**, componentes adequados; Obsidian opcional | Base de UI/visualização e edição Markdown | Modelo operacional, interações, acessibilidade e licenças de ativos | Requisitos mantidos; não copiar integralmente UI de aplicação de terceiros |

Essa matriz é uma lista de responsabilidades e candidatos, não uma ordem para instalar dez serviços. LangGraph continua sendo o único dono do workflow. As responsabilidades podem compartilhar processo e banco onde apropriado. Adicionar um motor de permissões ou isolamento não cria outro scheduler. Não acrescentar Redis/Kafka/Temporal apenas porque uma solução de terceiros os utiliza.

## Evidência de comunidade e manutenção coletada

Dados obtidos da API pública do GitHub, com horário UTC, commit completo e licenças em [repositories.json](repositories.json). Valores observados em 05/11/2026; não estimativas. Datas referem-se ao commit HEAD consultado, não ao último release estável ou ao pin aprovado para produção.

| Repositório | Stars | Forks | Commit HEAD observado | Data UTC do commit | Licença |
|---|---:|---:|---|---|---|
| langchain-ai/langgraph | 44.484 | 7.653 | `302a4d4c` | 05/11/2026 | MIT |
| HKUDS/LightRAG | 40.540 | 5.761 | `aaebfe1b` | 14/10/2026 | MIT |
| keycloak/keycloak | 37.708 | 9.142 | `970b7c75` | 04/11/2026 | Apache-2.0 |
| openfga/openfga | 6.088 | 554 | `ff8394da` | 03/11/2026 | Apache-2.0 |
| BerriAI/litellm | 62.732 | 13.015 | `74493f39` | 05/11/2026 | MIT fora das áreas Enterprise; licença distinta nessa área |
| google/gvisor | 19.872 | 2.055 | `90d4e225` | 05/11/2026 | Apache-2.0 |

Todos retornaram `archived=false`. Capturados README/licença e arquivos adicionais para inspeção de Keycloak/OpenFGA. Um commit recente e muitos forks não demonstram revisão adequada, uso por clientes nem ausência de vulnerabilidades. Não foi medida distribuição de mantenedores ou tempo de resposta a PRs nesta amostra. Para OpenFGA, a CNCF registra mantenedores de outras organizações e adoção pública; para Keycloak há encontros/comunidade e projeto de benchmarks. São evidências mais específicas do que popularidade isolada.

O HEAD do LangGraph já difere do pin local ensaiado `3c916d75`/1.2.19. **Nenhum upgrade foi realizado.** Pins e testes anteriores permanecem válidos somente no escopo original.

## Adoção operacional por várias organizações

### Keycloak

[Casos públicos do projeto](https://www.keycloak.org/case-studies) incluem CERN, BRZ, Hitachi, OpenTalk e Breuninger. A página [SRE SIG com notas de uma apresentação de Bosch](https://www.keycloak.org/keycloak-sre-sig/meetings/2024/meeting-2024-10-14) descreve operação de dezenas de instâncias, problemas encontrados e estratégias de teste. A [documentação de HA](https://www.keycloak.org/high-availability/single-cluster/introduction) publica configuração/carga ensaiadas e oferece o projeto Keycloak Benchmark para reproduzir cenários. Não transfiro os números de outra infraestrutura para a nossa.

**Conclusão:** há fundamento para integrar um provedor de identidade existente. O trabalho próprio é federação/configuração/políticas e teste da nossa instalação, incluindo sessões e revogação. SSO sozinho não decide acesso a uma fonte ou efeito.

### OpenFGA

A [CNCF relata adoção pública em produção e contribuição de várias organizações](https://www.cncf.io/blog/2025/11/11/openfga-becomes-a-cncf-incubating-project/). O [projeto](https://openfga.dev/blog/incubation-announcement) identifica, entre outros, Canonical, Docker, Grafana Labs e Read AI. Isso sustenta avaliar o motor como componente. Cada caso tem seu estágio: o [relato específico de Grafana](https://openfga.dev/docs/adopters/grafana) distingue uso interno de produção de shadow/preprodução externa naquele momento; não transformar o nome de um adotante em afirmação de rollout integral.

Há documentação diretamente alinhada ao produto: [RAG Authorization](https://openfga.dev/docs/modeling/agents/rag-authorization), [Task-Based Authorization](https://openfga.dev/docs/modeling/agents/task-based-authorization) e [consistência](https://openfga.dev/docs/interacting/consistency). Esses padrões permitem partir de modelos existentes e adequá-los, em vez de escrever um avaliador genérico de permissões próprio.

**Adaptações críticas:** checks de usuário e tarefa; vínculo do agente à tarefa; grants restritos e temporários. Contexto de horário/contagem é fornecido pelo chamador: precisa vir de autoridade confiável. A condição de contagem não é, por si, uma reserva atômica global de chamadas. O modelo é nosso e pode estar errado mesmo com o motor correto.

O modo padrão pode servir cache; `HIGHER_CONSISTENCY` consulta o banco. Isso não torna atômicas a checagem e uma API externa nem prova revogação instantânea entre os dois passos. Nossa fronteira deve definir invalidação, fence e revalidação. Para LightRAG, filtrar só os documentos finais pode ser insuficiente se a síntese do grafo já misturou informação restrita. A projeção/consulta precisa preservar proveniência e fronteira de acesso antes de qualquer contexto chegar ao modelo.

Código capturado: `pkg/server/check.go` e `check_test.go`; inspeção seletiva de passagem de consistência, validação e separação de cache/fallback. Testes não executados. A self-assessment do [CNCF TAG Security](https://tag-security.cncf.io/community/assessments/projects/openfga/self-assessment/) também distingue falhas do motor de erros no modelo/aplicação.

### gVisor

[Usuários públicos](https://gvisor.dev/users/) incluem serviços Google Cloud e Snowflake; a [documentação de compatibilidade](https://gvisor.dev/docs/user_guide/compatibility/) descreve uso com workloads de terceiros e limites de syscalls. O [modelo de segurança](https://gvisor.dev/docs/architecture_guide/security/) delimita a proteção oferecida.

**Conclusão:** avaliar isolamento pronto para o executor, com rede/mounts/segredos definidos por nós. A PoC em Windows não comprova comportamento de um host Linux de produção. A integração exige ensaio com o código e as ferramentas que nossos agentes realmente usarão. Não reconstruir kernel/sandbox ou assumir que Docker padrão entrega a mesma fronteira.

### LiteLLM

[Casos publicados pelo fornecedor](https://www.litellm.ai/customers) identificam equipes de várias empresas. É evidência de adoção relatada, sem auditoria independente aqui. A [documentação operacional](https://docs.litellm.ai/docs/proxy/prod) trata banco, workers, Redis e gravação de gastos em lote. Medição de gasto não substitui automaticamente nossa reserva rígida por trabalho.

A licença capturada separa `enterprise/`; a API GitHub retornou `NOASSERTION`, mas o texto permite identificar MIT no restante e licença própria na área Enterprise. Recursos necessários precisam ser conferidos individualmente antes de distribuição.

**Achado concreto de fornecimento:** o [fornecedor relatou comprometimento da versão v1.107.0 em 21/10/2026](https://docs.litellm.ai/blog/security-incident-oct-21-2026). Não instalamos essa versão nem executamos código do projeto. Esse evento impede recomendar um pacote pelo nome sem qualificar versão/origem/artefato. LiteLLM permanece candidato; nenhuma versão foi aprovada por esta captura de README. Confirmar advisories, imagem/pacote verificável e superfície necessária fará parte da avaliação dirigida.

## Papel dos artigos, YouTube e demonstrações

O [estudo anterior](../production-conferences-2026-11-05/REPORT.md) já liga conferências e casos operacionais a ensaios. Esses materiais ajudam a compreender contratos e escolher testes. Adoção exige código e comportamento compatíveis com nosso cenário.

Exemplo novo: a documentação OpenFGA referencia uma [demonstração com código do MCP Dev Summit 2026](https://github.com/aaguiarz/ibac-talk-demo) e [vídeo](https://www.youtube.com/watch?v=IVIvtusd7LA). O README descreve planejamento estruturado, resolução de recursos, grants por tarefa, middleware e cleanup. É uma ponte entre os componentes, não um produto empresarial validado. A página do vídeo não pôde ser recuperada pela ferramenta; não foi assistido. O exemplo tem pequena comunidade e permanece material didático; a evidência de maturidade do motor vem de outras fontes.

Isso permite combinar três coisas diferentes: um componente maduro, um exemplo legível de integração e casos de teste derivados de pesquisa. Nenhuma demonstração isolada define a arquitetura.

## O que continua específico do produto

1. **Domínio:** catálogo de capacidades, CoS, seleção A0–A4, equipes dinâmicas e fluxos empresariais.
2. **Governança:** distinguir fontes canônicas, extrações e histórias originais; revisão, publicação, vigência e ACL corrente.
3. **Autorização de execução:** identidade/grants de componentes prontos ligados ao plano/payload exato, orçamento e recibo.
4. **Recuperação conjunta:** regras para conciliar estado empresarial, checkpoint e autoridade externa após crash/restore, usando mecanismos nativos onde disponíveis.
5. **Experiência:** JARVIS funcional/3D, acompanhamento, aprovações e edição opcional via Obsidian.

Os quatro FAIL de V1 são evidência de integração incompleta. Devem gerar correção/ensaio na fronteira correspondente e busca de mecanismos reutilizáveis. Não foram corrigidos nesta pesquisa. O ganho esperado de reaproveitamento precisa aparecer em implementação/testes, não apenas em novos nomes na arquitetura.

## Ordem proposta de trabalho

1. **Consolidar o contrato e os mecanismos já existentes de recovery** em LangGraph/PostgreSQL e autoridade externa; requalificar as quatro falhas originais. Esse recorte mantém a engenharia dentro do investimento delimitado autorizado.
2. **Avaliar identidade/permissões por integração:** Keycloak + modelo OpenFGA mínimo para uma fonte e uma ferramenta; incluir expiração, delegação e revogação. Importar modelos/padrões prontos e adaptar às nossas entidades; não construir novo IdP/avaliador.
3. **Qualificar executor e acesso a modelos:** decidir se gVisor e gateway agregam valor no ambiente alvo; verificar distribuição, dependências e operação. A escolha do gateway não antecipa escolha do modelo.
4. **Validar uma jornada completa:** pedido → CoS → estratégia → fontes autorizadas → aprovação → efeito controlado → recibo → restart/restore. Medir correção, custo e intervenção com e sem equipe.

Esses blocos não precisam virar uma longa lista de pesquisas sequenciais. Cada um deve encerrar com decisão concreta de integrar, adaptar ou descartar no escopo ensaiado. Não iniciar desenvolvimento amplo com lacuna de integridade encoberta por popularidade do componente.

## Preservação arquitetural

R01–R21 de [ARQUITETURA_BASE](../../docs/ARQUITETURA_BASE.md) mantidos. Instalação dedicada por empresa; cérebro persistente; TypeScript empresarial + Python IA; LangGraph único owner; LightRAG reutilizado; PostgreSQL/pgvector e Neo4j como perfil inicial; CoS/controlador A0–A4; equipes por capacidades; autorizações por operação, sandbox, orçamento e auditoria externa; histórias/proveniência/versões separadas; JARVIS/3D; Obsidian opcional; provedor comercial independente de conta pessoal. Nenhum componente novo desta matriz está implicitamente adotado ou homologado.

## Evidências e limites da rodada

[Coleta](collect.py), [metadados/commits/hashes](repositories.json), [registro](COMMANDS.md). Só fontes públicas e arquivos de texto foram baixados; zero instalação, inferência ou suíte upstream executada. A verificação de captura é integridade documental, não homologação. Não estimado número total de clientes por forks/downloads. Não auditada comunidade inteira. Links web são mutáveis; arquivos locais estão vinculados a SHA de repositório.
