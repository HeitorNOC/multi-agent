# Três enunciados de handoff pela API do Aurora

O ensaio executa os enunciados original, reformulado e inédito em três sessões descartáveis. Cada sessão usa os mesmos três recortes documentais e os distratores sintéticos. O adaptador de laboratório seleciona a busca por fato a partir dos termos da pergunta. A síntese recebe as subquestões e o diagnóstico local registra códigos, cadeia de exceções e pontos do código quando há falha.

O critério documental exige as três citações da régua no parecer da API. A p. 9 do Contact Center descreve o estado `ACTIVE`, a p. 11 vincula a mudança para `HUMAN` à abertura do atendimento digital, e a p. 10 do Fluxo de Mensageria registra `control_passed`. Para testar a admissão, cada sessão recebe dois pedidos concorrentes e um reenvio com a mesma chave. O resultado esperado é um único ID de trabalho e uma inicialização de worker.

O ensaio usa o mesmo executor e os mesmos parâmetros da [validação anterior pela API](aurora-piloto-api-fatos.md), com `--handoff-runtime-lab` e `--admission-replay`. As duas primeiras sessões executam em paralelo. A terceira começa quando uma delas encerra.

| Enunciado | Evidências conferidas | Tempo até a revisão | Admissão concorrente e reenvio |
|---|---:|---:|---|
| Original | 3/3 | 87,50 s | Um trabalho e um início de worker |
| Reformulado | 3/3 | 66,39 s | Um trabalho e um início de worker |
| Inédito | 3/3 | 74,05 s | Um trabalho e um início de worker |

Os três chegaram a `awaiting_approval` com os trechos conferidos por fonte, página e conteúdo. Nenhuma execução registrou falha. No enunciado original, o parecer deixou explícita a lacuna “sem que ambos respondam ao mesmo tempo”. O ensaio cobre uma execução por enunciado no adaptador de laboratório. A admissão idempotente observada pertence à API do Aurora. A concorrência de envio e a reentrega no WhatsApp dependem de teste no handler do canal.

[Original](aurora-api-handoff-diagnostico-original.json) · [Reformulado](aurora-api-handoff-diagnostico-reformulado.json) · [Inédito](aurora-api-handoff-diagnostico-inedito.json)
