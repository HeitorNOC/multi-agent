# Roteamento do handoff pelo enunciado

O modo de bancada `--auto-route` envia ao classificador somente o texto da tarefa. O classificador escolhe a rota de transferência para atendimento humano ou a rota geral. A rota de transferência usa a busca com espaço reservado para cada fato. A rota geral pode formular até três subquestões. A régua, os identificadores dos casos e os trechos esperados ficam fora da decisão de rota.

O ensaio repete os três enunciados de handoff duas vezes. Os controles de limite, CSV preenchido e CSV vazio executam uma vez. Auditoria e implantação do assistente entram como controles de rota próximos ao tema. A verificação de lacunas também recebeu uma instrução para dispensar buscas que só confirmariam fatos já sustentados.

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-roteamento.json --integrated --auto-route --repeats 2
```

Use o ambiente do [ensaio integrado](aurora-piloto-integrado-fatos.md). O Ruff e os dois testes de regressão da busca híbrida passaram.

Nas seis execuções de handoff, a classificação pelo texto escolheu a rota esperada e a primeira verificação aceitou as três evidências. A revisão de cobertura dispensou a busca complementar nas seis. Nas duas execuções do enunciado original, ela registrou a garantia contra respostas simultâneas como pendência de teste.

Os cinco controles seguiram a rota geral. No CSV preenchido, o Chief recuperou 2/2 fatos e dispensou a busca. Com o aprovador vazio, recuperou a revalidação da fila e manteve a lacuna após pesquisar. A auditoria recuperou 2/2. A implantação recuperou 1/2. A resposta do planejador de limite foi rejeitada pelo contrato, e o fallback para a pergunta original terminou sem citação após a rodada complementar.

Nenhum distrator monitorado foi citado. As 36 chamadas terminaram sem eventos de ferramenta inesperados. O teste cobre três enunciados com duas execuções cada e cinco controles. A variante está na bancada. O teste de concorrência e reentrega segue dependente do handler do canal.

[Registros por execução](aurora-piloto-roteamento.json)
