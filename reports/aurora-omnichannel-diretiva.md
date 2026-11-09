# Execução da diretiva omnichannel integral

A primeira tentativa enviou o texto original ao `POST /api/jobs` do perfil consultivo. A API devolveu `409` com `Payload excedido`. A diretiva lida para a requisição tem 22.899 caracteres. A política consultiva também exige uma linha de até 600 caracteres, de modo que aumentar apenas o limite do corpo HTTP não permitiria a admissão. [Resposta da API](aurora-omnichannel-api-admissao.json)

Para avaliar a capacidade de dividir e entregar o trabalho, o ensaio de bancada envia a diretiva integral ao Chief com o catálogo do Aurora. Os diretores escolhem seus especialistas e consultas. A recuperação local usa o acervo misto de 13 fontes da rodada anterior. Só os trechos dos três PDFs autorizados entram nas chamadas de análise. As contribuições registram consultas, fontes recuperadas, IDs aceitos e páginas. A bancada usa o provedor e a recuperação do piloto, com um executor separado da API e do LangGraph.

O plano é avaliado pelos 12 itens da primeira missão. A fundação é avaliada pelo primeiro fluxo vertical executável. As fases posteriores têm critérios próprios para WhatsApp/MBA, Webchat, Contact Center e operação.

Na checagem externa, a 360dialog documenta a distinção entre `standby` e `messages`, informa que o encaminhamento de `messaging_handovers` ao webhook ainda está pendente e descreve limitações de contexto no retorno ao MBA e de leitura do proprietário atual. São evidências documentais. A confirmação para o número, conta e configuração de homologação exige chamadas ao provedor. [Webhooks do MBA](https://docs.360dialog.com/docs/mba/webhooks) · [Limitações conhecidas](https://docs.360dialog.com/docs/mba/meta-business-agent/known-limitations)

## Arquitetura e delegação

O Chief selecionou Tecnologia, Produto, Atendimento e Jurídico. Os diretores escolheram 11 especialistas ao todo. Cada diretoria produziu uma contribuição consolidada. A bancada registrou a escolha dos especialistas, mas não executou um trabalho independente para cada um. Foram dez chamadas na fase arquitetural, incluindo planejamento, delegação, contribuições e síntese.

| Diretoria | Especialistas escolhidos | Fontes citadas |
|---|---|---|
| Tecnologia | Tech Lead, Backend e QA | Contact Center, Fluxo e Resumo do MBA |
| Produto | Produto, UX e Design de Serviço | Contact Center e Fluxo |
| Atendimento | Suporte e Experiência do Cliente | Contact Center e Resumo do MBA |
| Jurídico | Privacidade, Riscos e Contratos | Contact Center e Resumo do MBA |

O parecer contém seções para os 12 itens da primeira missão. Propõe núcleo modular, estados explícitos, dados com escopo de tenant, contratos Kafka e Socket.IO, portas para os canais e backlog incremental. A estratégia do MBA ainda lista a validação oficial e a homologação como pendências. A equipe trabalhou com recortes do acervo, e a leitura integral dos documentos e dos padrões segue pendente.

[Plano do Chief](aurora-omnichannel-diretiva/01-plano.json) · [Arquitetura gerada](aurora-omnichannel-diretiva/03-arquitetura.md) · [Registro de execução](aurora-omnichannel-diretiva/04-execucao.json)

## Fundação executável e critérios da diretiva

A etapa de Engenharia recebeu a diretiva integral e o parecer. Gerou um núcleo TypeScript com SQLite local, uma suíte e instruções. SQLite foi escolhido para isolar o ensaio da infraestrutura proposta com PostgreSQL e Kafka. O contêiner executou o teste com Node 24, rede desativada e montagem do código somente para leitura. Passou um teste com várias asserções.

| Requisito do primeiro fluxo | Evidência desta rodada |
|---|---|
| Entrada, validação, normalização, tenant e sessão | Passou no teste local. O tenant já chega identificado. |
| Entrada bruta, histórico e resposta | Passou para a gravação da resposta simulada, com correlação e histórico preservado ao reabrir o banco. |
| Idempotência e isolamento | Passou para reenvio da entrada, uma única resposta gravada e consultas separadas por tenant. |
| Bloqueio durante o handoff e reentrega | Passou para o bot e o evento local. O caminho de resposta humana e a confirmação do provedor estão pendentes. |
| Contenção de escrita | Uma conexão mantendo a transação aberta fez o envio falhar com `database is locked`, sem criar saída. Após liberar o bloqueio, uma tentativa explícita gravou uma saída. |
| Processamento assíncrono e recuperação automática | Pendentes. O teste gerado usa SQLite síncrono no mesmo processo. A recuperação após contenção foi manual. |
| Envio de saída pelo canal e retorno ao MBA | Pendentes. O registro persistido representa a saída simulada. |
| Webchat em tempo real, Contact Center, Kafka e PostgreSQL | Contratos e desenho propostos. Implementação e testes integrados pendentes. |

A arquitetura avançou e o núcleo local pode ser executado, mas a fatia ainda fica aquém do primeiro marco integral da diretiva. O ensaio não demonstrou a entrega no canal nem concorrência entre bot e atendente. A rejeição da diretiva na API também permanece um bloqueio para validar a delegação e o cérebro de ponta a ponta no produto. A execução em bancada mostrou recuperação útil com distratores, com acesso ao modelo limitado a três fontes autorizadas.

[Código gerado](aurora-omnichannel-diretiva/vertical/core.ts) · [Teste gerado](aurora-omnichannel-diretiva/vertical/core.test.ts) · [Resultado do teste](aurora-omnichannel-diretiva/vertical/testes.log) · [Resultado da contenção](aurora-omnichannel-diretiva/vertical/contencao.log)

## Reteste pela API e evolução da fatia local

A sessão consultiva temporária agora aceita uma diretiva UTF-8 de até 32 KiB configurada no launcher. A API recebe apenas a referência SHA-256. A admissão rejeita referência divergente, uso sem diretiva configurada, mistura com uma pergunta livre e tentativa de imitar o vínculo pelo campo de pergunta. O launcher lê o arquivo no início e inclui seu conteúdo integral no plano do Chief. O registro associa o hash e a contagem de caracteres ao ID do trabalho.

No reteste, a API aceitou a referência. O Chief recebeu os 23.385 caracteres do texto, incluindo quebras de linha, e selecionou Tecnologia, Tech Lead e Backend. Três submissões com a mesma chave produziram um trabalho e um início de worker. O trabalho chegou à revisão em 27,22 s com zero citações. O perfil consultivo ainda não transforma a diretiva em buscas por requisito nem executa delegação de implementação. O campo `goal` do coletor nessa rodada conservou o valor padrão do roteiro. A referência, o log de despacho e o campo `unanswered` identificam a tarefa que de fato foi admitida. O coletor agora lê o objetivo do estado da API.

A fatia local ganhou retentativa limitada de escrita, resposta humana após confirmação e registro de saída simulada. Dois testes passaram em contêiner sem rede. No cenário novo, uma segunda conexão manteve o banco bloqueado, bot e atendente tentaram responder, o teste liberou o bloqueio e confirmou a transferência. O bot foi recusado e a resposta humana foi registrada uma vez. Reentregar a confirmação e repetir a resposta preservou o único registro, conferido após reabrir o banco. O teste cobre recuperação de contenção no mesmo processo, com saída simulada no SQLite.

TypeScript, Ruff e seis verificações controladas da admissão passaram. O próximo marco do Aurora é converter a diretiva em tarefas com busca e execução por responsável. No produto de mensageria, os próximos testes devem cobrir queda do consumidor e saída assíncrona antes da homologação do canal.

[Execução da API](aurora-omnichannel-api-diretiva.json) · [Teste da fatia atualizada](aurora-omnichannel-diretiva/vertical/testes-retomada.log)

## Consultas por frente na API

O Chief agora inclui de duas a quatro consultas por diretoria no plano da diretiva. Cada especialista e diretor recebe os candidatos da sua frente. A síntese reúne até 24 candidatos, preservando espaço para consultas distintas, e o verificador lista as perguntas que ficaram sem suporte. O parecer mantém o hash da diretiva, as perguntas e as citações canônicas.

A primeira rodada falhou entre a inferência do Chief e a gravação do plano. Como a saída de erro do worker era descartada pela API, a causa específica dessa execução não ficou disponível. O worker passou a persistir o diagnóstico local e a API passou a registrar a razão de uma rejeição na validação do plano. O erro não se repetiu.

O reteste chegou à revisão humana em 72,48 s. O Chief selecionou Tecnologia e Diretoria Executiva. Tech Lead, Backend e Gestão de Projetos executaram suas consultas, e os dois diretores consolidaram. As sete perguntas cobriram áreas diferentes, mas algumas agruparam vários fatos, como contratos Kafka e Socket.IO, IA, idempotência e observabilidade. O parecer trouxe uma citação do Contact Center, p. 13, e o verificador listou seis perguntas como lacunas. Essa medição é por pergunta agrupada. Uma citação pode sustentar parte da sétima pergunta.

As submissões repetidas conservaram um trabalho e uma inicialização de worker. Seis testes de regressão do piloto consultivo passaram. O resultado demonstra delegação de análise e recuperação por frente. A escolha dos especialistas continua no plano do Chief. A execução de entregas de engenharia e a cobertura da diretiva completa ainda precisam de um fluxo próprio.

[Primeira tentativa](aurora-omnichannel-api-requisitos.json) · [Reteste e consultas por agente](aurora-omnichannel-api-requisitos-reteste.json)

## Parecer por requisito

A API passou a entregar um registro por pergunta, com conclusão, estado e IDs de evidência validados. Propostas de arquitetura, testes pendentes e perguntas sem resposta são registrados separadamente. A primeira execução chegou à revisão em 63,55 s com quatro perguntas e quatro citações. O verificador marcou três perguntas como documentadas, mas duas marcações exigem correção. Um trecho sobre um tópico Kafka não comprova os contratos Kafka e Socket.IO. Uma transição do Contact Center também não confirma o comportamento do provedor.

O contrato agora inclui o estado `partial` e mantém esses requisitos na lista de lacunas. O verificador recebe o título da fonte e deve distinguir um fluxo interno de uma confirmação do provedor. Seis testes locais passaram após esse ajuste, incluindo a preservação da citação parcial sem fechar a lacuna. A revisão automática de execução bloqueou a repetição com o acervo real porque identificou envio potencial de conteúdo da diretiva e dos PDFs ao provedor externo sem autorização específica para esse conjunto. O resultado real anterior não valida o ajuste posterior.

[Primeiro parecer estruturado pela API](aurora-omnichannel-api-parecer-por-requisito.json)

### Reteste com escopo autorizado

Após a autorização explícita, a revisão automática recusou o preparador de acervo misto por risco de incluir conteúdo adicional. O reteste executado usou uma lista fechada de páginas dos três PDFs autorizados e a diretiva integral. A API chegou à revisão em 61,94 s, sem falhas registradas, com quatro citações.

| Requisito | Resultado |
|---|---|
| Contratos de eventos e interfaces | Parcial. Encontrou o evento de criação de atendimento. O esquema e os contratos de interface ficaram abertos. |
| Estados e transições | Parcial. Encontrou `PAUSED`, `ACTIVE` e a mudança de tipo de sessão. A máquina completa ficou aberta. |
| Transferência de controle do MBA | Parcial. O resumo menciona a transferência, com os mecanismos oficiais em aberto. |
| Garantias de execução e recuperação | Sem resposta documental. |

O verificador conservou as quatro citações e manteve os quatro requisitos na lista de lacunas. Os enunciados escolhidos diferiram da rodada anterior, e o acervo foi restringido à lista autorizada. O resultado confirma que a API é capaz de preservar evidência parcial e lacunas nessa configuração. Uma comparação controlada da precisão exigiria congelar perguntas e candidatos.

[Registro do reteste autorizado](aurora-omnichannel-api-parecer-por-requisito-reteste.json)

### Comparação com perguntas e trechos fixos

O teste isolou o verificador com as quatro perguntas e as quatro citações do primeiro parecer. Nas duas versões, usou o mesmo modelo, a mesma ordem dos candidatos e o mesmo contrato de validação. A versão atual combina a categoria parcial, a regra de cobertura integral e o título da fonte. A comparação mede o efeito conjunto desses ajustes.

Com os hashes integrais, uma dupla concluiu e a outra foi rejeitada nas duas versões por referências fora da lista autorizada. O diagnóstico registra a rejeição. Como a resposta bruta não foi preservada, a causa da referência inválida não foi confirmada. O ensaio seguinte apresentou as mesmas citações como `E1` a `E4` nas duas versões e mapeou os rótulos de volta aos IDs canônicos após a validação. As quatro chamadas passaram, com o mesmo resultado nas duas repetições.

| Pergunta | Versão anterior | Versão atual |
|---|---|---|
| Responsabilidades e fluxos de referência | Documentado | Parcial |
| Contratos Kafka e Socket.IO | Documentado | Parcial |
| Estados e transições documentados pelo provedor | Documentado | Sem resposta |
| Garantias de idempotência e recuperação | Sem resposta | Sem resposta |

Os trechos indicam responsabilidades pontuais e um tópico, com os contratos completos em aberto. Os estados citados descrevem o Contact Center interno. A amostra cobre quatro perguntas, com duas repetições válidas por versão no ensaio de rótulos curtos. Os rótulos foram usados somente no ensaio isolado.

[Comparação com hashes](aurora-omnichannel-verificador-comparacao.json) · [Comparação com rótulos curtos](aurora-omnichannel-verificador-comparacao-ids-curtos.json)

### Rótulos curtos pela API

O verificador da diretiva recebe rótulos locais como `E1`. A API valida os rótulos contra os candidatos da chamada e converte cada referência para o ID canônico antes de gravar o parecer. O teste da API com provedor simulado conferiu a conversão e a preservação da lacuna. O teste do contrato rejeitou um rótulo desconhecido e um hash apresentado no lugar do rótulo.

A primeira execução com os PDFs autorizados parou no planejamento com `provider_nonzero_exit`, antes do verificador. A repetição em nova sessão chegou à revisão em 83,19 s, sem falhas registradas. O parecer apresentou 11 requisitos, dois com evidência parcial e nove sem resposta. As três referências dos requisitos correspondiam a IDs canônicos de 64 caracteres presentes nas citações do parecer. As três submissões com a mesma chave produziram um trabalho e uma inicialização de worker. O ensaio cobre a integridade da referência no fluxo da API. A cobertura documental da diretiva continua parcial.

[Primeira tentativa](aurora-omnichannel-api-rotulos-curtos.json) · [Reteste pela API](aurora-omnichannel-api-rotulos-curtos-reteste.json)
