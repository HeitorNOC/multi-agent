# Plataforma empresarial multiagente

**Código do Aurora.** O [guia de instalação, manutenção e verificação](docs/ORGANIZACAO_AURORA.md) cobre a instalação dedicada, a interface 3D e a telemetria. A aplicação fica em `apps/aurora/`, com a API local e os serviços de negócio em `packages/`.

**Central humana — entrega posterior (05/11):** [guia](validation/human-recovery/README.md) e [resultados](validation/human-recovery/RESULTS.md). API e interface conectadas a inspeção/revisão/segunda confirmação, com seleção explícita, journal persistente, concorrência e consulta de envio perdido. Perfil operacional disponível sem modelos; 33 Node e suíte principal de 16 Python passaram. Escopo: operações do protocolo conectado; slots diretos de LLM ainda não foram migrados. Produção permanece NO-GO.

**Central humana integrada (05/11):** [uso e escopo](validation/human-recovery/README.md), [testes e limitações](validation/human-recovery/RESULTS.md). API/interface agora acionam inspeção, primeira revisão, confirmação independente e consulta de envio perdido no protocolo conectado; múltiplos casos, grants atuais e restauração antiga foram testados. Perfil operacional disponível sem modelos. Os slots diretos de LLM da demo ainda precisam ser vinculados a esse ledger; produção permanece NO-GO.

**Rodada posterior de observabilidade/recuperação (05/11):** [procedimentos e resultados](validation/observability-recovery/RESULTS.md). Dez testes de recuperação, 30 Node e 12 outros Python passaram; campanha Aurora com oito agentes e incidente com quatro passaram no novo ensaio real, com trilha e 12 handoffs conferidos. Uma primeira proposta de dez agentes foi recusada e preservada. Novos procedimentos qualificam o envelope de protocolo; os FAIL históricos não foram apagados, a central humana ainda precisa integrar a recuperação e produção permanece NO-GO. [Plano incorporado](docs/PLANO_OBSERVABILIDADE.md).

**Ensaio empresarial Aurora (05/11):** [painel com cérebro central, 21 agentes disponíveis e delegação em diretorias](demo-enterprise/README.md). Corpus fictício com 16 fontes vigentes e uma versão histórica. Resultados e falhas em [RESULTS](demo-enterprise/RESULTS.md); este ensaio não aprova produção.

**Entrega atual, autorizada pelo usuário:** [demonstração local operável de vendas e estoque](demo/README.md), com interface React/TypeScript, API própria, LangGraph/PostgreSQL, recuperação LightRAG e análise real por Chief of Staff + dois especialistas. Aprovação exata, efeito simulado e retomada entre processos testados: [resultados](demo/RESULTS.md). Login corporativo adiado. É uma jornada delimitada com dados fictícios; não substitui a homologação empresarial nem requalifica os negativos históricos.

**Direção de integração e reaproveitamento:** [mapa por responsabilidade](research/reuse-map-2026-11-05/MAPA.md). A pedido do usuário, o foco passa a explicitar componentes que já entregam os processos, evidência de adoção/comunidade, código disponível e adaptações empresariais. Novos candidatos específicos: OpenFGA, gVisor e gateway de modelos; Keycloak permanece candidato preferencial de identidade. Seis repositórios com métricas/commits/licenças capturados; nenhuma adoção ou instalação nova. Preservar R01–R21 e qualificar as integrações.

**Ampliação para operação e conferências:** [casos reais e artigos 2025–2026](research/production-conferences-2026-11-05/REPORT.md). Uber Finch/identidade, Stripe, Anthropic, CIDR, NeurIPS, ICML, ACL, COLM, ICLR e USENIX informam padrões e limites. Distingue operação relatada, pesquisa revisada e preprint; propõe ensaios de transferência. Sem novo teste integrado, adoção ou mudança do NO-GO local.

**Estudo comparativo atual, solicitado pelo usuário:** [documentação, cursos, aplicações e sistemas reais](research/langgraph-study-2026-11-05/REPORT.md). Seis repositórios fixados, 44 arquivos e nove notebooks; integridade da captura verificada, sem executar suítes upstream. Proposta: LangGraph core obrigatório e harness opcional em subgrafos; comparar Deep Agents antes de adotá-lo. Open SWE atual requer runtime gerido na distribuição; DeerFlow tem políticas de dedup que exigem adaptação. Os quatro negativos empresariais continuam abertos; nenhuma aprovação nova de produção ou desenvolvimento amplo.

**Pesquisa dirigida mais recente:** [soluções LangGraph já existentes](research/langgraph-reuse-2026-11-05/REPORT.md), incluindo YouTube, código fixado e prova nativa sem LLM. A recomendação é adaptar tasks/checkpoints/retries/interrupts e admissão/outbox, avaliando Deep Agents como harness pronto; não reconstruir a orquestração geral. O teste dirigido passou, mas ainda não requalifica o ledger empresarial de V1.

**Fase atual: validação final de viabilidade antes do desenvolvimento amplo.** A comparação geral de ferramentas foi encerrada, mas o usuário pediu rever o NO-GO e comprovar o fundamento do investimento antes de iniciar o produto. [Parecer atual e gate de decisão](docs/REVISAO_NO_GO.md). Produção continua não autorizada/não homologada.

**Gate executado em 05/11/2026:** [resultado dos quatro pontos](validation/investment-gate/RESULTS.md). Recuperação operacional reprovou quatro critérios; conhecimento passou no envelope pequeno; multiagente e operação/economia ficaram condicionados. Recomendação atual: não iniciar desenvolvimento amplo; limitar engenharia à recuperação/contratos identificados, sem trocar toda a stack ou presumir aprovação de produção.

- [Encerramento da investigação e decisão de transição](docs/ENCERRAMENTO_INVESTIGACAO.md)
- [Arquitetura de referência e requisitos preservados](docs/ARQUITETURA_BASE.md)
- [Plano de desenvolvimento e primeira entrega funcional](docs/PLANO_DESENVOLVIMENTO.md)
- [Pendências e critérios para produção](docs/PENDENCIAS_PRODUCAO.md)
- [Estado e evidências dos ensaios](validation/STATUS.md)
- [Dossiê original transferido](poc/DOSSIER.md)

`poc/`, `research/` e `validation/` preservam a investigação, as falhas e os protótipos. `vendor/` contém os componentes inspecionados. Esses diretórios não constituem uma distribuição do produto. Os documentos em `docs/` consolidam a direção atual; recomendações anteriores de continuar comparando ferramentas são históricas.

Os quatro pontos da validação dirigida foram executados com resultados e pendências explícitos. A base do produto e sua primeira jornada utilizável continuam condicionadas à correção/qualificação dos bloqueios de investimento identificados. Não reabrir seleção geral de stacks sem impedimento concreto.

A instrução original do dossiê de limitar o trabalho à PoC foi sucedida pela orientação posterior do usuário para avançar ao desenvolvimento e encerrar a investigação. Isso não autoriza implantação em produção, compras ou acesso a dados/segredos reais.
