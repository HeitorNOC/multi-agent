# Leitura dos resultados e limites

As 12 respostas completas foram inspecionadas após o teste. Nos três grupos, alimentação Aurora foi R$240, prazo 18h30 do dia útil seguinte, revisão por duas pessoas distintas e hotel permaneceu sem valor definido. Não se observou troca pelas regras Boreal/R$190/três revisores ou pelo horário 17h. Isso complementa o grader lexical; não é avaliação independente de entailment por todas as afirmações nem estimativa estatística.

Os quatro pares de prompts Terra/Sol tiveram hashes exatos iguais, verificados pelo finalizador. Nenhuma evidência aqui exige subir para Sol: ele não apresentou melhoria observável nesses quatro casos. Isso não prova equivalência geral nem menor custo financeiro de um modelo.

Mix fez duas invocações por pergunta (keywords e resposta), naive uma; a primeira mix incluiu outras cinco de ingestão. Sol repetiu quatro gerações. Duas gerações adicionais alimentaram os testes de recibo. Total: 19 Terra + 4 Sol = 23, sem repetição silenciosa. O modo naive merece o próximo teste de múltiplas fontes; não foi demonstrado que elimina a necessidade de grafo para todas as tarefas do cérebro. A extração do índice continuou sendo a mesma em ambos os modos.

O PASS_CONTRACTS inclui exigir 503 onde não havia recibo: demonstra bloqueio conservador, não disponibilidade/recuperação completa. O conteúdo e hash preservados no recibo permitem uma retomada localizada; não há transação entre provedor, SQLite editorial, PostgreSQL e Neo4j. Os testes anteriores de restore não são automaticamente transferidos para o novo conjunto.

O teste de revogação foi feito antes da conciliação, não em todos os instantes possíveis entre checks e commits. Desabilitação de principal durante inferência, propagação/revogação entre réplicas e revogação atômica com commit continuam sem homologação. Ainda não há fence/lease distribuído ou contador transacional de chamadas; a concorrência observada usa um único processo.

Na bancada, após demonstrar a recusa da conciliação revogada, o harness restaurou explicitamente o grant do analista por SQL privilegiado para isolar o cenário seguinte (admissão sem recibo). Isso é preparação de fixture, não um mecanismo público para contornar revogação. Não foi promovido o recibo revogado.

Decisão: GO para continuar a qualificação do protótipo; NO-GO para produção no estado atual. O NO-GO não declara impossível a arquitetura nem aprova seus componentes por antecipação. A próxima rodada deve priorizar a pendência sem recibo e a recuperação conjunta antes de atribuir prontidão operacional.
