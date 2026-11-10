# Regressão da bancada omnichannel

O ensaio executa os oito casos com roteamento pelo enunciado, busca por fato e diagnóstico de planos complementares. As regras de aceite foram definidas antes de examinar o resultado desta rodada.

| Caso | Critério de aceite |
|---|---|
| Três enunciados de handoff | Rota de handoff, 3/3 evidências com página na primeira verificação e nenhuma busca complementar. |
| Limite de chamadas | Rota geral, parecer sem citação e desfecho explícito da rodada complementar sem rejeição do plano. |
| CSV com aprovador | Rota geral, 2/2 fatos e nenhuma busca complementar. |
| CSV com campo vazio | Rota geral, evidência sobre revalidação e busca pelo aprovador, com a lacuna preservada. |
| Auditoria | Rota geral e 2/2 evidências. |
| Implantação | Rota geral e 2/2 evidências, incluindo teste restrito e liberação geral. |

Em todos os casos, os distratores monitorados devem ficar fora da seleção final. Qualquer erro de planejamento, verificação ou busca é registrado no resultado. A documentação do handoff deve continuar distinguindo as evidências citadas da garantia de execução.

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-regressao-final.json --integrated --auto-route
```

Use o ambiente do [ensaio integrado](aurora-piloto-integrado-fatos.md). O Ruff e os dois testes existentes da busca híbrida passaram.

Os oito casos cumpriram seus critérios. Os três handoffs tiveram 3/3 antes da busca complementar e encerraram com `no_search_needed`. O original registrou a garantia contra simultaneidade como dependente de execução. A auditoria e a implantação terminaram em 2/2. A implantação recuperou a orientação sobre teste restrito na rodada complementar.

O CSV preenchido teve 2/2 sem busca complementar. No CSV vazio, o Chief procurou o aprovador e deixou a lacuna explícita. O limite de chamadas registrou `searched`, com plano válido e parecer sem citação. Nenhum distrator monitorado foi aceito, e os oito casos terminaram sem erro registrado.

A rodada executou uma vez cada caso no utilitário de bancada. A validação da rota e das citações pela API do Aurora e o teste de concorrência e reentrega no handler do canal continuam pendentes.

[Resultados da execução](aurora-piloto-regressao-final.json)
