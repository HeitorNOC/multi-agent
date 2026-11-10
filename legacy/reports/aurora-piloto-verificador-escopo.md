# Verificação de escopo antes do limite de citações

O ensaio reutiliza as consultas geradas na rodada semântica anterior. O código confirma que o manifesto do acervo misto é idêntico. A bancada compara os seis primeiros trechos elegíveis do ranking com a seleção de um verificador semântico que recebe até 24 candidatos elegíveis, além dos controles sintéticos de escopo. Os controles são acrescentados deliberadamente mesmo quando a busca não os retorna, para testar a rejeição.

Toda a busca roda localmente. A chamada ao Codex usa apenas trechos dos três PDFs já utilizados no piloto integrado e dos controles sintéticos. Os quatro recortes adicionais dos PDFs podem influenciar o ranking local, mas seus textos e títulos ficam fora da chamada. O modelo recebe a tarefa, as subquestões e os candidatos. A régua permanece local. O contrato limita a dois IDs válidos por subquestão e a seis trechos distintos na seleção agregada.

## Reprodução

```powershell
$env:TMP = (Resolve-Path 'apps/aurora/.cache').Path
$env:TEMP = $env:TMP
$env:PYTHONPATH = "$PWD;$(Resolve-Path 'apps/aurora/.venv/Lib/site-packages')"
$python = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python validation/.tools/aurora-piloto-handoff/compare_scope_verifier.py reports/aurora-piloto-verificador-escopo.json
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest -q validation/aurora-local-restart/test_pilot_hybrid.py -o asyncio_default_fixture_loop_scope=function
```

O script passou no Ruff. Os dois testes existentes da busca híbrida passaram.

## Resultado

| Caso | Ranking nos seis primeiros | Evidências apresentadas ao verificador | Seleção verificada |
|---|---:|---:|---:|
| Handoff original | 0/3 | 1/3 | 1/3 |
| Handoff reformulado | 1/3 | 1/3 | 1/3 |
| CSV do laboratório azul | 2/2 | 2/2 | 2/2 |
| Limite de chamadas sem resposta no acervo | — | — | Nenhum trecho selecionado |

No handoff original, o verificador selecionou `ACTIVE` do Contact Center, página 9, e deixou vazia a subquestão sobre a prevenção de respostas simultâneas. No handoff reformulado, selecionou `control_passed` do Fluxo de Mensageria, página 10. Cada execução apresentou apenas uma das três evidências da régua ao verificador. Isso localiza a lacuna restante antes da verificação, dentro das etapas de geração e seleção de candidatos.

Nenhum dos controles sintéticos apresentados foi selecionado, incluindo emulador, MBA acadêmico, tabela de treinamento e nota de outro laboratório. No caso do CSV, a linha aceita cobre os dois fatos da régua, mas a subquestão dedicada ao aprovador ficou vazia. O agregador mede cobertura de evidência e o registro por subquestão mede a qualidade da atribuição. Os dois resultados devem ser preservados para evitar que uma boa cobertura agregada esconda lacunas no trabalho de um diretor.

As quatro chamadas levaram entre 3,56 e 5,93 s cada, sem eventos de ferramenta inesperados. A comparação amplia a quantidade de candidatos e adiciona o verificador na mesma variante. A recuperação adicional do estado `ACTIVE` demonstra o resultado da combinação. Um teste com o mesmo conjunto apresentado a ambos os seletores é necessário para atribuir o ganho exclusivamente ao verificador.

O piloto continua na bancada. O próximo passo é abrir uma segunda busca limitada para cada lacuna concreta antes da síntese e medir se as evidências entram no conjunto elegível. Os controles de canal e ambiente devem continuar presentes. A garantia contra respostas simultâneas depende de teste de execução no pipeline de mensageria.

[Evidências por subquestão, páginas e tempos](aurora-piloto-verificador-escopo.json)
