# Busca complementar por lacunas no piloto omnichannel

O ensaio preserva o manifesto de 13 fontes e as consultas iniciais da rodada semântica. Após a primeira verificação, um planejador recebe a tarefa, as consultas já feitas e os trechos aceitos. Ele pode propor até três consultas novas, ou encerrar se a resposta já estiver coberta ou depender apenas de um teste de execução. Consultas repetidas são descartadas. A busca complementar roda uma única vez. Os trechos novos passam pela mesma verificação de escopo antes de se juntarem às citações já aceitas.

Os quatro casos incluem o handoff original, a versão reformulada, uma pergunta sem resposta no acervo e um CSV útil acompanhado de uma nota de outro ambiente. As fontes adicionais permanecem locais. O Codex recebe apenas trechos dos três PDFs já usados no piloto e dos controles sintéticos. A régua fica fora das chamadas.

## Reprodução

```powershell
$env:TMP = (Resolve-Path 'apps/aurora/.cache').Path
$env:TEMP = $env:TMP
$env:PYTHONPATH = "$PWD;$(Resolve-Path 'apps/aurora/.venv/Lib/site-packages')"
$python = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-busca-lacunas.json --retry-gaps
```

O script passou no Ruff e na compilação sintática. Os dois testes existentes da busca híbrida também passaram.

## Resultado

| Caso | Antes da busca complementar | Depois | Tempo adicional |
|---|---:|---:|---:|
| Handoff original | 1/3 | 2/3 | 8,88 s |
| Handoff reformulado | 1/3 | 1/3 | 12,60 s |
| CSV do laboratório azul | 2/2 | 2/2 | 10,56 s |
| Limite de chamadas sem resposta | 0 trechos aceitos | 0 trechos aceitos | 9,40 s |

No handoff original, o planejador pediu o evento que comprova a transferência. A busca encontrou `control_passed` no Fluxo de Mensageria, página 10, e preservou `ACTIVE` do Contact Center, página 9. A transição do tipo de sessão exigida pela régua ficou descoberta nesse enunciado. No reformulado, a busca acrescentou o trecho do Fluxo, página 12, que descreve a mudança `ML_MODEL`/`HUMAN`. A régua exige o trecho do Contact Center que vincula a transição à abertura do atendimento digital. O resultado fixo permanece 1/3 nesse caso.

Nenhum distrator sintético foi aceito. A rodada adicional não inventou uma resposta para o limite de chamadas. No CSV, gastou uma rodada para conferir um aprovador que já constava no trecho aceito, sem aumentar a cobertura. As 12 chamadas completaram sem erro registrado nem eventos de ferramenta inesperados.

O ganho de uma evidência no enunciado original justifica manter a busca complementar como candidata. O resultado não atingiu o aceite do piloto e a variante permanece na bancada. O próximo ajuste é registrar cobertura por fato, para o Chief distinguir uma lacuna documental de uma lacuna de atribuição. Assim, a retomada pode buscar a transição que faltou sem repetir pesquisas sobre fatos já comprovados. A garantia contra respostas simultâneas continua dependente de teste no pipeline de mensageria.

[Consultas, páginas, decisões e tempos](aurora-piloto-busca-lacunas.json)
