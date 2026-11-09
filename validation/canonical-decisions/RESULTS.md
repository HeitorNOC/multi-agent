# Resultados — 04/11/2026

**PASS neste recorte integrado; continuar a qualificação, sem aprovação geral de modelo, arquitetura ou produção.**

Um teste E2E passou em 214,39 s no console: sete checkpoints de contrato e cinco casos temporais de resposta. Fontes e perguntas sintéticas, três versões de uma política e uma fonte financeira. GPT-6.1 Terra, extração/keywords/resposta LightRAG nativas, embeddings ONNX reais, PostgreSQL/pgvector, Neo4j e Keycloak reais. Editorial TypeScript preservado; typecheck strict passou.

## Respostas observadas e suas fontes

**february_known_before_correction** — versão esperada 1, 2 dia(s). Todos os checks passaram.

Na data de vigência consultada, **15 de fevereiro de 2026**, a política da ACME permitia **dois dias de trabalho remoto por semana**. Essa regra estava em vigor desde 1º de janeiro de 2026. [1]

### References

* [1] politica-remoto@v1.md

**march_known_before_correction** — versão esperada 2, 3 dia(s). Todos os checks passaram.

Em **15 de março de 2026**, a política da ACME permitia **três dias de trabalho remoto por semana**. Essa regra entrou em vigor em 1º de março de 2026 e substituiu a permissão anterior de dois dias por semana. [1]

### References

* [1] politica-remoto@v2.md

**february_known_after_correction** — versão esperada 3, 1 dia(s). Todos os checks passaram.

Em **15 de fevereiro de 2026**, a política de trabalho remoto da ACME permitia **um dia por semana**. [1]

Essa regra vigorava de 1º de fevereiro até 1º de março de 2026. [1]

### References

* [1] politica-remoto@v3.md

**march_unchanged_after_correction** — versão esperada 2, 3 dia(s). Todos os checks passaram.

Em 15 de março de 2026, a política da ACME permitia **três dias de trabalho remoto por semana**. [1]

Essa regra entrou em vigor em 1º de março de 2026 e substituiu a permissão anterior de dois dias por semana. [1]

### References

* [1] politica-remoto@v2.md

**january_after_correction** — versão esperada 1, 2 dia(s). Todos os checks passaram.

Em 15 de janeiro de 2026, a política da ACME permitia **dois dias de trabalho remoto por semana**. Essa regra estava em vigor desde 1º de janeiro de 2026. [1]

### References

* [1] politica-remoto@v1.md

## Contratos comprovados no ensaio

- A fonte aprovada correta foi selecionada pelo corte de vigência/conhecimento e indexada em projeção isolada por snapshot/configuração. A recuperação nativa não misturou arquivos de versões distintas.
- A retificação mudou a nova resposta sobre fevereiro para um dia, preservando janeiro em dois e março em três. A resposta original de fevereiro, baseada no conhecimento anterior, permaneceu com dois dias e sua fonte v1.
- Leitura do registro e repetição idêntica do pedido retornaram exatamente o mesmo envelope/JSON/hash, sem nova chamada de modelo. Mesmo ID com outra entrada foi negado. Consulta de outro proprietário foi negada.
- Corte sem fonte publicada produziu abstenção antes do modelo. Fonte financeira foi realmente ingerida e respondeu ao autorizado; analista foi negado antes da inferência. Após revogação, o antigo autorizado perdeu acesso ao registro privado; governança com grant atual pôde auditá-lo.
- O papel SQL decision_writer recebeu permission denied para UPDATE e DELETE. O reinício preservou resposta original e revogação, sem inferência para ler o histórico.

São registros de **assessoramento de conhecimento**, não prova de execução de ações empresariais, aprovação de estratégia ou implementação do controlador adaptativo inteiro. A aplicação não permite que o caller escolha owner, workspace ou autoridade de publicação.

## Interpretação da pesquisa e do teste

RESEARCH.md registra os fundamentos consultados e os critérios. A distinção entre vigência, conhecimento e resposta histórica orientou o contrato. Retomar um grafo ou chamar um modelo de novo não foi tratado como leitura histórica.

O grader verifica valor principal, arquivo/citação esperados, presença da fonte nativa, isolamento de versões e ausência de canário. As cinco respostas foram inspecionadas no contexto esperado. Não houve NLI/avaliação completa de cada afirmação, reprodução ALCE ou estimativa estatística de acurácia. Citações com filename correto não são garantia geral de suporte.

O Terra ter passado aqui não desfaz a inconsistência observada no ensaio Graphiti: são tarefas e contextos diferentes. Esta rodada tampouco requalifica o histórico nativo de fatos do Graphiti; o contrato é seleção de fonte canônica e preservação do assessoramento original. Não houve comparação A/B de arquiteturas ou comprovação de superioridade geral.

## Persistência, acesso e limites

O registro inclui pergunta, datas solicitadas, snapshot/versão/hash da fonte, configuração/projeção, resposta e IDs de chamadas de provider. O texto JSON e seu hash são preservados no PostgreSQL. As permissões demonstradas são do papel de escrita; não são WORM ou proteção contra DBA/owner privilegiado capaz de alterar dados e hashes ou restaurar um backup antigo.

A camada canônica editorial ainda usa SQLite local nesta bancada; registros e índices usam PostgreSQL/Neo4j. Não houve backup conjunto, PITR, migração ou desastre de chaves do novo conjunto. O relógio/precisão do ledger de publicação não constitui uma transação bitemporal geral. A seleção assume marcos de substituição de uma fonte, não intervalos arbitrários, exclusões ou resolução de conflitos entre múltiplas fontes.

Publicação canônica e prontidão do índice são estados diferentes. Indexação lazy só libera consulta após processed/ready; projeções ou admissões interrompidas ficam bloqueadas para conciliação explícita. Essa recuperação de crash não foi ensaiada agora. O teste usa um processo/lock de aplicação, não qualifica múltiplos writers ou concorrência distribuída.

Identidades são contas de serviço sintéticas; sem homologação de SSO humano, TLS, cofre, MCP/gateway empresarial ou isolamento de clientes concorrentes. Obsidian segue opcional e sua UI não foi testada. Corpus representativo, custo financeiro, carga empresarial, equipes dinâmicas, Chief of Staff, Adaptive Controller e JARVIS completos permanecem necessários. LangGraph continua o único candidato a owner de workflow; não foi criado outro motor nem feito novo ensaio do workflow nesta rodada.

## Uso observado e decisão

16 chamadas ao GPT-6.1 Terra, uso {"input_tokens": 204215, "cached_input_tokens": 147072, "output_tokens": 1845, "reasoning_output_tokens": 0}. Dinheiro não medido: não há fatura/debito atribuível retornado pelo CLI. Embeddings: 36 vetores calculados incluindo consultas/repetições, 0 entradas truncadas. Isso não mede custo mensal, TCO, escala ou custo por tarefa empresarial.

Não houve falha inesperada ou repetição para selecionar uma resposta melhor nesta execução. Os controles negativos foram recusados conforme esperado e estão preservados. Cleanup e inventário independente documentam remoção dos recursos próprios.

**Há evidência para avançar com este contrato de fonte e histórico no protótipo. Ainda não há base para aprovar modelo/arquitetura em geral ou produção.** O próximo ensaio deve ampliar corpus e casos independentes, comparar configurações de recuperação/modelos com os mesmos oráculos e testar recuperação/concor­rência do conjunto antes de aumentar autonomia.
