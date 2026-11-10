# Pesquisa e hipóteses

## O que a pesquisa informa, sem substituir teste

**Vigência e conhecimento são eixos diferentes.** A documentação XTDB distingue o instante em que um dado vale no domínio do instante em que ele é incorporado ao sistema, inclusive para auditoria antes de correções posteriores. Usamos essa distinção para formular os cortes de fonte; não executamos ou aprovamos XTDB nesta rodada. Não afirmamos ter implementado um banco bitemporal geral. [Time in XTDB](https://docs.xtdb.com/about/time-in-xtdb.html).

**Retomar/reexecutar um grafo não é recuperar a resposta original.** A documentação LangGraph explica que nós posteriores ao checkpoint podem executar novamente chamadas de modelo e APIs, produzindo resultados diferentes. Por isso, consulta de histórico nesta prova lê o registro persistido; não chama o modelo para reconstruí-lo. Não se implementou um segundo motor de workflow. [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel).

**Corretude e qualidade de citações precisam ser separadas.** O trabalho ALCE distingue a correção da resposta do suporte fornecido pelas citações e trata citações irrelevantes. Consultamos a seção 3.3 e o contexto de avaliação, não afirmamos leitura integral nem reprodução do benchmark. Nossa avaliação é menor: valor esperado, versão/arquivo esperado, presença da fonte na recuperação nativa e inspeção das respostas. Não executamos NLI nem medimos entailment completo frase a frase. [ALCE, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.398/).

**Transporte de inferência.** A skill OpenAI Docs já aplicada na conversa orienta a chamada Codex em modo não interativo, saída estruturada e eventos de uso. Mantivemos o adaptador existente e o modelo autorizado GPT-6.1 Terra, sem mudança de fornecedor ou escalada silenciosa. [Modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode).

## Hipóteses operacionais e falsificação

| Hipótese | O que faz o ensaio reprovar |
|---|---|
| A versão aprovada é selecionada pelo corte solicitado | Manifesto aponta versão diferente do oráculo temporal |
| A projeção nativa usa somente o snapshot selecionado | Contexto contém arquivo de outra versão ou falta a fonte esperada |
| O modelo responde sobre a vigência correta | Valor esperado não aparece; respostas também são inspecionadas |
| A referência corresponde à versão correta | Citação/arquivo esperados ausentes |
| Retificação não modifica assessoramento já registrado | Envelope/JSON/hash original muda, ou consulta chama o modelo novamente |
| Ausência de fonte aprovada exige abstenção | Há inferência ou resposta afirmativa sem fonte no corte |
| Acesso histórico respeita permissão atual | Ex-proprietário de acesso confidencial recupera registro após revogação |
| Papel SQL da rotina de gravação não altera registros | UPDATE/DELETE são executados com sucesso |

Expectativas foram codificadas antes da chamada inicial. O teste não fornece ao modelo a resposta esperada nem usa um segundo LLM para aprovar a saída. Ele fornece o documento aprovado, a pergunta e as datas solicitadas.

## Interpretação permitida

Uma aprovação sustenta somente o caminho integrado pequeno. O mesmo Terra que errou um atributo no ensaio Graphiti pode acertar uma resposta baseada no snapshot canônico: tarefas, contextos e contratos são diferentes. Isso não prova que a arquitetura atual é superior a todas as alternativas, que o modelo é confiável em geral ou que Graphiti é inviável universalmente.

Não houve comparação controlada de arquiteturas, repetição estatística, corpus empresarial representativo, seeds ou avaliação de todos os enunciados gerados. Para a próxima avaliação, são necessários casos independentes de perguntas, tabelas, múltiplas fontes, conflitos, exclusões e intervalos de validade, com oráculos revisados e métricas separadas por componente. Os gates de produto/produção continuam abertos.
