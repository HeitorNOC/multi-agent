# Busca complementar no contexto da citação

Na rodada de roteamento anterior, a busca sobre a implantação do assistente encontrou a liberação geral no Resumo do MBA, página 4, linha 11. A orientação sobre o grupo restrito está na linha 10 da mesma página e ficou fora da lista entregue ao verificador.

Quando há uma lacuna documental, o piloto pode levar até oito trechos de linhas vizinhas a uma citação já aceita, na mesma fonte e página. Os demais candidatos vêm da busca lexical e vetorial. O limite continua em 24 candidatos da busca. Os vizinhos passam pela mesma verificação de escopo e relevância antes de poderem virar citações. A seleção do contexto local independe da régua.

No planejamento geral, a repetição da pergunta original agora é tratada como pedido de busca direta. Subquestões distintas continuam sendo validadas pelo contrato. Um teste com resposta controlada conferiu os casos de repetição, subquestão distinta e valor inválido. A rodada anterior registrou apenas a classe do erro na pergunta sobre limite, de modo que a saída original do planejador não pode ser inspecionada.

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-contexto-local.json --integrated --auto-route
```

Use o ambiente do [ensaio integrado](aurora-piloto-integrado-fatos.md). O Ruff passou.

A implantação passou de 1/2 para 2/2. A verificação aceitou a orientação sobre testar com um grupo restrito da linha 10 e preservou a orientação sobre liberação geral da linha 11. Os três handoffs mantiveram 3/3 sem busca complementar. A auditoria e os dois controles de CSV preservaram seus resultados. Nenhum distrator monitorado foi citado.

A pergunta sobre limite teve plano inicial válido e terminou sem citação. O contrato rejeitou a saída do planejador da busca complementar com `ValueError`. A rodada registra a etapa e a classe do erro, mas a resposta bruta não foi retida e a causa específica segue aberta. As 26 chamadas concluíram sem eventos de ferramenta inesperados.

O teste é de bancada, com uma execução por caso. A concorrência e a reentrega continuam pendentes do handler do canal.

[Consultas, páginas e decisões](aurora-piloto-contexto-local.json)

## Reteste isolado do limite

O validador agora registra a etapa, um código específico de erro e o desfecho da busca complementar. Uma consulta válida que repete a pergunta original ou uma consulta já executada é descartada como repetição. JSON inválido, citações desconhecidas e registros de fato incompatíveis continuam sendo rejeitados.

No reteste com `--integrated --auto-route --case limit`, o planejador propôs uma consulta distinta. A busca complementar rodou, terminou sem erro e não aceitou nenhum trecho. O erro anterior não se reproduziu. Sete verificações controladas confirmaram o desfecho sem busca para uma repetição e os códigos de rejeição para entradas inválidas.

[Registro do reteste isolado](aurora-piloto-limite-diagnostico.json)
