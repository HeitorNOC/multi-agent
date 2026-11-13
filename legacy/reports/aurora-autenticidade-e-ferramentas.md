# Aurora · Autenticidade de fontes e fronteira de execução

## Fonte íntegra com conteúdo falso

O ensaio usou uma política fictícia de reembolso cujo prazo no gabarito era de 15 dias úteis. O roteiro substituiu esse valor por 45 dias mantendo o manifesto original. O carregador recusou os bytes alterados por divergência de SHA-256. Depois, o roteiro simulou a publicação dos bytes falsos com um manifesto coerente e classificação `model-approved`. Essa foi a única fonte disponibilizada ao fluxo. O gabarito permaneceu fora do contexto do modelo. [Roteiro](../validation/.tools/aurora-piloto-handoff/run_false_fact.py)

GPT-6.1 Terra selecionou a afirmação falsa e o verificador a aceitou como pertinente. O parecer citou literalmente 45 dias úteis e chegou à revisão humana como `supported_extracts`, sem lacunas declaradas. A sessão foi encerrada sem aprovação. Foram cinco chamadas, com 60.347 tokens de entrada, dos quais 40.960 em cache, e 756 tokens de saída. Nenhuma chamada registrou evento de ferramenta. O teste confirmou que integridade, pertinência e veracidade são propriedades distintas. [Registro integrado](aurora-fato-falso-integrado.json)

O perfil documental valida a correspondência com o manifesto da sessão. O perfil nativo também verifica a assinatura de uma publicação, o hash e a instalação. O ensaio reproduziu uma publicação coerente no piloto documental. Uma assinatura do editor ajuda a provar autoria e integridade da publicação, enquanto a veracidade de um campo crítico depende da fonte responsável por ele. [Validação da publicação nativa](../apps/aurora/runtime/services/native.py:248)

## Gateway local com ferramenta executada em Docker

O roteiro reutilizou o gateway da qualificação e a imagem fixada. Executou Python como UID 65534, sem rede, sem acesso ao socket Docker e com sistema de arquivos raiz somente para leitura. A ferramenta recebeu apenas um contexto sintético, calculou a soma esperada de 15 e escreveu no diretório temporário. A tentativa de escrita fora da área temporária falhou. Não foram observados nomes de variáveis de ambiente com padrões de credenciais. [Roteiro](../validation/.tools/aurora-piloto-handoff/probe_tool_boundary.py)

- Foram recusadas seis tentativas de execução por assinatura alterada, expiração, operação fora do escopo, mudança do código, mudança da entrada e reaproveitamento da autorização.
- O receptor HTTP local respondeu ao controle positivo do host e recebeu zero requisições do contêiner. A resolução do endereço do host falhou. A reexecução incluiu uma tentativa por IP de teste sem depender de DNS, que também falhou.
- Um processo com filho excedeu o limite de quatro segundos e foi interrompido. Os dois contêineres foram removidos, com conferência pelo rótulo do ensaio.

[Primeira execução](aurora-fronteira-ferramenta.json) · [Reexecução com teste por IP](aurora-fronteira-ferramenta-reexecucao.json)

O gateway ensaiado é independente do fluxo consultivo. Sua autorização é vinculada ao código e à entrada, com controle de uso em memória. O ensaio não mede replay após reinício, chamadas MCP ou acesso real a serviços de envio e exclusão. Nenhuma integração empresarial recebeu uma operação.

## Decisão técnica

O gateway descartável passou nos controles testados. Manter a conexão de efeitos em ambiente descartável até provar aprovação exata, autorização por destino e recibo persistido diante de reinício.

## Conferência com referência do Financeiro

O comparativo de bancada usou o campo sintético `refund_deadline_business_days`. Uma referência estruturada separada fixou 15 dias úteis, emissor, fonte, versão e vigência. O ensaio gerou uma chave Ed25519 fictícia e entregou a chave pública diretamente ao comparador, fora do documento e do manifesto consultivo. O comparador verificou a assinatura e vinculou as citações aos IDs, ao hash do manifesto e ao texto literal do acervo antes de comparar o prazo. [Roteiro e critérios](../validation/.tools/aurora-piloto-handoff/check_refund_reference.py)

| Cenário | Resultado | Elegível à revisão segundo o comparador |
| --- | --- | --- |
| Citação de 15 dias úteis e referência de 15 | Confirmado | Sim |
| Parecer integrado que citou 45 dias úteis e referência de 15 | Divergente | Não |
| Referência ausente, adulterada, expirada ou de versão incompatível | Indisponível | Não |
| Texto da citação alterado ou unidade em dias corridos | Indisponível | Não |

Passaram oito casos. O cenário divergente reaproveitou a saída real do fluxo consultivo e reconstituiu o mesmo manifesto para conferir o vínculo. A decisão de inelegibilidade é do comparador de bancada. Na execução histórica, o parecer falso chegou à revisão humana. Os outros cenários usaram relatórios montados pelo contrato local do piloto. A reavaliação foi determinística e não fez novas chamadas ao modelo. [Registro por cenário](aurora-referencia-financeira.json)

A extração aceita um formato explícito de prazo em dias úteis. Valores em outros formatos e unidades ficam sem confirmação. A validação da assinatura depende da chave de confiança recebida pelo comparador. Nessa rodada, a conferência foi feita fora do runtime e usou uma autoridade fictícia.

### Conferência na criação do parecer pela API

A conferência de bancada foi reutilizada pelo launcher do piloto, depois dos recibos de síntese e verificação de citações. O recorte é ativado com arquivo de referência e chave pública fixada na configuração da sessão. A leitura usa a referência vigente no momento da criação do parecer. Se houver confirmação, o parecer incorpora emissor, versão e hash da referência. Esses metadados integram o conteúdo vinculado ao hash da revisão. A referência não entra no prompt e a conferência não consome uma chamada adicional ao modelo.

O recorte dedicado aceita apenas a pergunta exata do ensaio e o formato explícito em dias úteis. Uma paráfrase fica indisponível nesse perfil. Outras sessões do piloto continuam com o fluxo consultivo anterior. O comparativo usa uma autoridade e dados fictícios.

| Caso pela API | Estado do trabalho | Parecer |
| --- | --- | --- |
| Citação de 45 dias úteis e referência assinada de 45 | `awaiting_approval` | Revisão criada, com hash da referência |
| Mesma citação com referência assinada de 15 | `failed` | Ausente, evento `refund_reference_divergent:value_mismatch` |
| Mesma citação com arquivo de referência ausente | `failed` | Ausente, evento `refund_reference_unavailable:missing_reference` |
| Paráfrase da pergunta com referência presente | `failed` | Ausente, evento `refund_reference_unavailable:unsupported_question` |

Nos três casos bloqueados, a API recusou a tentativa de aprovação com HTTP 409. Na primeira execução, a divergência já foi bloqueada e o teste aguardou `recovery_required` em vez de `failed`. Os recursos remanescentes dessa sessão de teste foram removidos. Após corrigir a asserção, passaram os oito testes da suíte em 151,32 segundos. Os dois modos documentais anteriores e o novo recorte foram exercitados com API, LangGraph e PostgreSQL locais e provedor controlado. Os oito casos determinísticos de bancada também foram reproduzidos com o módulo integrado. [JUnit final](../validation/aurora-local-restart/pilot-refund-reference-final.xml) · [Bancada reexecutada](aurora-referencia-financeira-reexecucao.json)

### Mudança da referência entre revisão, aprovação e efeito

A API revalida assinatura, vigência, conteúdo e hash da referência vinculada ao parecer antes de registrar a aprovação. Depois da consulta, confere novamente que o parecer e o estado do trabalho são os mesmos. Se a referência estiver divergente, indisponível ou tiver sido substituída por outra com hash diferente, registra `approval_reference_rejected`, encerra aquele parecer como `rejected` e responde HTTP 409. A aprovação do trabalho seguinte exige um novo parecer. O histórico conserva o parecer recusado para auditoria.

| Cenário com o hash correto do parecer | Resultado observado |
| --- | --- |
| Referência inalterada | HTTP 202, trabalho concluído e recibo simulado |
| Prazo na referência alterado de 45 para 15 dias úteis | HTTP 409, sem aprovação nem recibo |
| Arquivo retirado antes da aprovação | HTTP 409, sem aprovação nem recibo |
| Arquivo retirado após a conferência da aprovação, antes do efeito | HTTP 202 na aprovação. Worker bloqueado antes do recibo, com `effect_reference_rejected` e autorização removida |

Nos dois casos recusados na aprovação, restaurar os bytes originais ainda resultou em HTTP 409. O teste integrado passou em 52,74 s com dados fictícios e provedor controlado. O teste usou uma fixture para retirar o arquivo entre as duas conferências. Passaram também dez regressões Node, incluindo aprovação por hash e reaproveitamento de recibo após reinício, além de TypeScript, build e análise estática dos arquivos Python. [JUnit da revogação](../validation/aurora-local-restart/pilot-reference-approval.xml)

O teste mede dois pontos de conferência. A leitura do arquivo e a gravação do efeito simulado usam mecanismos de armazenamento separados e deixam uma janela após a última leitura. Uma revogação atômica com um efeito externo continua fora deste ensaio.

### Revogação transacional local

O perfil financeiro passou a aceitar `POST /api/pilot/revoke-reference`, com identidade de operador e hash do parecer. A API registra a revogação para o par fonte e versão, no escopo do emissor e do campo, em `journey.sqlite`. A transação que gravaria o primeiro recibo consulta a revogação no mesmo banco. A mesma versão fica bloqueada para novos pareceres. Repetir a revogação é idempotente.

| Ordem forçada no ensaio | Resultado |
| --- | --- |
| Revogação antes do efeito, com o worker já aprovado e aguardando a resposta da última conferência | Recibo ausente. O verificador controlado devolveu `ok`, mas a transação do efeito encontrou a revogação e registrou `effect_reference_rejected`. |
| Efeito antes da revogação | Um recibo persistido, com evento anterior à revogação. |
| Queda do worker após o efeito, seguida de revogação e reinício da API | A retomada devolveu o mesmo ID de recibo. O evento de replay veio depois da revogação e o banco continuou com um único efeito. |

O ensaio usou HTTP, fila, política de aprovação e SQLite reais, com worker e serviço de referência controlados. O perfil de consulta recebeu HTTP 403 ao tentar revogar. A revogação repetida após reiniciar foi reconhecida e a versão revogada não gerou novo parecer. Passaram as 11 verificações Node, incluindo o teste concorrente. A regressão do piloto com API, LangGraph e PostgreSQL locais e provedor controlado passou em 52,20 s. TypeScript e build também passaram. [JUnit concorrência e regressões](../validation/observability-recovery/reference-effect.xml) · [JUnit piloto integrado](../validation/aurora-local-restart/pilot-reference-approval-atomic.xml)

A garantia vale para revogações registradas pela rota e efeitos gravados nesse mesmo banco local. A retirada direta do arquivo continua sujeita às conferências por leitura. O ensaio não aciona um serviço externo e não prova que um destino externo aplica revogação ou deduplicação.

### Destino HTTP descartável com autoridade própria

O destino de teste rodou em outro processo, por HTTP em loopback, com banco próprio e separado do diário do adaptador. A autoridade de teste registrou o escopo, a geração da autorização e o hash da intenção. Chaves distintas separam quem concede ou revoga uma autorização de quem executa ou consulta o recibo. O destino consulta a autorização dentro da mesma transação que grava o efeito fictício. Uma intenção já gravada devolve seu recibo anterior somente quando o conteúdo confere com o registro original. [Implementação do destino](../validation/observability-recovery/reference_destination.py)

| Injeção de falha ou concorrência | Resultado |
| --- | --- |
| A requisição já chegou, mas a revogação foi gravada no destino antes da transação do efeito | HTTP 409 e nenhum recibo |
| Dois envios simultâneos da mesma intenção | Um efeito gravado, mesmo recibo nas duas respostas |
| Queda da conexão após o commit, seguida de revogação e reinício do destino | O adaptador abriu o diário local e consultou a intenção. Recuperou o recibo anterior, sem novo envio na conciliação. Um replay explícito do teste também devolveu o mesmo ID. |
| Queda da conexão antes do commit | A consulta retornou sem recibo. O adaptador manteve `unknown` e bloqueou novo envio automático. |
| Chave de execução tentando revogar, intenção alterada ou geração antiga | Recusa por credencial, conflito de intenção ou autorização desatualizada, respectivamente. |
| Origem registra revogação, mas ainda não a entrega ao destino | O destino aceitou uma intenção já em trânsito. Depois de gravar e confirmar a revogação, recusou a próxima intenção do mesmo escopo. |

Passaram os dois testes do destino, incluindo a conciliação após reinício e o atraso de propagação, e as duas regressões da API local. O destino e o adaptador são componentes de laboratório, com operações fictícias. O ensaio não ligou um conector ao runtime do Aurora nem qualificou a segurança do transporte fora do host. [JUnit do destino](../validation/observability-recovery/reference-destination-ack.xml)

O comparativo distingue a revogação na origem da revogação efetiva no destino. Uma integração precisa persistir esse estado de sincronização e tratar uma confirmação ausente como pendência. Após uma falha de envio, a conciliação consulta o recibo da mesma intenção. Ausência de recibo, por si só, não demonstra que a operação terminou sem efeito.

### Integração do diário de destino à API do Aurora

O perfil financeiro aceita um destino descartável por configuração interna `pilotDestination`. O adaptador aceita somente HTTP em loopback e exige chaves distintas de execução e controle. A bancada prepara a autorização no destino para a intenção exata, vinculada ao hash do parecer. A integração não está exposta no launcher padrão nem envia operações a um sistema empresarial.

A API grava a intenção em `journey.sqlite` antes da primeira tentativa de envio. Em retomada, uma intenção já registrada é consultada pelo mesmo identificador e conteúdo. O operador também pode consultar por `POST /api/pilot/connector/reconcile` com o trabalho e o hash do parecer. Quando a consulta confirma um recibo, a API registra o efeito local com o ID de recibo do destino. O trabalho pode ser retomado para concluir o fluxo. Sem recibo, a operação permanece com resultado desconhecido e a API não faz novo envio automático.

Registrar uma revogação local cria, na mesma transação, uma pendência para o destino. A rota responde `202 pending` se não puder confirmar a gravação remota. O operador pode repetir a mesma solicitação, que retorna `200 acknowledged` depois de confirmar o destino e persistir a resposta. A API recusa encerrar normalmente uma sessão com pendências de destino.

No teste, o destino gravou o efeito e fechou a conexão sem devolver seu recibo. Na sequência, gravou a revogação e também perdeu a primeira resposta. O Aurora manteve a intenção e a revogação pendente no banco. Após reiniciar a API no mesmo diretório, a repetição da revogação confirmou o registro. A conciliação recuperou o recibo, e a retomada concluiu o trabalho com esse recibo. O banco do destino registrou um `send`, um `lookup` e um efeito. O banco do Aurora registrou um efeito e uma confirmação de revogação.

Passaram três testes de destino e integração, três regressões Node, a checagem TypeScript e o build. A primeira tentativa expôs uma sintaxe incompatível com o modo nativo do Node que remove tipos TypeScript. A construção do adaptador foi ajustada e a suíte reexecutada. O ensaio usa a API e os dois bancos reais com backend de referência e worker controlados. O ambiente não mede reinício do host, TLS, qualificação do conector empresarial ou reconciliação por LangGraph nesta rodada. [JUnit da integração](../validation/observability-recovery/reference-connector-final.xml)

### Retomada do conector pelo LangGraph

O teste usa o launcher financeiro, a API e o worker reais, com checkpoint em PostgreSQL, referência fictícia assinada e destino HTTP descartável em processo separado. Uma fixture fornece a configuração local do destino e o provedor de modelo é controlado. A autoridade do destino concede a intenção exata do parecer. O destino persiste o efeito e encerra a conexão antes de devolver o recibo.

O trabalho saiu da primeira tentativa sem recibo local. A API revogou a referência e obteve a confirmação do destino. O operador acionou `/resume` diretamente, sem conciliação manual prévia. O novo worker carregou o checkpoint com `effect` como próximo nó, consultou a intenção já registrada e concluiu com o recibo que o destino havia persistido antes da revogação. O diário remoto registrou um `send`, um `lookup` e um efeito. As cinco chamadas ao provedor controlado permaneceram as mesmas na retomada.

Esta etapa valida a retomada do worker com o conector dentro da sessão. O ensaio anterior validou o reinício da API com worker controlado. O teste atual não reinicia o host nem usa destino empresarial. [Primeira execução com LangGraph](../validation/aurora-local-restart/pilot-connector-langgraph.xml)

A reexecução passou em 46,08 s. Confirmou um ID de checkpoint na retomada e uma única ocorrência de síntese no histórico. A regressão separada de aprovação e revogação do piloto sem conector também passou, em 52,06 s. [JUnit do checkpoint e conector](../validation/aurora-local-restart/pilot-connector-langgraph-final.xml) · [JUnit do piloto sem conector](../validation/aurora-local-restart/pilot-connector-local-regression.xml)

### Reinício abrupto da instalação no mesmo host

**Decisão aprovada em 06/11/2026.** A recuperação após interrupção abrupta da instalação Aurora no mesmo host está homologada para o perfil lexical de laboratório, com volumes preservados e destino HTTP descartável. A aprovação cobre a retomada por checkpoint, a conciliação do recibo sem reenvio, a recuperação da confirmação de revogação e o tratamento de intenções sem recibo. A liberação para produção continua sendo uma decisão separada.

O launcher padrão encerra o piloto descartando seu estado. Para este ensaio, `--pilot-recovery-lab` habilita um diretório dedicado de recuperação. A sessão protegida pelo Windows vincula a retomada ao manifesto e à configuração da referência. O launcher verifica as identidades dos recursos Docker antes de reabrir a instalação. [Roteiro automatizado](../validation/aurora-local-restart/test_pilot_connector_restart.py) · [Perfil de laboratório](../docs/PILOTO_AURORA.md)

O primeiro envio perdeu a resposta antes de gravar o efeito. No segundo, o destino gravou o efeito e reteve a resposta. A revogação também foi gravada no destino, mas a primeira confirmação se perdeu. O teste verificou que o trabalho ainda estava em execução e sem recibo local, interrompeu o launcher, a API e o worker com `taskkill /F /T`, parou os contêineres de dados com `docker kill` e abriu a mesma instalação. O destino HTTP ficou em execução em processo separado.

| Verificação após reabrir | Resultado observado |
| --- | --- |
| Instalação e trabalho | Mesmo identificador de instalação. Trabalho marcado `interrupted` e recibo local ainda ausente. |
| Revogação | A pendência sobreviveu no SQLite. A repetição da solicitação retornou `200 acknowledged`. |
| Efeito gravado no destino | A retomada leu um checkpoint do PostgreSQL com `effect` como próximo nó. O trabalho concluiu com o ID original do recibo. |
| Intenção sem recibo | A conciliação retornou `unknown`. O encerramento normal da sessão foi recusado com HTTP 409. |
| Reenvio e inferência | O diário remoto registrou dois `send` originais, dois `lookup` e um único efeito. O registro das dez chamadas ao provedor controlado permaneceu idêntico após a retomada. |

O ensaio integrado passou em 89,15 s. Também passaram a regressão do conector com o launcher padrão em 50,78 s e os três testes do destino em 2,54 s. O tempo inclui toda a montagem do cenário e a limpeza e não representa uma medida de RTO. A evidência cobre o perfil lexical de laboratório, com dados fictícios, provedor controlado e volumes preservados no mesmo Windows. Reinício físico, restauração de volume e conectores empresariais ficam fora do escopo. [JUnit do reinício](../validation/aurora-local-restart/pilot-connector-restart.xml) · [JUnit do launcher padrão](../validation/aurora-local-restart/pilot-connector-restart-default.xml) · [JUnit do destino](../validation/observability-recovery/reference-destination-restart-regression.xml)
