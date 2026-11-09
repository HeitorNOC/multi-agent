# Decisão de viabilidade e investimento — 05/11/2026

**Parecer: NO-GO para iniciar o desenvolvimento amplo do produto e para produção nesta implementação. GO condicionado somente para engenharia delimitada do núcleo de recuperação e dos contratos do controlador.** Os quatro pontos foram avaliados. A integração e o conhecimento funcionaram no envelope pequeno, mas continuidade operacional falhou em situações concretas. Não há evidência de impossibilidade universal de LangGraph/LightRAG nem razão demonstrada para trocar toda a stack.

Esta rodada encerra o gate com resultados negativos/condicionados; não recomenda mais uma comparação geral. O investimento amplo deve aguardar os bloqueios identificados, em vez de avançar interface/produto completo presumindo que toda lacuna seja só homologação.

## Decisão por ponto

| Ponto | Resultado | Consequência para investimento |
|---|---|---|
| V1 — Integridade e continuidade | **FAIL.** Quatro critérios operacionais reprovados: três janelas de `read_commit` e encerramento de inferência unknown. Heartbeat automático passou | Bloqueio concreto de continuidade; corrigir o protocolo de recuperação na camada própria antes de investimento amplo |
| V2 — Cérebro e carga | **PASS no envelope pequeno; escala empresarial não comprovada.** Oito documentos nativos, quatro casos semânticos, 48 contextos e mil vetores em teste separado | Manter LightRAG como componente; não prometer capacidade de empresa grande nem confundir contexto com resposta gerada |
| V3 — CoS/controlador/equipe | **CONDICIONAL, com teste final de contrato ainda FAIL.** Após correção da recuperação, fatos/citações corretos; divergência de metadado de aprovação do modelo, backend preservou bloqueio | Composição real foi executada, sem ganho de qualidade demonstrado; integrar contrato autoritativo de política e justificar escalonamento por necessidade |
| V4 — Operação e economia | **CONDICIONAL/PENDENTE.** Controles locais e opção comercial documentada; sem DR físico externo, SSO empresarial integrado ou fatura atribuível | Não aprovar operação/custo total de uma instalação real com base nestes testes locais |

[Critérios anteriores à execução](PLAN.md), [comandos/falhas/adaptações](COMMANDS.md), [verificação de provas/consumo](verification.json), [ambiente](environment.json), [fontes oficiais](SOURCES.md), [manifesto de código/artefatos](manifest.json).

## V1 — Falhas reais de continuidade

[JUnit principal](v1.xml): **3 FAIL e 1 PASS em 41,69 s**. [Caso unknown](unknown.xml): **1 FAIL em 5,94 s**. Nenhum modelo invocado nesses ensaios. Cada caso usou instalação descartável com TypeScript, autoridade Ed25519 e PostgreSQL reais; provedor de inferência controlado, explicitamente sem qualidade semântica simulada como modelo real.

| Queda | Estado encontrado | Resultado de restart e restore |
|---|---|---|
| Após intenção, antes do commit empresarial (saída 77) | Zero leituras persistidas; provedor tem um recibo completo | Intenção retida pendente; recuperação existente recusa a categoria; instância continua bloqueada |
| Após commit empresarial, antes do recibo local (saída 82) | Uma leitura persistida, sem recibo correspondente no diário local | Mesma recusa; backup dessa geração em novo PostgreSQL não resolve o protocolo incompleto |
| Após recibo local, antes de confirmar na autoridade (saída 83) | Uma leitura e recibo local; autoridade ainda pendente | Recibo local não é aceito cegamente; continua bloqueado sem procedimento qualificado |
| Provedor admitiu e caiu antes do recibo | Três retries recusados, zero leituras, uma execução do provedor | Autoridade empresarial está atual, mas essa inferência continua desconhecida e sem encerramento governado elegível |

Não houve repetição de inferência/efeito nos casos, nem resultado aceito por bypass. Isso é evidência favorável de segurança, mas **bloqueio seguro sem recuperação operacional reprovou o critério de continuidade**. Nos três primeiros casos o head pendente impede a atualidade empresarial; no último só a inferência está unknown e não se deve confundir com uma intenção empresarial global pendente.

O código de inspeção de recuperação qualifica atualmente `business_create` e `business_effect`, não `business_read_commit`: [fronteira concreta](../langgraph-retained-flow/retained.ts). O problema é do protocolo de conciliação da camada própria. Um checkpoint LangGraph ou restore do banco, isoladamente, não fornece essa regra de negócio.

Foi implementado heartbeat automático opcional no worker. Uma consulta durou três segundos com lease inicial de dois segundos, renovou automaticamente e concluiu; após terminar não continuou renovando. Outra consulta perdeu o lease por fencing, interrompeu avanço e não persistiu leitura tardia. Esse PASS é limitado; não qualifica todas as falhas de rede/cancelamento.

## V2 — Envelope efetivamente medido

Oito releases fictícias ACME, uma por documento/projeção: política v1/v2, vendas janeiro/fevereiro, marketing, financeiro, estoque e regra de execução. Staging usa assinatura de revisor de fixture; o fluxo editorial humano completo não é revalidado por esse staging. LightRAG 1.5.8, extração Terra real, ONNX multilíngue 384d, PostgreSQL/pgvector e Neo4j reais. Citações/versões são próprias de cada projeção; não se afirma grafo temporal bitemporal universal.

Quatro casos semânticos passaram: dois dias na política v1, três na v2, receita de fevereiro de 8.000 e abstenção sobre CEO ausente. Fonte financeira sem grant foi recusada pela política antes da recuperação. Exclusão nativa do documento de estoque invalidou o certificado anterior; consulta posterior recebeu 409 sem nova chamada de modelo. Os cinco probes de política (assinatura alterada, expiração, fonte restrita, efeito sem aprovação e orçamento excedido) foram recusados.

| Recuperação de contexto aquecido | N | p50 | p95 | Contextos esperados |
|---|---:|---:|---:|---:|
| Concorrência 1 | 16 | 0,160 s | 0,181 s | 16/16 |
| Concorrência 4 | 16 | 0,310 s | 0,405 s | 16/16 |
| Concorrência 8 | 16 | 0,609 s | 0,763 s | 16/16 |

Meta experimental p95 <= 2 s atingida. **Não são respostas LLM concorrentes**, nem medição de throughput empresarial. A API nativa ainda serializa parte das operações e o adaptador serializa chamadas Codex. Uma única fonte foi repetida nessa carga; a pequena amostra não mede diversidade ou cauda de grande corpus.

Separadamente, mil textos fictícios viraram mil vetores ONNX e foram indexados em pgvector: 32/32 consultas recuperaram o próprio item; p95 0,076 s, aproximadamente 6,61 s para embeddings/carga/consultas dessa prova. É ensaio direto de storage/embedding, **não ingestão semântica nativa de mil documentos** ou benchmark de relevância com distratores difíceis.

Host: 12 CPUs lógicas; Docker informou 12 CPUs e 8.286.515.200 bytes de memória disponíveis. O Neo4j do helper é limitado a 1 CPU/1 GiB. Esses recursos não foram dimensionados para uma empresa grande nem medidos como custo operacional em moeda.

## V3 — Equipe executada e limites do resultado

Caso: explicar queda de receita, distinguir fatos/hipóteses e propor ação revisável. CoS real propôs A3, três capacidades (`sales_analysis`, `marketing_analysis`, `finance_review`), motivo e teto de cinco unidades sintéticas. TypeScript validou identidade/catálogo/orçamento/plano. LangGraph despachou os especialistas, reuniu três evidências, sintetizou e persistiu checkpoint em aprovação. Não houve execução externa ou aprovação humana fictícia.

Na segunda execução a pergunta genérica ao retrieval trouxe `[no-context]` para vendas/marketing. Os especialistas se abstiveram e a síntese ficou sem fatos. A causa foi inspecionada nos prompts reais e corrigida com perguntas por capacidade; agora falta de contexto requerido interrompe a etapa. O FAIL anterior foi preservado, sem atribuí-lo a impossibilidade do motor.

Na execução final, a equipe acertou receita -20%, leads -20%, preço constante, ausência de causalidade comprovada e fontes. O agente único também acertou. A síntese da equipe marcou `requires_approval=false` para uma proposta de análise interna; o plano validado exigia aprovação e o grafo **continuou parado em `approval`**. Não houve liberação de CRM/email. O teste manteve FAIL de contrato, cinco de seis critérios; essa divergência não é prova de bypass de segurança. A política externa só exige aprovação para ações externas, enquanto o plano deste ensaio foi mais conservador: os metadados apresentados ao usuário precisam derivar da política/plano autoritativos, com semântica explícita.

| Caminho final | Chamadas reais de análise | Tempo | Critérios do contrato |
|---|---:|---:|---:|
| Analista único com todos os fatos autorizados no input | 1 | 6,19 s | 6/6 |
| CoS/controlador + três especialistas + síntese | 5 | 44,74 s | 5/6; backend manteve aprovação |

A comparação inclui mais retrieval e etapas no caminho A3; N=1 por caminho, sem randomização ou teste estatístico. Não isola um efeito puro de arquitetura/modelo, nem prova que uma equipe é sempre pior. **Não demonstrou benefício de qualidade que justificasse escalonar toda tarefa.** O produto continua estruturalmente multiagente, mas seu A4 deve preservar o caminho simples quando suficiente e escalonar por dependências, risco, permissões ou revisão necessários. A0–A4 completo/empresarial não foi implementado neste ensaio.

## V4 — Operação local e caminho econômico

[Controles locais](v4-local.json): 1 teste PASS em 4,16 s, usuário 65534, sem credenciais no ambiente do executor, rede bloqueada, filesystem readonly, sem socket Docker/volume de dados do host; três capacidades expiradas/alteradas/repetidas recusadas. Timeout de três segundos matou contêiner com processo filho; recursos removidos. AES-GCM rejeitou chave errada e recuperou bytes fictícios com a correta. Isso não homologa todo sandbox/MCP nem substitui SSO/TLS/KMS/DR externo.

Há caminho documentado para GPT-6.1 Terra na API com identidade de workload em projeto, independente de compartilhar conta pessoal: [modelo](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [service accounts](https://developers.openai.com/api/docs/guides/api-keys). Não foi criada/testada uma conta comercial nesta rodada. Nenhum segredo real foi lido. A presença de `OPENAI_API_KEY` no ambiente foi verificada como ausente, sem inferir que isso exclua toda credencial gerenciada possível.

As três tentativas V2/V3 fizeram **49 chamadas/49 reservas**, todas com usage capturado: 635.679 tokens de entrada, 458.624 em cache reportado e 9.865 de saída. As 39 unidades de reasoning reportadas estão separadas e não são somadas novamente à saída. Nenhum evento inesperado de ferramenta. Todos os FAIL entram na contabilidade.

Aplicando hipoteticamente os [preços Standard consultados](https://developers.openai.com/api/docs/pricing) aos mesmos tokens, a rodada corresponderia a cerca de USD 0,2493 com cache reportado ou USD 0,6850 sem cache de entrada. **Não são gasto/fatura observados**, nem orçamento comercial do produto. O CLI inclui seu próprio contexto/overhead e não reproduz necessariamente um request direto de API. Infraestrutura, operação, ferramentas, tributos, região e condições contratuais não estão incluídos.

No último caso, o cenário hipotético de A1 foi USD 0,0132; A3 USD 0,0154 com o cache observado ou USD 0,0652 sem cache. A diferença de cache entre caminhos impede usar essa amostra como economia geral. Custo real por entrega empresarial segue pendente, assim como quotas, retenção/região e recuperação física fora do host. Ver [condições e fontes](SOURCES.md).

## Negativos, regressões e decisão de parada

- V2/V3 primeira tentativa: FAIL de event loop Windows, 161,65 s, 13 chamadas; evidência preservada.
- Segunda: FAIL de contexto/qualidade da equipe, 191,18 s, 18 chamadas.
- Terceira: FAIL do contrato de metadados de aprovação, 211,91 s, 18 chamadas; fatos e enforcement melhoraram após adaptação, sem converter resultado em PASS total.
- Quatro testes do grader passaram: IDs canônicos e `:vN.md` equivalentes; fatos ausentes, causalidade inventada e fonte ausente continuam reprovando. A saída anterior incompleta continua FAIL.
- Regressão governada existente PASS em 29,18 s; seis testes de autoridade, 16 Node e strict PASS. Isso não anula os quatro FAIL de continuidade do novo caminho.

**Decisão de investimento:** não começar agora o produto completo presumindo robustez garantida. Investimento técnico adicional só é justificável com escopo restrito: conciliação qualificada das três janelas de `read_commit`, encerramento governado de unknown e contrato de resposta que exponha a política autoritativa. Critério de saída: os casos vermelhos de V1 precisam passar sem perda/duplicação/bypass, e a divergência de política precisa de teste integrado. Em paralelo, a conclusão comercial/DR requer ambiente e medição próprios antes de produção; documentação de fornecedor não satisfaz esse gate.

Não trocar LangGraph ou LightRAG por essas falhas sem demonstrar que o componente impede a correção. Os defeitos encontrados apontam para nossa integração, contratos e recuperação, não para impossibilidade universal das bibliotecas. Os requisitos de instalação dedicada, cérebro central, TypeScript/Python, equipes por capacidades, A0–A4, JARVIS e Obsidian opcional permanecem integrais.
