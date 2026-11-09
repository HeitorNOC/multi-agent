# Reexecução com candidatos fixos

O ensaio recompôs os 26 candidatos da busca complementar do handoff original e conferiu a sequência de fontes, páginas e linhas com o registro anterior. As três chamadas de verificação receberam a mesma lista, na mesma ordem.

| Consulta | Resultado |
|---|---|
| Tarefa original e as mesmas três subquestões | Aceitou o evento do Fluxo de Mensageria, p. 10, linha 15, e a passagem sobre sessão da p. 12, linha 30. A rodada anterior havia descartado o evento com essa mesma entrada recomposta. |
| Qual é o registro interno da troca de controle? | Aceitou a passagem da p. 10, linha 15. |
| Que passagem comprova que as respostas simultâneas são impedidas? | Nenhuma passagem aceita. |

A rejeição anterior do evento não se repetiu. O teste mostra variação entre duas execuções com a mesma consulta e candidatos. As consultas isoladas ilustram a diferença entre a evidência de que o fluxo registra o evento e a evidência de uma garantia de execução. Uma chamada por formulação não permite estimar a taxa de acerto. A passagem da p. 12 também não satisfaz o critério da régua que exige o vínculo explícito com a abertura do atendimento digital.

No controle CSV, foi usada a mesma linha sintética, com e sem os nomes das colunas junto aos valores. Na forma original, o planejador solicitou novamente o aprovador. Com os pares coluna e valor, reconheceu os dois fatos com a mesma citação e não solicitou nova busca. O teste cobre uma linha sintética convertida em texto. A extensão a arquivos e tabelas variados ainda precisa de validação.

O script passou no Ruff. Com o mesmo ambiente descrito no [ensaio anterior](aurora-piloto-cobertura-fatos.md), execute:

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-replay-escopo.json --replay
```

[Resultados das cinco chamadas](aurora-piloto-replay-escopo.json)

## Repetições e variações de CSV

O ensaio com `--replay --repeats 3` repetiu as três perguntas sobre o handoff com os mesmos 26 candidatos e executou seis controles de CSV.

| Pergunta | Resultado nas três repetições |
|---|---|
| Enunciado original | Citou o evento em 2/3. Uma execução também citou a mudança de tipo de sessão na p. 12, que deixa em aberto o vínculo com a abertura do atendimento digital. |
| Registro interno da troca de controle | Citou o Fluxo de Mensageria, p. 10, linha 15, em 3/3. |
| Garantia contra respostas simultâneas | Nenhuma citação em 3/3. |

Com o nome de cada coluna junto ao valor, o Chief dispensou a busca pelo aprovador nas duas linhas preenchidas, incluindo a linha com colunas reordenadas e um ponto e vírgula dentro de um campo entre aspas. Na linha com aprovador vazio, manteve a busca complementar. Nas três versões sem nomes de coluna junto aos valores, solicitou uma busca pelo aprovador.

São três repetições por formulação e uma execução por representação de cada controle sintético. O teste mede a seleção com candidatos fixos. A garantia contra respostas simultâneas segue pendente de um teste no pipeline.

[Resultados das 15 chamadas](aurora-piloto-estabilidade.json)
