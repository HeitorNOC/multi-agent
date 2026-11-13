# Reserva de evidências por subquestão no piloto omnichannel

A bancada mantém o limite de seis trechos. Cada subquestão tem sua própria lista ranqueada, e a seleção alterna entre as listas, eliminando duplicatas. Foram comparadas duas formas de montar a lista inicial. Uma usa a união dos candidatos vetoriais e BM25. A outra pontua todos os trechos e serve como controle para distinguir falhas de seleção inicial de falhas do reranqueador.

O teste usa o mesmo acervo misto do reteste, com sete recortes de PDFs e três textos sintéticos. Na modalidade automática, as subquestões vêm de separação sintática da pergunta original. Nos dois enunciados de handoff, um controle adicional usa perguntas conceituais que formulei manualmente sobre status de atendimento, tipo da sessão e evento de transferência. As perguntas omitem os identificadores de referência. Esse controle mede o efeito de uma decomposição específica e não demonstra que o Chief a geraria sozinho.

## Reprodução

```powershell
$env:TMP = (Resolve-Path 'apps/aurora/.cache').Path
$env:TEMP = $env:TMP
$env:PYTHONPATH = "$PWD;$(Resolve-Path 'apps/aurora/.venv/Lib/site-packages')"
$python = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python validation/.tools/aurora-piloto-handoff/compare_evidence_slots.py reports/aurora-piloto-reserva-evidencias.json
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest -q validation/aurora-local-restart/test_pilot_hybrid.py -o asyncio_default_fixture_loop_scope=function
```

A bancada precisou de acesso ao serviço local de embeddings em loopback. O Python do runtime Aurora não tinha `pytest`. A suíte passou com o ambiente de validação existente e diretório temporário dentro do workspace. Resultado de regressão: 2 testes passaram.

## Resultados

| Modo automático | Evidências nas 10 perguntas positivas | Perguntas completas | Críticas completas | Handoff original e reformulado |
|---|---:|---:|---:|---:|
| Lista curta por subquestão | 12/16 | 7/10 | 2/4 | 0/3 em cada |
| Varredura por subquestão | 11/16 | 7/10 | 2/4 | 0/3 em cada |

Nos dois enunciados de handoff, o separador sintático deixou a pergunta inteira como consulta única. A varredura continha todas as evidências de referência, mas nenhuma chegou aos seis selecionados. Com as três subquestões manuais, a lista curta colocou os três conceitos nas primeiras três posições, com a mesma seleção nas duas formulações.

| Conceito | Evidência selecionada | Página |
|---|---|---|
| Atendimento assumido | Estado `ACTIVE` indica que um atendente iniciou o atendimento | Contact Center, 9 |
| Tipo da sessão | O handoff muda o tipo da sessão entre `ML_MODEL` e `HUMAN` | Fluxo de Mensageria, 12 |
| Evento de troca | `control_passed` é convertido em evento interno com origem `MESSAGING_HANDOVER` | Fluxo de Mensageria, 10 |

A régua fixa marcou 2/3 porque exige, para o tipo de sessão, o trecho do Contact Center que vincula a mudança à abertura do atendimento digital. A passagem alternativa do Fluxo foi conferida com o parecer integrado anterior e comprova a mudança de tipo no handoff. Ela não demonstra o gatilho específico exigido pela régua. O resultado de 2/3 foi preservado.

A lista curta assistida levou entre 1,92 e 1,98 s para recuperar e ranquear os trechos. A varredura assistida levou entre 15,71 e 15,92 s e manteve a mesma cobertura. A variante fica na bancada. O gate geral exige 9/10 perguntas completas, ao menos 90% das evidências e todas as perguntas críticas completas.

O próximo ensaio precisa gerar as subquestões semanticamente a partir da tarefa, sem acesso à régua nem às subquestões manuais. As saídas devem passar pela mesma régua e por uma validação integrada de citações. A bancada mediu recuperação, e a prevenção de respostas concorrentes continua pendente de execução no pipeline de mensageria.

[Resultados por caso, consultas, páginas e tempos](aurora-piloto-reserva-evidencias.json)
