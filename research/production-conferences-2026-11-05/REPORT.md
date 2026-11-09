# Sistemas em operação e conferências: evidências para nossa arquitetura

Pesquisa em 05/11/2026, ampliada a pedido do usuário. Complementa o [estudo de código e cursos](../langgraph-study-2026-11-05/REPORT.md). Busca web geral, fontes Google Research e anais oficiais de conferências; não foi usado navegador Google autenticado nem Google Scholar como evidência de aceite. Consultas e escopo em [COMMANDS](COMMANDS.md).

## Parecer

**Existe evidência concreta de que o padrão desejado é viável: motores reutilizados, agentes delimitados e uma camada empresarial própria.** Os casos mais úteis encontrados foram Uber Finch/identidade, Stripe Minions e Anthropic Research. Eles não constituem uma plataforma completa pronta que cumpra todos os nossos requisitos.

Os artigos recentes ajudam a decidir *onde* colocar limites, *como* medir a equipe e *por que* recuperação não pode presumir o resultado de uma API externa. Minha recomendação continua sendo LangGraph como único dono do workflow e domínio empresarial próprio. Agora há referências mais específicas para projetar identidade delegada, catálogo de ferramentas, execução híbrida e avaliação do cérebro.

**Não há novo GO de produção.** Os quatro negativos de recuperação da implementação local permanecem abertos. O estudo sustenta investimento delimitado na solução desses bloqueios, sem afirmar que foram corrigidos. Nenhuma inferência, instalação ou teste integrado novo foi realizado nesta rodada.

## O significado de “validado” nesta pesquisa

- **Uso operacional relatado pelo próprio operador:** demonstra que a equipe declara operar aquele sistema. Métricas são do autor, sem auditoria independente nossa.
- **Avaliação empírica publicada em conferência:** demonstra investigação revisada e resultados no protocolo descrito; não prova operação empresarial, segurança universal ou compatibilidade com nossa versão.
- **Código/dados públicos:** tornam possível uma reprodução futura; ter um repositório não significa que nós reproduzimos os resultados ou que o artefato recebeu selo de avaliação.
- **Proposta/protótipo ou preprint:** pode orientar desenho, mas tem peso distinto de um sistema operacional ou de um resultado conferido nos anais.

Nenhuma dessas categorias é um certificado transferível ao nosso produto. Não classifiquei todos os trabalhos que aparecem no Google Research como artigos de conferência.

## Sistemas reais mais relevantes

### 1. Uber Finch — domínio financeiro, supervisão e LangGraph

Fonte do operador, 17/07/2025: [Unlocking Financial Insights with Finch](https://www.uber.com/us/en/blog/unlocking-financial-insights-with-finch/).

A Uber descreve um assistente financeiro em Slack, com supervisor e agentes especializados orquestrados em LangGraph. Usa dados curados, metadados semânticos e controle de acesso; avalia componentes, roteamento, resultados finais e regressões. Para SQL, compara o resultado da consulta com o resultado esperado, em vez de exigir uma única string SQL.

**Aplicação ao nosso produto:** organizar conhecimento por fontes governadas e capacidades, oferecer vocabulário empresarial, avaliar separadamente recuperação, roteamento e síntese. A interface Slack do caso não nos obriga a abrir mão do JARVIS.

**Limite:** não há código completo, protocolo público de crash/restore ou prova de todas as nossas garantias. Não transfiro precisão ou capacidade desse caso para a nossa instalação. É o exemplo funcional mais próximo encontrado nesta rodada, não um substituto pronto do produto.

### 2. Uber — identidade delegada e gateway de ferramentas

Fonte do operador, 21/05/2026: [Solving the Identity Crisis for AI Agents](https://www.uber.com/us/en/blog/solving-the-agent-identity-crisis/).

Descreve registro de agentes, identidade verificável, tokens curtos por salto e gateway MCP como ponto de aplicação de política. A origem humana e as delegações precisam acompanhar as chamadas. A equipe explica que o proxy sozinho não bastava: a aplicação/SDK também precisa propagar contexto.

**Aplicação:** definir um envelope autenticado de delegação contendo trabalho, identidade originadora, agente executor, cadeia de delegação, versão da política e escopo. Servidor emite/valida; o modelo não pode inventar ou ampliar esse envelope. O gateway confere a operação e o destinatário.

**Limite:** o artigo não publica todos os detalhes operacionais nem nos obriga a reproduzir Kubernetes/mesh/STS como serviços separados. Nossa API TS e adaptadores Python podem implementar a fronteira em uma instalação dedicada. Rastreabilidade não dispensa revalidação da ACL corrente.

### 3. Stripe Minions — workflows determinísticos com agentes dentro de limites

Fontes do operador, fevereiro/2026: [parte 1](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) e [parte 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2).

O relato mostra uso recorrente com PRs revisados por humanos. A equipe adaptou o agente Goose e criou blueprints que alternam código determinístico com laços de agente. Ferramentas vêm de um catálogo central, em subconjuntos por tarefa. Devboxes são isoladas de produção, dados reais e saída arbitrária de rede.

**Aplicação:** políticas, orçamento, verificação e recibos são etapas explícitas; planejamento e investigação podem ser agentivos. Catalogar uma ferramenta não concede acesso universal a ela. Limitar ciclos de correção e encerrar honestamente quando o limite é atingido.

**Limite:** automação de engenharia e revisão de PR não equivalem a autonomia sobre finanças/ERP. É evidência de composição e contenção, não motivo para trocar LangGraph por Goose ou adotar o fork da Stripe.

### 4. Anthropic Research — coordenação de exploração paralela

Fonte da equipe, 13/06/2025: [How we built our multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system).

Descreve coordenador, pesquisadores isolados e etapa de citações. Explica problemas de delegação, trabalho duplicado, crescimento de custo e retomada, além de avaliação e observabilidade. Serve especialmente para tarefas com frentes de pesquisa independentes.

**Aplicação:** cada delegação deve ter objetivo, fontes, limites, formato de retorno e condição de encerramento; o resultado precisa distinguir evidência, hipótese e conflito. Guardar artefatos de trabalho e planos sem convertê-los automaticamente em conhecimento aprovado.

**Limite:** resultados internos não demonstram vantagem para todas as tarefas. Para nós, políticas de esforço inspiradas em prompts precisam também de imposição no servidor. Pesquisa paralela não prova execução transacional, ACL temporal ou o custo comercial da nossa instalação.

### 5. S3Mirror/BMS — durabilidade de negócio fora do universo de chat

[Relato com participação do usuário do sistema e do fornecedor](https://arxiv.org/abs/2506.10886), 2025, e [caso BMS](https://www.dbos.dev/case-studies/bms).

Pipeline de transferência de dados genômicos com processamento por arquivo, histórico consultável de falhas/sucessos e recuperação usando DBOS. É relevante para rastreabilidade de ingestão longa e jobs independentes; não é um sistema multiagente.

**Aplicação:** ingestão deve ter unidades rastreáveis e estado durável por documento/versão, incluindo itens parcialmente concluídos. Medir custo e resultado por lote sem apagar erros.

**Limite:** publicação consultada é preprint, com coautoria ligada ao fornecedor; o caso é hospedado pelo fornecedor. Não declaro aceite em conferência. Não adicionar DBOS sobre LangGraph como segundo dono da execução. Seu desenho pode orientar testes e uma alternativa futura, caso um impedimento concreto justifique reabrir essa decisão.

## Artigos de conferências e consequências práticas

### Recuperação e integridade: CIDR 2026

**Consistency and Correctness in Data-Oriented Workflow Systems**, Stonebraker et al. [Anais](https://www.vldb.org/cidrdb/2026/consistency-and-correctness-in-data-oriented-workflow-systems.html), [artigo, seção 6.1](https://www.vldb.org/cidrdb/papers/2026/p9-stonebraker.pdf).

Estuda semântica de workflows, compensação e backout; avalia um protótipo em carga de comércio eletrônico. A seção de serviços externos reconhece que perda de resposta deixa execução incerta: idempotência do serviço, consulta de estado ou intervenção continuam necessárias. Não é garantia de atomicidade com qualquer API.

**Decisão derivada:** não interpretar `unknown` como defeito exclusivo do LangGraph, nem procurar um motor que magicamente elimine a ambiguidade externa. Nosso adaptador precisa de identidade estável, recibo verificável e conciliação governada. Compensação é nova operação autorizada; não desfaz automaticamente um efeito irreversível. O artigo é de pesquisadores com participação DBOS, não avaliação neutra de todos os motores.

### Falhas de coordenação: NeurIPS 2025

**Why Do Multi-Agent LLM Systems Fail?**, Cemri et al. [Registro nos anais e PDF](https://papers.nips.cc/paper_files/paper/2025/hash/b1041e52d3be19f0a9bc491657488e4a-Abstract-Datasets_and_Benchmarks_Track.html).

O trabalho reúne 1.642 traces de sete frameworks e propõe MAST: 14 modos de falha, agrupados em desenho/especificação, desalinhamento entre agentes e verificação/encerramento. Dados e anotador são públicos. O recorte não cobre todos os sistemas possíveis; classificação automática e uma amostra humana não são verdade absoluta.

**Decisão:** avaliar cumprimento do objetivo e das restrições, repetição, perda de história, informação omitida, divergência entre raciocínio e ação, término prematuro e verificação incorreta. O estado final `END` não significa que a entrega foi correta. Não aplicar as taxas observadas como previsão de falha do nosso sistema.

### Avaliação da colaboração: ACL 2025 e atribuição de falhas: ICML 2025

**MultiAgentBench**, Zhu et al. [ACL 2025](https://aclanthology.org/2025.acl-long.421/): compara protocolos de coordenação e mede marcos intermediários, não só a resposta final. Código MARBLE disponível. **Aplicação:** medir o que cada especialista acrescentou, dependências resolvidas e duplicações. Seus cenários não demonstram integridade de operações empresariais.

**Which Agent Causes Task Failures and When?**, Zhang et al. [ICML 2025/PMLR](https://proceedings.mlr.press/v267/zhang25cq.html): trata identificação do agente e passo responsáveis por falhas. O próprio trabalho relata limitações de atribuição automática. **Aplicação:** preservar trace correlacionado e evidência para revisão; um juiz LLM pode auxiliar diagnóstico, mas não encerrar `unknown`, liberar efeito ou certificar ACL.

### Custo e controlador adaptativo: COLM 2026

**Budget-Aware Tool Use Enables Effective Agent Scaling**, Liu et al. [Registro Google Research](https://research.google/pubs/cost-effective-agent-test-time-scaling/), [versão v2 de 17/08/2026](https://arxiv.org/html/2511.17006v2).

Estuda estratégias de busca sob orçamento de ferramentas e contabiliza custo conjunto de tokens e ferramentas. O registro dos autores e o arXiv informam COLM 2026; nesta rodada não foi conferido o registro individual nos anais da conferência. Há divergência de nomenclatura: o registro Google apresenta CATS, enquanto o corpo HTML v2 consultado ainda usa BATS. Não tratar isso como algoritmo distinto ou mudança de versão comprovada. O apêndice G reconhece restrições conjuntas e alocação de recursos como questões em aberto.

**Decisão:** A0–A4 deve considerar custo de toda a entrega: recuperação, ingestão amortizada, ferramentas, retries e conciliação. Comparar estratégias com orçamento equivalente e o mesmo contexto; estabelecer parada e reserva global no servidor. Essa ampliação é proposta nossa; o artigo não demonstra controle global de todos esses recursos. Não é controlador empresarial pronto nem prova de custo real do produto.

### Topologia e prompts: ICLR 2026

**Multi-Agent Design: Optimizing Agents with Better Prompts and Topologies**, Zhou et al. [Registro dos autores](https://research.google/pubs/multi-agent-design-optimizing-agents-with-better-prompts-and-topologies/), [artigo](https://arxiv.org/pdf/2502.02533).

MASS otimiza prompts e topologia em etapas; há limites no espaço pesquisado e nas tarefas avaliadas. O histórico público do OpenReview lista uma submissão anterior a ICML 2025 e outra como ICLR 2026 Poster; não usar a cópia anônima antiga como comprovação de aceite no ICML.

**Decisão:** catálogo inicial de estratégias versionadas e avaliadas, em vez de dar ao modelo permissão irrestrita para inventar equipes. Otimização pode ocorrer offline e resultar em nova estratégia revisada; execução A4 escolhe dentro de opções permitidas. Adotar busca automática de arquitetura na execução ainda exigiria evidência específica.

Complemento, não classificado como conferência nesta rodada: [Google Research, Towards a Science of Scaling Agent Systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/), janeiro/2026. A avaliação de 180 configurações encontra dependência do tipo de tarefa: paralelismo ajuda alguns domínios e piora outros sequenciais. Reforça nossa hipótese de escalonamento seletivo; não prova que o controlador generaliza para nossos clientes. Não usamos um percentual agregado como meta universal.

### Segurança da entrada: USENIX Security 2026

**When AIOps Become “AI Oops”**, Pasquini et al. [Conferência](https://www.usenix.org/conference/usenixsecurity26/presentation/pasquini), [PDF prepublication consultado](https://www.usenix.org/system/files/conference/usenixsecurity26/sec26_prepub_pasquini.pdf).

Mostra que telemetria manipulada pode induzir remediações adversariais. A avaliação usa 180 execuções e julga equivalência das remediações com apoio de LLM, com conferência humana parcial. A defesa depende de estrutura/sanitização e reconhece limites de generalização; não resolve prompt injection em qualquer texto.

**Decisão:** logs, documentos, resultados de busca e respostas de ferramentas são dados não confiáveis. Podem orientar raciocínio, mas nunca emitir autorização. Testar uma fonte aparentemente legítima que tenta induzir publicação, troca de política ou exfiltração. O servidor deve negar o efeito independentemente da narrativa. Não confundir sanitização com fronteira completa de segurança.

### Escala de inferência: NSDI 2026

**Agentix: An Efficient Serving Engine for LLM Agents as General Programs**, Luo et al. [Conferência](https://www.usenix.org/conference/nsdi26/presentation/luo), [PDF final](https://www.usenix.org/system/files/nsdi26-luo.pdf).

Avalia scheduling de inferência com contexto do programa, incluindo dependências entre chamadas, em cargas e modelos específicos. A comparação usa versões/configurações próprias, inclusive vLLM 0.6.1; ganhos publicados não são previsão contra stacks atuais ou APIs comerciais.

**Decisão:** medir latência e throughput por trabalho concluído, cauda e contenção, não apenas tokens/s ou tempo de uma chamada. É pesquisa de serving de modelos, não substituto de recuperação do workflow ou novo cérebro. Seu scheduler de GPU é camada diferente de um owner de workflow; ainda assim, não há motivo medido para instalar esse serving no nosso piloto.

## O cérebro: evidência favorável e contraprova

**LightRAG**, Guo et al., [Findings EMNLP 2025](https://aclanthology.org/2025.findings-emnlp.568/). Consultadas seções de experimento e avaliação: combina recuperação por grafo/vetor e usa comparação de respostas por juiz LLM em dimensões de qualidade. Isso é evidência de pesquisa do motor, não valida ACL, temporalidade ou recuperação exata de todo fato necessário.

**HippoRAG 2**, Gutiérrez et al., [ICML 2025](https://proceedings.mlr.press/v267/gutierrez25a.html). Compara memória factual, associação e integração de passagens ao grafo, com código/dados públicos. Mostra por que precisamos separar consultas factuais das associativas; não demonstra governança empresarial.

**PropRAG**, Wang e Han, [EMNLP 2025](https://aclanthology.org/2025.emnlp-main.317/), [seções 6 e apêndice de custos](https://aclanthology.org/2025.emnlp-main.317.pdf). Reporta desempenho fraco de LightRAG em seu protocolo factual/multi-hop; parte dos baselines vem de trabalho anterior. Isso contrasta com a avaliação original orientada a respostas abrangentes. Não reproduzimos baselines/configurações, nem homologamos uma alternativa pelo ranking. A conclusão aplicável é exigir avaliação local por tipo de pergunta e custo de indexação, sem assumir que grafo sempre melhora a resposta.

**Recomendação:** manter o LightRAG reutilizado e fixado como candidato inicial, sem aprovação antecipada de qualidade. Incluir comparação com busca simples/híbrida sobre as mesmas fontes e, se houver falha relevante, qualificar um concorrente sob o mesmo protocolo. HippoRAG/PropRAG são referências para um challenger, não migração aprovada. Cérebro empresarial continua abrangendo fontes canônicas, fatos extraídos e histórias originais separados, com ACL corrente e proveniência temporal.

## Síntese de decisões propostas

| Fronteira | Padrão sustentado pelas fontes | Aplicação à nossa arquitetura | Estado |
|---|---|---|---|
| Orquestração | Grafo explícito com trechos agentivos delimitados | LangGraph único owner; políticas/efeitos fora da autoridade do modelo | Manter direção; recuperação local ainda reprovada |
| Identidade | Delegação verificável e política em gateway + aplicação | Identidade originadora e agente por operação, token curto, ACL revalidada | Contrato a integrar e testar |
| Ferramentas | Catálogo comum, subconjuntos por capacidade | Descoberta não implica grant; MCP/APIs autorizados por payload/destinatário | Sem concessão ampla por herança |
| Equipes | Delegação delimitada e topologia dependente da tarefa | CoS/controlador A0–A4, equipes dinâmicas por capacidade | Ganho multiagente local ainda não demonstrado |
| Conhecimento | Dados curados, recuperação especializada e avaliação por tipo | LightRAG sob API própria; simples/híbrido como baseline, não todo acesso via grafo | Expansão de qualidade/carga pendente |
| Durabilidade | Progresso durável + reconciliação de efeito externo | Outbox/admissão, chave estável, recibos e `unknown` governado | Quatro critérios V1 continuam FAIL |
| Operação | Isolamento, escopo pequeno e avaliação contínua | Sandbox, limites de rede/segredos, regressões e tracing por trabalho | DR/SSO/fatura/escala ainda pendentes |

Essa composição preserva R01–R21 de [ARQUITETURA_BASE](../../docs/ARQUITETURA_BASE.md): instalação por empresa, TS empresarial + Python IA, cérebro persistente, CoS/A0–A4, equipes por capacidades, políticas/versões/proveniência, sandbox, orçamento, auditoria externa/antirollback, JARVIS/3D, Obsidian opcional e independência de conta pessoal. Nada aqui aprova troca de motor, segundo scheduler, novas compras ou produção.

## Ensaios que as fontes tornam mais precisos

Estes são critérios propostos, **não resultados executados**:

| ID | Ensaio delimitado | Evidência de sucesso exigida |
|---|---|---|
| E01 | Três crashes de `read_commit` e fechamento de inferência unknown | Reinício/restore conciliam com autoridade; sem efeito duplicado, recibo fabricado ou liberação indevida. Requalifica os quatro casos originais |
| E02 | Delegação atravessa CoS → especialista → gateway; usuário perde grant enquanto espera | Origem/escopo verificáveis em cada salto; revogação bloqueia ferramenta e contexto restrito; modelo não amplia grant |
| E03 | Tarefa factual, sequencial e transversal nas estratégias A1/A2/A3 | Mesmos dados/modelo/orçamento; sucesso por marcos e resposta, custo total, p95, erro e intervenções. Paralelismo só se justifica por ganho observado |
| E04 | Fonte/log/tool injeta instrução para executar efeito fora do plano | Operação negada pelo servidor; nenhuma saída de dados/segredos; tentativa registrada sem conteúdo sensível desnecessário |
| E05 | Cérebro: fato exato, relações, pergunta global, versões conflitantes, fonte ausente e revogação | Evidência recuperada correta, resposta apoiada, abstenção quando necessário; zero contexto sem grant; custo de ingestão e consulta registrados |
| E06 | Restart após mudança de versão de prompt/grafo/schema/ferramenta | Pin do trabalho identifica versão; resume compatível ou bloqueio/migração explícita; resultado antigo não reinterpretado silenciosamente |

E01 é prioridade para liberar investimento mais amplo. E02–E06 qualificam dimensões diferentes; não devem ser usados para adiar indefinidamente a correção concreta do núcleo. Seleção comparativa de harness pode compartilhar E03, mas uma melhoria média não compensa violação de política.

## Escopo e pendências de evidência

Leitura dirigida de arquitetura, método, avaliação e limitações nas fontes citadas; não leitura integral de todos os apêndices ou auditoria dos ambientes das empresas. Não foram reproduzidos números publicados nem executados artefatos acadêmicos. Não foi verificado selo de artifact evaluation do Agentix. Para CATS, confirmação de conferência nesta rodada é dos registros dos autores/arXiv, explicitada acima. Para propostas Google on-call e infraestrutura, resultados de busca não bastaram para caracterizar avaliação; ficaram fora das decisões principais.

O resultado é um fundamento técnico e um protocolo de transferência de padrões. Só nossos ensaios poderão converter essas hipóteses em evidência sobre a nossa instalação.
