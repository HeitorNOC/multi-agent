# Corpus, fila e exaustão — 04/11/2026

**Produção continua NO-GO.** O ensaio mediu um gargalo da camada própria e demonstrou melhora no perfil experimental de leitura. O E2E original terminou **FAIL** na última expectativa do teste (409 correto para fingerprint encerrado, quando se esperava 429). A verificação complementar de quota terminou **PASS**, com zero modelo. Não houve repetição integral após corrigir a entrada do roteiro; source original, falha e JUnit preservados.

## Medidas de leitura de histórico

Limite exploratório predefinido: p95 <= 1 s. Não é SLO de uma empresa grande. Tokens de serviço foram emitidos antes da cronometragem; JWT/DB/HTTP/provas estão no tempo medido. Cliente urllib sem pooling, métricas e logging da bancada ativos; throughput é desta amostra, não teto de produção.

| Perfil / cenário | N | Concorrência | p50 s | p95 s | Máx s | Erros | req/s da amostra | Critério |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| baseline-warm-c1 | 40 | 1 | 0.045 | 0.057 | 0.060 | 0 | 23.0 | PASS |
| baseline-warm-c4 | 40 | 4 | 0.051 | 0.319 | 0.588 | 0 | 31.2 | PASS |
| baseline-warm-c8 | 40 | 8 | 0.094 | 0.462 | 0.921 | 0 | 35.1 | PASS |
| baseline-under-inference | 8 | 8 | 11.128 | 11.268 | 11.268 | 0 | 0.7 | FAIL |
| parallel-warm-c8 | 80 | 8 | 0.063 | 0.098 | 0.104 | 0 | 111.5 | PASS |
| parallel-under-inference | 8 | 8 | 0.049 | 0.064 | 0.064 | 0 | 117.8 | PASS |

Durante uma inferência real, as oito leituras no perfil original aguardaram a trava de negócio: p95 11.268 s, acima do limite. No perfil experimental, p95 0.064 s; houve duas chamadas CLI reais na janela de cada perfil. Não se usou uma resposta de modelo em cache para simular trabalho ativo. Com N=8, p95 nearest-rank coincide com o máximo observado: é uma rajada pequena, não estimativa estável de cauda empresarial. A ordem foi fixa e as duas perguntas são diferentes; não é comparação de velocidade entre modelos.

O ajuste deixa decisões antigas imutáveis serem lidas enquanto há writer ativo, mantendo grants atuais e gates antes/depois. Sem writer, usa shared lock e confere o head. Foram exercitados freeze, revogação do próprio usuário financeiro e crash deixando intenção sem writer: leituras foram negadas corretamente. Não houve restore frio completo depois desse perfil nem prova de todas as corridas de grant/sessão PG/rede. O ajuste melhora somente histórico; novas tarefas de IA continuam serializadas por instalação. queue-summary.json contém a instrumentação do servidor; o campo do perfil experimental inclui estabelecimento de conexão/shared-try e não é perfeitamente idêntico ao tempo de contenção do perfil original.

## Corpus e respostas

Três manuais sintéticos aprovados, com fontes públicas conflitantes e uma financeira restrita, seis perguntas por modo; 12/12 passaram no grader lexical/fonte/citação/canário. Não é corpus representativo de milhões de documentos nem consulta federada de fontes. Native LightRAG, extração e ONNX reais; nenhuma aresta/resposta foi injetada.

| Caso | Modo | Chamadas CLI na solicitação | Tempo s | Checks |
|---|---|---:|---:|---|
| aurora_meal | mix | 5 | 45.89 | PASS |
| aurora_deadline | mix | 2 | 10.75 | PASS |
| boreal_meal | mix | 5 | 49.43 | PASS |
| boreal_reviewers | mix | 2 | 10.97 | PASS |
| celeste_cap | mix | 5 | 37.76 | PASS |
| missing_hotel | mix | 2 | 10.04 | PASS |
| aurora_meal | naive | 1 | 6.19 | PASS |
| aurora_deadline | naive | 1 | 5.73 | PASS |
| boreal_meal | naive | 1 | 5.75 | PASS |
| boreal_reviewers | naive | 1 | 5.27 | PASS |
| celeste_cap | naive | 1 | 6.50 | PASS |
| missing_hotel | naive | 1 | 5.99 | PASS |

Primeira consulta mix de cada fonte inclui ingestão; naive usa índice já pronto. Não inferir preço/performance total de ingestão desses tempos. As fontes/snapshots são os mesmos nos dois modos; perguntas/ordem fixas, sem reruns para obter acerto. O grader é limitado a valores/abstenção, arquivo/citação e isolamento; não avalia suporte de cada afirmação ou significância estatística. Respostas completas em acceptance.json e decisões originais em decisions.json.

## Quota cheia e a falha do roteiro

Com 40 reservas preenchidas, uma nova pergunta em fonte já ingerida percorreu o caminho nativo. O provider recusou reservar; nenhuma nova CLI foi iniciada. A API devolveu 409 por falha de geração e deixou intenção/admission pendente; a leitura seguinte de histórico foi bloqueada com 503. Isso é falha real de disponibilidade do perfil original, preservada em quota-baseline.json.

O preflight experimental verifica quota antes da intenção/admission. O último passo do E2E, porém, trocou só UUID e repetiu a pergunta da intenção encerrada unknown; o tombstone retornou corretamente 409 antes do preflight. A proteção não foi removida ou reordenada para forçar PASS. O roteiro futuro agora usa pergunta realmente nova; não se repetiram as inferências.

Uma instalação complementar usa exatamente os mesmos arquivos de backend (hashes conferidos), cria pela API uma resposta de abstenção anterior à vigência, fecha uma intenção e enche a quota sem modelos. Resultado: entrada nova recusada 429 antes de admission, fingerprint encerrado recusado 409, seq da autoridade inalterado e 16 leituras exatas de histórico nas duas APIs, sem gate indevido. É regressão de infraestrutura com histórico de abstenção, não repetição do benchmark com índice nativo/corpus/modelos. Evidências e código complementares estão no pacote.

O preflight não assegura budget suficiente para todos os passos: exaustão no meio da ingestão, keywords ou geração ainda pode deixar resultado pendente. Também é conservador e recusa novos pedidos sem vaga mesmo que acabassem em cache/abstenção. Falta reserva por job, rastreio de chamadas por trabalho e política de falha parcial antes de concorrência real de várias tarefas.

## Uso, custo e tentativa inicial

Foram 31 saídas CLI Terra concluídas, com tokens observados {"input_tokens": 409633, "cached_input_tokens": 316544, "output_tokens": 5028, "reasoning_output_tokens": 0} e 0 eventos de ferramentas. A sobra de 9 vagas foi consumida por reservas locais sem CLI no ensaio principal. Na regressão complementar, 40 reservas locais e zero CLI. Essas reservas não são chamadas a modelos nem dinheiro gasto.

A tentativa inicial cancelada tinha 1 reserva já feita e nenhum stdout/usage concluído capturado. Execução e consumo dessa tentativa permanecem desconhecidos. A afirmação inicial de que nenhuma chamada teria ocorrido foi corrigida; zero arquivos não prova custo zero. A reserva/checkpoint antigo é auditado em attempt-setup/reservation-check.json. O uso dessa tentativa não foi inventado ou incorporado à soma de tokens conhecidos. Há no máximo uma tentativa de CLI por reserva nessa implementação, mas não há evidência de sua conclusão.

Provas verificadas offline para as duas instalações com chave pública capturada: 534. Provas iniciais da instalação cancelada, cuja chave pública não foi exportada: 28, preservadas sem alegação de verificação criptográfica. O primeiro consolidador tentou usar a chave da instalação nova e recusou corretamente a assinatura; a análise agora particiona por instalação e registra essa lacuna, sem alterar provas ou inventar uma chave.

**Custo monetário atribuível permanece não medido.** Não converter contagem de CLI/reserva em dinheiro. Latência/usage incluem transporte Codex e seu contexto; não equivalem à API de inferência direta, outra hospedagem ou custo completo de uma empresa. Amostras Docker cobrem apenas containers, sem custo/recursos da API e embeddings no host, modelo remoto ou backup.

## Decisão técnica

Continuar qualificação dos componentes e da camada própria. O teste não justifica descartar LightRAG/LangGraph: a espera de histórico foi provocada pela nossa exclusão global, e o perfil experimental mostrou caminho de melhoria. Isso também não aprova os motores universalmente. Produção segue NO-GO por concorrência de tarefas ainda serializada, quota parcial sem tratamento, ausência de custo financeiro atribuível, corpus/carga pequenos, falta de restore integrado do perfil novo e produto empresarial incompleto.

Priorizar camada empresarial TypeScript + único owner LangGraph, orçamento/fencing por trabalho e testes combinados de recuperação antes de aumentar carga/modelo. Preservar cérebro lógico central, instalação dedicada, Chief of Staff, A0–A4, equipes por capacidades e JARVIS. Controles Python são bancada, editorial/proveniência TypeScript reais. SSO/TLS/cofre/DR externo, conectores e sandbox/gateway integrados seguem pendentes. Obsidian opcional, UI não ensaiada; Graphiti não é autoridade histórica exclusiva.
