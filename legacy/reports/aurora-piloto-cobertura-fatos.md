# Cobertura por fato no piloto omnichannel

O Chief registra cada fato como coberto, pendente de busca documental ou dependente de teste de execução. O registro associa fatos cobertos aos IDs dos trechos aceitos, permitindo que um trecho sustente mais de um fato. Apenas lacunas documentais geram consultas complementares. O plano aceita até três consultas em uma única rodada. O verificador de escopo confere os novos candidatos antes da seleção final.

O experimento reaproveitou o acervo e as consultas iniciais dos quatro casos do ensaio anterior. A instrução oferece categorias de investigação para handoffs, como estado do atendimento, tipo de sessão e evento de controle, sem fornecer os identificadores técnicos, as páginas ou a régua de avaliação. A validação do contrato confere a estrutura do registro e os IDs das citações. A avaliação por evidência continua a medir se o trecho exigido foi encontrado.

Para reproduzir, use o mesmo ambiente PowerShell e Python do [ensaio anterior](aurora-piloto-busca-lacunas.md).

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-cobertura-fatos.json --fact-coverage
```

Ruff e os dois testes existentes da busca híbrida passaram.

| Caso | Busca complementar anterior | Registro por fato |
|---|---:|---:|
| Handoff original | 2/3 | 1/3 |
| Handoff reformulado | 1/3 | 2/3 |
| CSV do laboratório azul | 2/2 | 2/2 |
| Limite sem resposta no acervo | 0 trechos aceitos | 0 trechos aceitos |

No reformulado, a consulta sobre o tipo de sessão trouxe o trecho exigido do Contact Center, página 11, linha 26. Ele se somou ao evento de transferência da página 10 do Fluxo de Mensageria. No original, o evento chegou ao conjunto de candidatos da busca complementar, mas o verificador não o selecionou. A garantia contra simultaneidade ficou classificada como dependente de teste de execução.

No CSV, o registro reconheceu a revalidação da versão, mas abriu uma busca redundante pelo aprovador que já constava na linha aceita. A bancada entrega a linha e o cabeçalho como trechos distintos. A hipótese para o próximo ensaio é apresentar os pares coluna e valor juntos e conferir a cobertura de cada fato contra esse contexto.

Nenhum distrator sintético entrou na seleção. As 12 chamadas concluíram sem erro registrado ou evento de ferramenta inesperado. A cobertura total dos dois enunciados do handoff permaneceu em 3/6. Como o registro por fato resolveu um erro e expôs outro, a variante permanece na bancada. Para isolar a causa da rejeição do evento, o próximo teste deve congelar os candidatos e comparar a verificação do evento do fluxo interno com a verificação de uma garantia sobre o comportamento real do canal.

[Registro dos fatos, consultas e trechos](aurora-piloto-cobertura-fatos.json)
