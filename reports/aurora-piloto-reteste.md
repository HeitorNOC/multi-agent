# Reteste do piloto omnichannel com PDFs

## Escopo

A pergunta sobre a transferência do MBA para um atendente foi reexecutada no Aurora com os três recortes reais do ensaio anterior. A rodada mede a consulta e a revisão humana de um parecer. A diretiva executiva completa e a implementação de código ficam fora deste recorte de validação.

## Execução automática

Comando do ensaio, executado com o Python que contém `pdfplumber` e acesso ao Docker local.

```powershell
$env:PYTHONPATH = (Resolve-Path 'apps/aurora/.venv/Lib/site-packages').Path
$python = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python validation/.tools/aurora-piloto-handoff/run_mixed_corpus.py focused --hybrid-auto --output reports/aurora-handoff-focused-reteste.json
```

- A primeira tentativa saiu com código 1 antes de publicar a URL. O diagnóstico independente retornou acesso negado ao socket do Docker Desktop. A reexecução com acesso ao Docker admitiu a tarefa, gravou o resultado e encerrou a sessão temporária.
- O Chief escolheu Tecnologia e Atendimento. O plano designou tech lead, engenharia backend e suporte. No perfil consultivo, o plano do Chief inclui os especialistas. A execução valida a seleção da equipe, com autonomia dos diretores ainda pendente nesse perfil.
- A tarefa chegou a `awaiting_approval` em 46,84 s, com sete chamadas de modelo e 41 eventos. O parecer foi `insufficient_evidence`, com zero citações. A seleção recuperou seis trechos de três fontes, porém deixou de fora os trechos de referência para `ACTIVE`, `HUMAN` e `control_passed`.
- Os 89.129 tokens de entrada e 1.046 de saída são contadores da bancada. O valor faturado ficou sem medição.

[Evidência da execução automática](aurora-handoff-focused-reteste.json)

## Controle assistido

A mesma pergunta foi reexecutada com `run.execute(output=...)` e `--hybrid`. Esse modo usa seis facetas manuais com termos conhecidos dos PDFs. A rodada chegou a `awaiting_approval` em 76,95 s e retornou `partial_evidence`, com quatro citações. O Contact Center forneceu `WAITING` e `ACTIVE` na página 9. O Fluxo de Mensageria forneceu `control_passed` na página 10 e a mudança `ML_MODEL`/`HUMAN` na página 12.

A lacuna preservada no parecer foi “sem que ambos respondam ao mesmo tempo”. Os trechos sustentam a descrição dos estados e da troca de controle. A garantia contra respostas concorrentes exige um critério técnico verificável, com um ensaio de envio simultâneo e reentrega de eventos no sistema que efetivamente aplicará o controle.

[Evidência da execução assistida](aurora-handoff-assistido-reteste.json)

## Experimento local com acervo misto

O teste comparou 20 perguntas já registradas, usando 377 trechos de sete recortes reais e três documentos sintéticos. O ranking roda no host com o serviço de embeddings em loopback e o reranqueador local fixado. As perguntas sem resposta medem apenas a presença de candidatos nesta bancada. A abstenção da síntese exige outra execução integrada.

```powershell
$env:TMP = (Resolve-Path 'apps/aurora/.cache').Path
$env:TEMP = $env:TMP
$env:PYTHONPATH = "$PWD;$(Resolve-Path 'apps/aurora/.venv/Lib/site-packages')"
& $python validation/.tools/aurora-piloto-handoff/compare_page_retrieval.py reports/aurora-piloto-expansao-paginas.json
```

O script ajustou a pontuação para lotes de até 72 candidatos e excluiu textos sem página apenas da expansão por vizinhança. Esses textos continuaram elegíveis pelos canais lexical e vetorial.

| Modo | Evidências nas 10 perguntas positivas | Perguntas completas | Críticas completas | Handoff reformulado | Reranking do handoff |
|---|---:|---:|---:|---:|---:|
| Vetorial | 11/16 | 6/10 | 1/4 | 0/3 | 410 ms |
| União de vetorial e BM25 | 11/16 | 6/10 | 1/4 | 0/3 | 671 ms |
| União e páginas vizinhas | 10/16 | 6/10 | 1/4 | 0/3 | 2.223 ms |
| Páginas vizinhas, ranking por cláusula | 11/16 | 7/10 | 2/4 | 0/3 | 2.324 ms |

No handoff reformulado, `control_passed` entrou no conjunto inicial dos quatro modos, mas saiu da seleção final. Os trechos de referência para `ACTIVE` e `HUMAN` ficaram fora do conjunto inicial. A expansão por páginas custa mais tempo e permanece abaixo dos critérios de 9/10 perguntas, ao menos 90% das evidências e cobertura de todas as críticas. O código do produto continua com a recuperação atual.

[Evidência do benchmark local](aurora-piloto-expansao-paginas.json)

## Decisão

O piloto permanece aberto. A seleção da equipe e a revisão humana funcionaram no caso avaliado. A próxima rodada deve testar recuperação por subquestão e reserva de evidências distintas para estados, evento de transferência e controles de concorrência, com a lista de nomes técnicos oculta da entrada do agente. A avaliação precisa medir também se cada afirmação está ligada à página correta e se o parecer distingue o comportamento documentado de uma garantia que depende de teste de execução. A simulação empresarial envolvendo várias diretorias vem após esse aceite.
