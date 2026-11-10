# Busca por fato no handoff omnichannel

No ensaio integrado anterior, as evidências ausentes já estavam fora dos candidatos apresentados ao verificador. No enunciado original faltava a mudança de tipo de sessão na abertura do atendimento digital. No reformulado faltava o estado que comprova que o operador assumiu. As consultas complementares juntavam assuntos ou perguntavam por uma condição genérica de transferência.

Nesta rodada, o modo de bancada usa três perguntas fixas para a família de handoff. Elas separam o estado de atendimento, a mudança de tipo de sessão ao abrir o atendimento digital e o evento de troca de controle. As perguntas foram escritas para este cenário e omitem os nomes técnicos esperados. Cada pergunta recebe até oito candidatos antes da união. O artefato registra a cobertura por consulta antes e depois da verificação. Os outros casos continuam usando o planejamento semântico a partir do enunciado.

O terceiro enunciado é novo. Ele testa se a verificação mantém as evidências com outra formulação dentro do mesmo cenário. O piloto seleciona a família de consultas pelo identificador do caso, de modo que esta rodada mede a busca e a verificação após a classificação. A escolha automática da família de consultas precisa de uma avaliação própria.

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-handoff-focalizado.json --integrated --focused-handoff
```

Use o mesmo ambiente do [ensaio integrado anterior](aurora-piloto-integrado-fatos.md). O Ruff e os dois testes existentes da busca híbrida passaram.

Os três enunciados chegaram a 3/3 antes da busca complementar. O limite global de seis candidatos teria deixado de fora a evidência sobre tipo de sessão. A lista por fato colocou as três evidências no conjunto apresentado ao verificador, que aceitou o estado ativo do Contact Center na p. 9, a mudança de sessão do Contact Center na p. 11 e o evento do Fluxo de Mensageria na p. 10.

A busca complementar ainda rodou nos três enunciados, apesar da cobertura da régua, e não aumentou essa cobertura. No CSV preenchido, o Chief dispensou a busca. No CSV com campo vazio, pesquisou o aprovador e manteve a lacuna. A pergunta sem resposta terminou sem citação, e nenhum distrator monitorado entrou na seleção. Foram 20 chamadas, sem eventos de ferramenta inesperados.

O teste cobre uma execução por enunciado. A concorrência e a reentrega dependem do código ou do ambiente de teste do handler de mensageria.

[Resultados por fato, com trechos e páginas](aurora-piloto-handoff-focalizado.json)
