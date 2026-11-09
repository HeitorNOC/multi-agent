# Planejamento semântico e seleção de fontes no piloto omnichannel

O planejador recebeu apenas o enunciado e pôde devolver até três subquestões. O Codex não recebeu a régua, os trechos, os títulos ou as subquestões manuais do ensaio anterior. Embeddings, consulta lexical, reranqueamento e conferência da régua rodaram localmente.

Foram comparadas três variantes com limite de seis trechos. A direta consulta a pergunta integral. A semântica usa listas separadas por subquestão. A terceira conserva os candidatos de até três títulos mais próximos por subquestão, além dos quatro primeiros candidatos gerais. Essa terceira variante mede o efeito de reduzir o conjunto de candidatos com metadados escassos.

Ao acervo misto anterior foram acrescentados três controles sintéticos, com uma tabela Markdown sobre um emulador de Webchat, uma linha CSV útil de um ensaio de continuidade e uma anotação informal sobre outro laboratório. Esses controles entram como texto UTF-8, com suas estruturas textuais preservadas. Os recortes reais ainda usam o extrator específico do piloto, que pressupõe um cabeçalho e um rodapé de uma linha. O ensaio mede recuperação sobre entradas heterogêneas já convertidas em texto. OCR, extração de tabelas complexas e ingestão de formatos nativos exigem validação própria.

```powershell
$env:TMP = (Resolve-Path 'apps/aurora/.cache').Path
$env:TEMP = $env:TMP
$env:PYTHONPATH = "$PWD;$(Resolve-Path 'apps/aurora/.venv/Lib/site-packages')"
$python = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python validation/.tools/aurora-piloto-handoff/compare_semantic_plan.py reports/aurora-piloto-plano-semantico.json
```

O script passou pelo Ruff e pela compilação sintática.

## Primeira rodada

O acervo de 13 fontes produziu 383 trechos. O planejador completou oito chamadas. Nas seis perguntas com resposta, a busca direta selecionou 4/11 evidências, a semântica 5/11 e a semântica com seleção de títulos 3/11. As perguntas completas foram 2/6, 3/6 e 2/6, respectivamente. Os dois casos sem resposta avaliam apenas a recuperação, pois este script não gera parecer.

Em rastreabilidade de mensagens, a decomposição encontrou as duas evidências exigidas. A restrição por título removeu ambas do conjunto de candidatos. No handoff reformulado, o planejador tratou o pedido como uma consulta simples. No original, dividiu o pedido, mas formulou duas consultas em torno da garantia de impedir simultaneidade. Os três modos ficaram em 0/3 nos dois enunciados.

Os três modos recuperaram os dois dados da linha CSV útil. A nota informal sobre outro laboratório ainda apareceu entre os seis candidatos. Esse resultado separa a capacidade de encontrar o dado da capacidade de rejeitar um trecho parecido durante a verificação.

[Registros da primeira rodada](aurora-piloto-plano-semantico.json)

## Segunda rodada com uma consulta por fato observável

```powershell
& $python validation/.tools/aurora-piloto-handoff/compare_semantic_plan.py reports/aurora-piloto-plano-semantico-observaveis.json --scoped-planner
```

No mesmo acervo, a instrução revisada elevou a busca semântica de 5/11 para 6/11 evidências, com 3/6 perguntas completas. A variante com seleção de títulos chegou a 4/11 e 2/6 completas. A linha CSV útil manteve 2/2 em ambas as rodadas.

Na pergunta reformulada de handoff, a busca semântica encontrou `control_passed` e terminou em 1/3. Na pergunta original, duas evidências entraram nas listas internas e nenhuma chegou aos seis candidatos finais. A segunda consulta juntou estado e evento em uma só pergunta, apesar da instrução. As oito chamadas concluíram sem eventos de ferramenta inesperados.

O resultado permanece abaixo do necessário para integrar o planejador ao perfil consultivo. Títulos podem servir de sinal de relevância, com candidatos da busca ampla preservados. O próximo teste deve verificar o escopo de cada passagem, incluindo canal e ambiente, antes da síntese. Também deve medir cobertura por subquestão, para distinguir uma consulta mal formulada de evidências descartadas no ranqueamento. Esta rodada não mede a qualidade de um parecer integrado nem o comportamento da mensageria sob concorrência.

[Registros da segunda rodada](aurora-piloto-plano-semantico-observaveis.json)
