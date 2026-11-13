# Ensaio integrado de verificação por fato

O modo `--integrated` inicia pela pergunta original. Ele gera consultas novas, recupera trechos no acervo misto, verifica cada subquestão, registra lacunas por fato e executa no máximo uma busca complementar. A saída inclui os trechos aceitos com fonte, página e linha. Os distratores concorrem no índice junto às demais fontes.

Os CSVs apresentam os nomes das colunas junto aos valores durante o reranqueamento e a verificação. O controle preenchido usa o laboratório azul. O controle com campo de aprovador vazio usa o laboratório violeta, com colunas reordenadas e um campo entre aspas que contém ponto e vírgula. A recuperação inicial ainda indexa o texto original. A variante foi integrada ao executável de validação do piloto.

Com o ambiente descrito no [ensaio anterior](aurora-piloto-busca-lacunas.md), execute o comando:

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-integrado-fatos.json --integrated
```

O Ruff e os dois testes existentes da busca híbrida passaram.

| Caso | Evidências antes da busca complementar | Evidências finais | Busca complementar |
|---|---:|---:|---|
| Handoff original | 0/3 | 2/3 | Recuperou o estado do atendimento e o evento de transferência. |
| Handoff reformulado | 1/3 | 2/3 | Recuperou a passagem que vincula o tipo de sessão à abertura do atendimento digital. |
| CSV com aprovador | 2/2 | 2/2 | Dispensada. |
| CSV com aprovador vazio | 1/1 | 1/1 | Procurou o aprovador e deixou a lacuna aberta. |
| Limite de chamadas sem resposta no acervo | 0 trechos aceitos | 0 trechos aceitos | Executada, com abstenção. |

No enunciado original faltou o trecho que vincula a mudança de sessão à abertura do atendimento digital. No reformulado faltou o trecho que comprova o estado ativo. Os dois resultados ficaram abaixo da meta de 3/3 por enunciado. A execução envolveu 19 chamadas, sem eventos de ferramenta inesperados. Nenhum dos distratores monitorados entrou na seleção final.

[Resultados e trechos aceitos](aurora-piloto-integrado-fatos.json)

O teste de concorrência no pipeline de mensageria ficou pendente. A busca por implementações dos eventos e operações documentados no workspace do Aurora e em `D:/Workspace` encontrou os controles do piloto, mas nenhum handler executável do canal para esse cenário. O teste precisa disparar duas tentativas de resposta concorrentes, atravessar a troca de controle e reentregar o mesmo evento. A evidência de aprovação é a saída do canal e o histórico persistido, com uma única resposta autorizada e sem novo efeito na reentrega.
