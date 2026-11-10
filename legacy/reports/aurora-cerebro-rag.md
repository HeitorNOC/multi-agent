# Aurora · Arquitetura de conhecimento e próximo ensaio

## Responsabilidades e evidência disponível

| Peça | Papel no Aurora | Evidência e limite |
| --- | --- | --- |
| Vault Markdown / Obsidian | Edição e curadoria opcionais. O conteúdo aprovado pode ser publicado pelo Aurora com versão e proveniência. | O Obsidian trabalha com arquivos Markdown locais. O fluxo integrado do Aurora já preservou um Vault no restore. A interface do Obsidian não fez parte da homologação. [Formato do Vault](https://obsidian.md/help/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata) · [Restore integrado](../validation/brain-recovery/RESULTS.md) |
| Checkpoints / LangGraph | Estado da execução por trabalho. Guardam progresso e permitem retomar etapas ou aguardar uma decisão humana. | `AsyncPostgresSaver` no runtime. A restauração e retomada com dados fictícios já foram ensaiadas. A origem e a autorização atual de um trecho continuam sob o contrato de publicação e leitura do Aurora. [Persistência do LangGraph](https://docs.langchain.com/oss/python/langgraph/persistence) · [Restore integrado](../validation/brain-recovery/RESULTS.md) |
| LightRAG + PostgreSQL/pgvector + Neo4j | No perfil nativo, LightRAG usa relações extraídas e vetores para localizar contexto. As projeções são vinculadas a fonte e versão. | Integração e restore passaram no corpus fictício pequeno. A pesquisa publicada valida o desenho em suas próprias tarefas. Ainda falta comparar o valor das relações no acervo real do Aurora e medir sua ingestão e atualização. [Artigo do LightRAG](https://aclanthology.org/2025.findings-emnlp.568/) · [Restore integrado](../validation/brain-recovery/RESULTS.md) |
| Busca lexical, vetorial e combinação | Localizam trechos candidatos. A lexical é uma referência para identificadores e termos exatos. A vetorial ajuda na recuperação por similaridade. O ranqueador reavalia o par pergunta e trecho. | O piloto documental usa manifesto aprovado e índice local em memória. É um caminho diferente do perfil nativo. A validação mantém a mesma evidência de referência para medir cada alteração na recuperação. [Protocolo do piloto](aurora-validacao-conhecimento.md) |

Os ensaios de desempenho anteriores ajudam a dimensionar o próximo teste. Em oito releases fictícias, o perfil nativo registrou p95 de 0,763 s para recuperação aquecida na concorrência oito, com 16 consultas no grupo. Uma prova separada do pgvector registrou p95 de 0,076 s em 32 consultas sobre mil vetores fictícios. Os testes mediram operações diferentes, com pouca diversidade de consultas. Esses tempos não são comparáveis diretamente ao reranking documental. [Ensaio de capacidade existente](../validation/investment-gate/RESULTS.md)

Em escala, a busca vetorial exata serve de referência para medir perda de vizinhos ao testar HNSW. O pgvector documenta o efeito de filtros seletivos sobre índices aproximados e a opção de varreduras iterativas. Para o Aurora, o comparativo precisa aplicar o mesmo escopo autorizado e a mesma revisão documental antes de medir qualidade e latência. [pgvector](https://github.com/pgvector/pgvector#indexing)

## Experimento com ranqueador local

A comparação manteve os três PDFs, os hashes do corpus, os blocos revisados e as 14 perguntas da bateria, com limite final de seis trechos. A busca inicial ranqueou a pergunta original e as subconsultas explícitas. A fusão RRF estabeleceu a ordem inicial do conjunto e os blocos repetidos foram removidos. O cross-encoder pontuou pares de pergunta e trecho em lotes de oito, em CPU com dois threads de inferência, em uma máquina com 12 CPUs lógicas. A saída registra posições, IDs, tempos e hashes. [Modelo mMARCO multilíngue, revisão fixada](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1/commit/173760f6b16fca2c3f57388323c4708ee2345a82) · [Resultado por pergunta](aurora-validacao-reranking.json)

O ONNX quantizado tem 118.620.016 bytes e seu SHA-256 foi conferido com o upstream. O tokenizador foi baixado da mesma revisão e seu hash também é verificado antes do ensaio. Só houve tráfego externo para baixar esses dois artefatos. Os trechos dos PDFs permaneceram em inferência local e o Codex não foi chamado. A mudança está no validador de bancada.

| Variante | Perguntas completas | Evidências | Críticas completas | p50 / p95 da recuperação |
| --- | ---: | ---: | ---: | ---: |
| Subconsultas com RRF, sem cross-encoder | 4/10 | 10/16 | 2/4 | Sem comparação de tempo, parte das consultas veio do cache |
| Cross-encoder, lista interna de até 6 por consulta | 4/10 | 10/16 | 2/4 | 121 / 281 ms |
| Cross-encoder, lista interna de até 24 por consulta | 7/10 | 13/16 | 2/4 | 349 / 744 ms |
| Cross-encoder por subconsulta, lista interna de até 24 por consulta | 7/10 | 13/16 | 2/4 | 376 / 2.008 ms |

Os tempos são de uma rodada sequencial de 14 consultas, com pesos carregados, incluindo busca inicial e reordenação. O p95 por posição corresponde ao máximo dessa amostra. O ranqueador iniciou em aproximadamente 0,97–0,99 s, medidos separadamente. A reexecução reproduziu os candidatos e a ordem dos dois modos que pontuam com a pergunta original. O ensaio não mede síntese, concorrência, gasto monetário ou latência do aplicativo completo. A variante por subconsulta aumentou a cauda de latência sem ganho de cobertura. Os quatro controles sem resposta continuaram com três listas contendo trechos relacionados. Abstenção do parecer segue como teste separado.

A lista de 24 trouxe aos seis primeiros as evidências de Q01, Q02 e Q07 e completou essas três perguntas. Q03 e Q09 ainda têm evidência ausente da própria lista híbrida ampliada. Q05 tem evidência relevante na lista interna, mas o ranqueador a deixou fora dos seis primeiros. O melhor resultado ficou abaixo dos 9/10 e 15/16 exigidos, com apenas 2/4 casos críticos completos.

## Próximo comparativo

1. **Comparar os motores sobre o mesmo conteúdo aprovado.** Manter o modo documental com lista ampliada e reordenação como referência. Medir busca lexical ponderada e vetorial em listas independentes e, separadamente, adicionar o contexto do LightRAG. Usar casos que exigem relações entre documentos e casos com códigos e estados exatos. Medir o ganho de cada fonte de candidatos antes do ranqueamento e após o limite de seis.
2. **Medir qualidade, operação e desempenho juntos.** Reservar perguntas e fontes que não orientaram os ajustes. Medir cobertura por afirmação, consultas sem resposta, atualização após mudança de versão, revogação de acesso, custo de ingestão, latência fria e aquecida e p95 sob concorrência. Contabilizar separado o tempo da busca e da síntese. As medições anteriores de pgvector e LightRAG são referências de bancada.
3. **Revalidar retomada com evidência versionada.** Persistir referências, versão da fonte e do recuperador e estado da tarefa em registros apropriados. Em uma retomada, conferir as permissões vigentes antes de ler ou reutilizar trechos. Ensaiar publicação e revogação durante uma interrupção. O Vault continua um ponto de edição opcional da fonte.

Para reproduzir, use o comando do [validador de conhecimento](aurora-validacao-conhecimento.md#reprodução) com `--context-layout`, `--decompose` e `--rerank`, apontando a saída para um arquivo novo. O código espera o ONNX e `tokenizer.json` em `apps/aurora/.models/reranker-mmarco-173760f` e usa o ambiente local de embeddings. [Validador](../validation/.tools/aurora-piloto-handoff/validate_knowledge.py) · [Configuração e hashes](../validation/.tools/aurora-piloto-handoff/rerank_experiment.py)

## Busca lexical e vetorial como canais independentes

O segundo comparativo manteve os hashes do corpus, do gabarito e dos blocos, o mesmo cross-encoder e o limite de seis trechos na saída. BM25 usou SQLite FTS5 em memória, com remoção de acentos e preservação de identificadores com `_`. O canal vetorial ordenou por cosseno, com corte de 0,38 e os mesmos embeddings. O modo combinado fundiu as duas listas por RRF e limitou o conjunto a 24 por consulta antes da reordenação final. Os 14 casos foram executados em sequência. [Resultado por pergunta](aurora-validacao-canais.json)

| Canal com reordenação | Evidências na lista interna | Evidências na saída | Perguntas completas | p95 da recuperação |
| --- | ---: | ---: | ---: | ---: |
| Híbrida anterior | 14/16 | 13/16 | 7/10 | 764 ms |
| BM25 | 11/16 | 11/16 | 5/10 | 807 ms |
| Vetorial | 14/16 | 13/16 | 7/10 | 728 ms |
| BM25 + vetorial com RRF | 13/16 | 12/16 | 6/10 | 785 ms |

Todas as variantes completaram 2/4 casos críticos. A fusão RRF tirou da lista interna uma evidência que o vetor isolado encontrava em Q07. BM25 e a fusão retornaram trechos em todos os quatro controles sem resposta. O vetor isolado e a híbrida anterior devolveram listas em três dos quatro. O benchmark mede cobertura de busca. A seleção de citações e a abstenção na resposta final exigem ensaio integrado.

### Canal experimental LightRAG

O piloto documental e a ingestão nativa têm fronteiras de publicação distintas. Para testar o mesmo acervo sem enviar transcrições integrais a um extrator remoto, o ensaio usou LightRAG 1.5.8, `ainsert_custom_kg` e `aquery_data(mode="local")` em uma área descartável com os storages locais da biblioteca. O grafo ligou trechos a identificadores escritos literalmente em cada trecho. Essas arestas representam menções. O ensaio não usou a extração semântica do perfil nativo, Neo4j ou pgvector. O caminho de ingestão manual do SDK foi usado somente no armazenamento descartável.

O grafo usou 164 trechos distintos, 227 nós e 194 arestas. A construção levou 10,02 s. Cada candidato retornado precisou corresponder a uma referência e a um trecho literal do manifesto autorizado antes de entrar na fusão. Nenhum trecho retornado foi recusado nessa conferência. Os candidatos do grafo entraram como terceira lista RRF antes do mesmo corte de 24 por consulta e do mesmo ranqueador. O limite final continuou em seis. A execução manteve os arquivos e embeddings locais e limpou o diretório descartável. [Resultados e metadados](aurora-validacao-canais-grafo.json)

| Variante, na mesma rodada | Evidências na lista interna | Evidências na saída | Perguntas completas | p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Vetorial | 14/16 | 13/16 | 7/10 | 333 / 730 ms |
| BM25 + vetorial | 13/16 | 12/16 | 6/10 | 372 / 781 ms |
| BM25 + vetorial + LightRAG local | 14/16 | 13/16 | 7/10 | 442 / 946 ms |

A adição do grafo recuperou a evidência de Q07 que a fusão de dois canais havia perdido. A lista final voltou à mesma cobertura do vetor isolado e trouxe trechos em todos os controles sem resposta. Os tempos são da recuperação em 14 consultas sequenciais, com modelos carregados. O p95 corresponde ao maior tempo desta amostra. Os canais sem grafo reproduziram os IDs e a ordem dos candidatos da primeira rodada. A variante com grafo foi executada uma vez. O critério de aprovação continuou pendente em todos os modos.

Usar o vetor com reordenação como referência na próxima rodada. Em Q03 e Q09, o trecho necessário ficou fora da lista interna em todas as variantes desta rodada. Em Q05, ficou dentro da lista vetorial, mas fora dos seis selecionados. Isso justifica testar reescrita preservando identificadores para melhorar a geração de candidatos e, separadamente, seleção por cobertura para Q05. Um teste com ingestão semântica do LightRAG precisa de perguntas reservadas que exijam relações reais entre fontes, além de controle equivalente de acesso, versão e latência.

Para reproduzir os canais, use `--context-layout`, `--rerank` e `--independent` no validador. Acrescente `--graph` para a comparação com LightRAG e indique um novo arquivo de saída. [Implementação BM25 e vetorial](../validation/.tools/aurora-piloto-handoff/independent_retrieval.py) · [Worker LightRAG](../validation/.tools/aurora-piloto-handoff/lightrag_graph_worker.py)
