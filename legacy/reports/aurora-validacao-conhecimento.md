# Aurora · Validação de recuperação com perguntas inéditas

## Protocolo

Mantivemos o manifesto e as 12 páginas transcritas dos três PDFs do [piloto de transferência](aurora-piloto-handoff.md). O índice contém 206 trechos. Antes da execução, foram fixadas 10 perguntas respondíveis, quatro sem resposta no recorte publicado e 16 evidências de referência. A recuperação foi avaliada nos seis primeiros candidatos. Uma pergunta positiva só contou como completa quando todos os seus trechos de referência apareceram entre os candidatos.

Para aprovação, o método precisava completar ao menos nove das dez perguntas positivas, recuperar ao menos 90% das evidências (15 de 16 neste conjunto) e completar as quatro perguntas críticas, que exigiam evidências complementares. Os critérios são de bancada. O conjunto foi preparado a partir dos mesmos PDFs e mede perguntas inéditas, com três fontes de um único domínio. [Perguntas e gabarito](../validation/.tools/aurora-piloto-handoff/knowledge-cases.json)

O ensaio comparou o recuperador padrão ao híbrido automático, sem âncoras manuais por pergunta. A variante híbrida usou o serviço real de embeddings local, com pesos fixados, verificação de hashes e agrupamento de segmentos longos. A criação do índice híbrido levou 5,71 segundos na primeira execução. A reexecução reproduziu os IDs, as posições e as métricas dos 14 casos nos dois modos. A checagem de formatação e análise estática também passou. O ensaio não iniciou a interface, não acionou o Codex e não enviou os PDFs para fora da máquina.

## Resultados

| Métrica | Lexical | Híbrida automática |
| --- | ---: | ---: |
| Perguntas positivas completas | 4/10 | 2/10 |
| Evidências encontradas | 7/16 (43,8%) | 6/16 (37,5%) |
| Perguntas críticas completas | 1/4 | 0/4 |
| Perguntas sem resposta que retornaram zero candidatos | 2/4 | 1/4 |
| Critério de aprovação da recuperação | Reprovado | Reprovado |

No controle fora do assunto, ambos retornaram zero candidatos. Nos três controles sem resposta dentro do domínio, a busca lexical retornou candidatos em dois e a híbrida em três. Por exemplo, encontrar o registro de payload não informa o prazo de retenção. A presença de trechos relacionados exige que a etapa de síntese consiga se abster. Essa etapa não foi executada neste ensaio. [Registro com ranking por pergunta](aurora-validacao-conhecimento.json)

## Diagnóstico

- **O contexto se perde ao dividir frases.** Na busca híbrida, três evidências faltantes estavam em outra frase da mesma linha transcrita que um candidato encontrado. Isso ocorreu nos casos de reversão de sessão (Q04), destino da mensagem (Q09) e prazo para nova tentativa (Q10). Expandir virtualmente esses candidatos para a linha inteira elevaria o resultado híbrido de 6 para 9 evidências e de 2 para 4 perguntas completas. Essa contagem é diagnóstica. Linhas inteiras podem conter colunas misturadas e a expansão não foi executada como pipeline.
- **O ranking também perdeu evidências inteiras.** Em Q07, nenhum modo trouxe o campo de fallback para identificar a integração. Em Q01, nenhum trouxe o trecho que explica a restauração após reconexão. Mesmo somando os resultados de ambos os modos e toda a evidência na mesma linha, a cobertura diagnóstica ficaria em 11/16 e 5/10 perguntas completas. A união usa até 12 candidatos e serve apenas para localizar o problema.
- **A melhora assistida do piloto teve escopo específico.** O resultado anterior contou com vocabulário preparado para a pergunta de transferência. Neste conjunto, a recuperação automática ficou abaixo da lexical e nenhuma das duas passou no critério. A busca padrão permanece lexical.

## Próxima hipótese a validar

1. Recuperar o bloco de origem de um trecho ranqueado, preservando parágrafos e tabelas, com página, versão, hash e coordenadas ou offsets que permitam voltar ao original. Testar o ganho dessa mudança separadamente.
2. Comparar uma combinação de busca lexical ponderada para identificadores e busca semântica para paráfrases. Em questões compostas, medir a cobertura de cada parte antes de montar o conjunto final de até seis candidatos. Usar esta bateria para regressão e reservar um novo conjunto para medir generalização sem ajuste por pergunta.
3. Medir a seleção de citações e a abstenção em um ensaio integrado. Exigir uma evidência pertinente para cada afirmação crítica e separar lacunas documentais de falhas de execução. Validar concorrência e entrega de eventos em outro ensaio da integração, com o canal real.

## Reprodução

```powershell
$auroraValidationPython = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $auroraValidationPython -X utf8 validation/.tools/aurora-piloto-handoff/validate_knowledge.py `
    --output reports/aurora-validacao-conhecimento-reexecucao.json
```

O script usa o runtime local com `pdfplumber`, a instalação local do serviço de embeddings e acesso ao socket de loopback. Confere se o hash do manifesto é o mesmo do piloto e se cada referência existe no índice antes de pontuar. O arquivo de saída deve ser novo. [Script de validação](../validation/.tools/aurora-piloto-handoff/validate_knowledge.py)

## Reexecução com blocos de contexto

O piloto passou a aceitar `context_lines` no manifesto. As frases ranqueadas, o gabarito e os hashes das três transcrições foram mantidos. A variante expandiu as frases já selecionadas para blocos literais de até 480 caracteres nas linhas anotadas. O manifesto com as anotações tem hash próprio. A variante preserva fonte, versão, linha e hash da transcrição, deduplica blocos repetidos e mantém o limite de seis candidatos. A página é ligada à linha pelo mapa da transcrição no ensaio. [Mapa de linhas](../validation/.tools/aurora-piloto-handoff/knowledge-context-lines.json) · [Registro do ensaio](aurora-validacao-contexto.json)

| Modo | Perguntas completas | Evidências | Críticas completas |
| --- | ---: | ---: | ---: |
| Lexical por frases | 4/10 | 7/16 | 1/4 |
| Lexical com blocos | 4/10 | 8/16 | 1/4 |
| Híbrida por frases | 2/10 | 6/16 | 0/4 |
| Híbrida com blocos | 4/10 | 9/16 | 2/4 |

A híbrida com blocos completou Q04 e Q10 e recuperou uma evidência adicional em Q09. Q05 e Q09 continuaram incompletos. As contagens de controles negativos sem candidatos permaneceram iguais, 2/4 na lexical e 1/4 na híbrida. Os quatro modos ficaram abaixo do critério de aprovação. A conferência dos IDs e posições sem blocos reproduziu os resultados do primeiro ensaio.

As linhas do manifesto são anotações específicas deste recorte, preparadas após o diagnóstico. O ensaio mede a regressão da mudança nesta bateria. A generalização depende de perguntas e fontes novas. A revisão visual confirmou o layout dos trechos críticos e a mistura de colunas em uma tabela do Fluxo, que ficou fora da ampliação. A anotação de blocos ainda depende da preparação da transcrição. A medição rodou com embeddings locais e não chamou o Codex.

Os seis testes do piloto passaram. Os dois fluxos integrados usaram dados fictícios e um provedor controlado, com API, LangGraph e PostgreSQL locais. Eles verificaram a citação por frase e por bloco, a ausência de conteúdo de fontes revogadas ou locais no provedor, a abstenção sem candidatos e a rejeição de citações fora da seleção. [JUnit da regressão](../validation/aurora-local-restart/pilot-context.xml)

Para reproduzir, acrescente `--context-layout validation/.tools/aurora-piloto-handoff/knowledge-context-lines.json` ao comando acima e use um novo arquivo de saída. O relatório JSON registra também os hashes do mapa de linhas e do manifesto anotado.

## Subconsultas e fusão de rankings

O Azure AI Search documenta consultas focadas executadas em paralelo e fusão por posição com RRF. O Bedrock oferece decomposição e um ranqueador posterior configuráveis. Um trabalho da ACL de 2025 mantém a consulta original ao lado das subconsultas e reavalia a relevância dos candidatos. Um trabalho da EACL de 2026 mede como distribuir o orçamento de recuperação entre subconsultas para evitar ruído. [Azure](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview) · [RRF](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) · [Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html) · [ACL 2025](https://aclanthology.org/2025.acl-srw.32/) · [EACL 2026](https://aclanthology.org/2026.eacl-long.322/)

O ensaio local testou uma regra conservadora em português para separar orações interrogativas explícitas. Preservou a pergunta original e, quando reconhecido, o contexto inicial da oração. A regra acionou em Q04, Q05, Q09 e Q10. Todas as consultas foram vetorizadas em lote. O ensaio comparou alternar candidatos por consulta com fundir posições por RRF, com seis candidatos por consulta e limite final de seis. Foi usado o mesmo ranking híbrido existente em cada consulta. O ensaio não testa RRF entre índices lexical e vetorial independentes. Os hashes do protocolo, das transcrições, do manifesto anotado e da revisão dos pesos permaneceram iguais aos da rodada de blocos. [Registro das subconsultas e rankings](aurora-validacao-subconsultas.json)

| Modo | Perguntas completas | Evidências | Críticas completas |
| --- | ---: | ---: | ---: |
| Híbrida com blocos | 4/10 | 9/16 | 2/4 |
| Subconsultas alternadas | 4/10 | 10/16 | 2/4 |
| Subconsultas com RRF | 4/10 | 10/16 | 2/4 |

As duas variantes recuperaram uma evidência adicional de Q05, sem completar a pergunta. O trecho ficou na posição 2 com alternância e na posição 6 com RRF. Q09 também permaneceu incompleta. As demais perguntas e os quatro controles negativos conservaram os mesmos resultados de cobertura. A reexecução reproduziu os IDs e a ordem dos candidatos. O experimento ficou no validador local, sem alteração do comportamento do Aurora em operação e sem chamadas ao Codex.

Em um diagnóstico separado, ampliar a lista interna para até 24 resultados por consulta colocou **14/16 evidências** ao alcance de um ranqueador ideal, com cobertura potencial de **8/10 perguntas**. A saída do piloto continuou limitada a seis. Em Q05 a evidência ainda ausente da saída aparecia na posição 13 da lista. Em Q07, a evidência aparecia na posição 18. Duas evidências ficaram fora mesmo dessa janela. A cobertura potencial é um teto observado neste conjunto. Nenhum ranqueador foi executado nessa janela.

O próximo comparativo deve isolar dois efeitos. Primeiro, medir se reordenar a lista interna traz evidência relevante aos seis candidatos. Depois, testar consultas reescritas que preservem entidades e identificadores, e busca lexical ponderada separada da vetorial, para alcançar as evidências que ficaram fora da lista ampliada. A escolha final depende de perguntas reservadas e de um ensaio de abstenção da síntese.

Para repetir o ensaio, use `--context-layout` e `--decompose` juntos no comando de reprodução e informe um novo arquivo de saída.
