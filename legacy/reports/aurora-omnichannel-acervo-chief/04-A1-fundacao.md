# Análise arquitetural e rastreabilidade — A1

## Base e limites da evidência

Esta análise usa a diretiva e os achados fornecidos de D1–D7. As páginas citadas identificam os documentos de origem; não houve leitura independente dos PDFs, inspeção do código, consulta às APIs oficiais ou execução de testes nesta tarefa. As referências descrevem versões e comportamentos relatados, não recursos comprovadamente disponíveis no novo projeto. A diretiva exige desenvolvimento do zero, núcleo compartilhado e reutilização do Contact Center existente por contratos validados, sem copiar automaticamente sua topologia (diretiva §§ 2, 7, 10 e 14).

- **D1 — referência funcional:** front-end de conhecimento MBA e contratos GraphQL observados; regras de servidor não verificadas (D1 pp. 1, 3, 6, 12–13, 16).
- **D2 — referência funcional:** workspace e Contact Center observados em versões distintas; equivalência com ambiente implantado pendente (D2 pp. 1, 3, 5–7, 25).
- **D3 — referência funcional:** integração Reclame Aqui, útil para cenários de falhas, limites e tickets; não é requisito automático deste produto (D3 pp. 3–7, 10, 12).
- **D4 — referência funcional:** fluxo de mensageria existente, detalhado sobretudo para WhatsApp; serviços e tópicos não são presumidos no novo projeto (D4 pp. 3–4, 6–11, 13–14).
- **D5 — padrão de backend REST, versão de trabalho:** separação de camadas, validação e segurança; conflitos com escolhas da diretiva precisam de decisão registrada (D5 pp. 1, 8–11, 20, 25, 27–28, 31, 44).
- **D6 — inventário funcional:** aponta áreas de filas, permissões e relatórios para investigação, sem regras ou aceite suficientes (D6 pp. 1–3, 7–12, 21).
- **D7 — resumo de terceiro:** elegibilidade, configuração e capacidades MBA relatadas; não substitui documentação oficial atual nem comprova contratos ou testes (D7 pp. 3–7, 9).

## Matriz de requisitos e aceite

Os critérios abaixo são testes propostos para demonstrar os requisitos; seu resultado está **pendente**, inclusive quando houver mock. A numeração A corresponde aos 13 itens da diretiva § 12.

| ID | Requisito e fonte | Evidência de referência | Critério verificável proposto |
|---|---|---|---|
| A1 | Processar e registrar mensagem WhatsApp (§§ 3, 4.1–4.2, 12) | Entrada, normalização e armazenamento relatados em D4 pp. 3–4, 8–10 | Webhook autenticado de ambiente real gera mensagem normalizada e payload original recuperáveis, associados à empresa, integração e sessão; correlação liga entrada ao resultado. |
| A2 | Persistir mensagens observadas do MBA sem resposta duplicada (§§ 5, 12) | Capacidades gerais em D7 pp. 3–7; eventos específicos não definidos | Com MBA no controle, eventos realmente disponibilizados pelo provedor são registrados e nenhuma resposta concorrente é emitida; duplicatas não repetem efeitos. |
| A3 | Encaminhar conversa ao humano (§§ 4.3–4.4, 5, 7, 12) | Fluxo de atendimento e transições relatados em D2 pp. 9–11; D4 pp. 9–11 | Solicitação cria transferência pendente, preserva histórico e encaminha ao Contact Center; conclusão do controle depende de evidência externa suportada, não do início da chamada HTTP. |
| A4 | Atendente recebe histórico disponível e responde pelo WhatsApp (§§ 4.5, 7, 12) | Sala e evento do workspace em D2 pp. 13–17; saída em D4 pp. 5–6, 11 | Operador autorizado consulta histórico observado e envia resposta pelo pipeline oficial, com persistência e estado de entrega correlacionados. |
| A5 | Devolver controle ao MBA (§§ 5, 7, 12) | Resumo de transferência em D7 pp. 3–4; mecanismo não especificado | Retorno usa mecanismo oficial confirmado; estados pendente, confirmado e inconsistente são auditáveis; falha ou ausência de confirmação não é apresentada como sucesso. |
| A6 | Iniciar e manter conversa Webchat (§§ 4.1, 6, 12) | Entrada Socket.IO referenciada em D4 pp. 12–13 | Cliente autenticado cria ou recupera sessão, troca texto e consulta histórico persistido, sempre no escopo da empresa. |
| A7 | Rotear Webchat para IA ou humano (§§ 6–7, 12) | Atendimento humano como referência em D2 pp. 9–11 | Testes demonstram roteamento e transferência controlada com interface de IA independente do MBA, sem respostas simultâneas dos dois responsáveis. |
| A8 | Recuperar mensagens após reconexão (§§ 6, 12) | Join, leave e reconexão do workspace relatados em D2 pp. 13–14 | Após desconexão, cliente autorizado retoma sessão e recupera mensagens faltantes por cursor, sem lacunas ou duplicatas visíveis. |
| A9 | Eventos duplicados sem efeitos indevidos (§§ 4.3, 9, 12) | Fluxo assíncrono de referência em D4 pp. 3–4 | Reentregar entrada, comando e resultado não cria segunda mensagem, transferência ou envio; testes incluem concorrência. |
| A10 | Falha de consumidor sem perda silenciosa (§§ 9, 12–13) | Processamento assíncrono relatado em D4 pp. 3–4, 15 | Interromper consumidor antes e depois da persistência permite recuperação ou tratamento explícito e observável, sem perda silenciosa; efeitos externos são reconciliados. |
| A11 | Isolar dados e credenciais entre empresas (§§ 1, 9, 12) | Identidades no Portal em D2 pp. 5–7; segurança em D5 pp. 23, 30–31 | Testes negativos entre duas empresas impedem leitura, escrita, conexão, envio e uso de credenciais cruzadas; identidade confiável não vem apenas do payload. |
| A12 | Compartilhar lógica central entre canais (§§ 3, 10.2, 12–13) | Responsabilidades de referência em D4 pp. 3–4, 9–11 | Os dois adaptadores exercitam os mesmos contratos, sessão, ownership, roteamento, histórico e idempotência; diferenças de protocolo permanecem nos adaptadores. |
| A13 | Demonstrar fluxo vertical completo antes de expandir (§§ 10.4, 11–12) | Padrões de camadas em D5 pp. 8–11 | Teste reproduzível percorre recebimento, validação, identificação, persistência, roteamento, processamento, envio, resultado, histórico e rastreabilidade; relatório distingue mocks de integrações reais. |

Requisitos transversais adicionais: registrar participantes, canal, transferências e identidades vinculadas apenas com evidência confiável; disponibilizar operações de negócio comuns com autenticação e autorização; preservar extensibilidade para mídia e novos canais; documentar decisões, métricas, concorrência, ordem e recuperação (diretiva §§ 4.2–4.5, 6, 9–10, 13–14). Testes de isolamento, vinculação indevida de identidades, autorização das ferramentas, ordenação e evolução de contratos demonstram esses requisitos; execução pendente.

## Contact Center existente: mapa e pontos de extensão

**Evidência relatada.** O workspace autenticado usa o `contact-center-portal` como BFF GraphQL, que encaminha `accountID` e `userID` derivados do token ao núcleo REST `contact-center`; este cuida de atendimentos, jornada, configuração e persistência. A fachada externa tem autenticação própria, mas seus internos não foram examinados (D2 pp. 5–7). A criação registra `IDLE → WAITING`, configuração e distribuição quando aplicável; iniciar, pausar, transferir e finalizar mantêm estados e histórico (D2 pp. 9–11, 15–16). A distribuição automática usa Kafka, capacidade e departamentos (D2 pp. 19–20).

No fluxo de referência, `message-human` chega ao `cc-message-consumer`, que envia `tatodesk.conversation_client_to_agent:utter` ao socket; o workspace recebe `tatodesk.message:response` na sala `room:attendance:<sessionID>`. A resposta do operador usa `tatodesk.conversation_agent_to_client:utter`; o socket publica no tópico de saída do canal, sem passar pelo consumer de entrada (D4 pp. 5–6, 11; D2 pp. 13–17). A interface usa atualização otimista; isso não comprova entrega ao cliente (D2 pp. 16–17).

**Proposta.** Reutilizar workspace, atendimento, fila e distribuição existentes por uma camada de integração com o novo núcleo. Ela traduz comandos de criação e encerramento, mensagens, autoria, histórico e estados, preservando o pipeline oficial de saída do novo canal. O núcleo novo permanece dono de conversa, sessão omnichannel, ownership externo, histórico e auditoria; o Contact Center permanece dono do atendimento humano, fila, atribuição e experiência do operador. Definir qual sistema é autoritativo por campo e reconciliar eventos, sem acesso direto ao banco de outro domínio (D5 pp. 27–28). Não substituir o Contact Center nem presumir que seus contratos sejam suficientes sem validação.

**Verificação pendente.** Identificar chamadores e contratos reais de `createAttendance*`, `startAttendance`, transferência, finalização e retorno ao bot; confirmar versões implantadas, autenticação, autorização de backend, IDs, eventos, regras de estado, histórico, arquivos e comportamento na reconexão. A fonte aponta que regras observadas no front podem não estar repetidas nos casos de uso examinados; não tratá-las como proteção garantida (D2 pp. 15–18, 24–25). Confirmar também o comportamento de encerramento automático e seus efeitos, pois a referência relata cancelamento após 24 horas em determinados estados (D2 pp. 21–23).

## Fluxos propostos

**Entrada**

```text
WhatsApp webhook / Webchat Socket.IO
  → autenticar origem e identificar empresa + integração
  → preservar evento original → validar e normalizar → deduplicar
  → localizar sessão pelo escopo do canal → persistir e auditar
  → avaliar estado e ownership
      ├─ MBA no controle: observar e registrar; sem resposta concorrente
      ├─ IA Webchat: invocar interface de IA → saída
      └─ humano / transferência: integrar Contact Center → workspace
```

**Saída**

```text
IA Webchat / operador autorizado / comando de negócio
  → validar empresa, sessão, responsável e estado
  → registrar intenção idempotente → adaptador do canal
  → provedor WhatsApp ou Socket.IO → registrar resultado / status
  → atualizar histórico e observabilidade → reconciliar falhas incertas
```

Os diagramas são propostas, não evidência de implementação. Eventos MBA, confirmação de controle e semântica de envio dependem de validação oficial. Com resultado externo desconhecido, reconciliar antes de reenviar quando o provedor permitir; não prometer exatamente uma entrega externa sem garantia verificável.

## Limites de domínio e modelo inicial

| Domínio ou adaptador | Responsabilidade proposta | Limite e contrato |
|---|---|---|
| Identidade e configuração | Empresa, integração, credenciais e autorização | Identidade de empresa derivada de contexto autenticado; segredos segregados. |
| Conversação compartilhada | Mensagem, sessão, histórico, idempotência e auditoria | Independente de 360dialog, Socket.IO e modelo de IA. |
| Orquestração e handoff | Roteamento e transições de ownership | Coordena processos; não incorpora protocolo, regras de fila ou ferramentas de negócio. |
| WhatsApp/MBA e Webchat | Protocolos, autenticação, transformação e envio | Traduzem contratos internos; capacidade externa precisa ser confirmada. |
| Contact Center existente | Atendimento, fila, operador e workspace | Integração por API/eventos autorizados; não compartilha banco diretamente. |
| IA e ferramentas de negócio | Interface substituível de IA Webchat e operações autorizadas comuns | Conectores MBA dependem de suporte oficial; regras de negócio permanecem no domínio proprietário. |

Modelo inicial proposto: `tenant`, `integration`, `customer`, `channel_identity`, `conversation`, `channel_session`, `message`, `provider_event`, `handoff`, `attendance_link` e `outbox`; todas as entidades pertinentes levam escopo de empresa. `customer` só agrupa identidades após vínculo confiável. Histórico mantém autoria cliente/MBA/IA própria/humano, eventos originais, timestamps e correlação (diretiva §§ 4.2, 4.5, 10.3). Retenção, criptografia, índices e política de dados sensíveis dependem de definição.

**Colisão de sessão.** Uma chave baseada apenas em `sessionID`, número de telefone ou identificador externo pode coincidir entre canais, integrações ou empresas e entregar histórico ou mensagens à conversa errada. A sala existente usa somente `sessionID` no nome relatado (D2 pp. 13–14); isso, por si só, não demonstra colisão nem ausência de autorização. Proposta: gerar ID interno globalmente único para cada sessão de canal e impor unicidade composta por empresa, integração, canal e identificador externo; mapear explicitamente esse ID ao `sessionID` aceito pelo Contact Center e autorizar cada ingresso em sala por empresa e atendimento. Confirmar escopo e garantias reais dos IDs e salas antes de integrar. Identidades de WhatsApp e Webchat só se unem mediante mecanismo confiável, nunca por coincidência.

**Estados propostos.** Manter dimensões separadas: ciclo da sessão (`OPEN`, `CLOSED`), atendimento interno (`AI`, `QUEUED`, `HUMAN`, `NONE`), controle externo (`MBA`, `PLATFORM`, `UNKNOWN`) e transferência (`NONE`, `REQUESTED`, `AWAITING_CONFIRMATION`, `CONFIRMED`, `FAILED`, `RECONCILIATION_REQUIRED`). Transições são persistidas com versão, motivo, ator e correlação; concorrência usa controle otimista ou bloqueio transacional. Uma solicitação HTTP não confirma transferência. A correspondência desses estados com o provedor e o Contact Center permanece pendente.

## Contratos iniciais a confirmar

| Contrato | Proposta ou referência | Pendente |
|---|---|---|
| Envelope interno | `eventID`, versão, empresa, integração, canal, conversa, sessão, ID do provedor, participante, tipo, conteúdo, referência ao original, ocorrência, recebimento e correlação | Esquema, compatibilidade e política de dados sensíveis. |
| Kafka | Eventos versionados e chave de partição por empresa e conversa; outbox transacional proposta para publicação recuperável | Tópicos, retenção, consumidores, retentativas, tratamento de falhas e ordem; nomes de D4 pp. 7–8, 10 são referência, não contratos do projeto. |
| Socket.IO | Autenticação no handshake, autorização de sala, IDs de mensagem, confirmação e cursor de recuperação | Compatibilidade com eventos e salas existentes de D2 pp. 13–17; sem assumir que confirmação de socket equivale a entrega final. |
| Contact Center | Comandos de atendimento, vínculo de sessão, mensagens com autor, histórico e eventos de estado | Schemas, versionamento, idempotência, permissões e reconciliação nas APIs e eventos reais de D2 pp. 9–18 e D4 pp. 5–6, 11. |
| 360dialog/MBA | Adaptador para webhooks, eventos e controle | Rotas, assinatura, campos, disponibilidade, transferência, retorno, histórico, erros e cobrança nas fontes oficiais atuais; D7 pp. 3–7 não especifica contratos completos. |
| IA e operações | Interface de geração e ferramentas com contexto de empresa e autorização explícita | Capacidade real de conectores MBA e autenticação delegada; D1 pp. 10–11, 14 relata apenas comportamento do cliente. |

## Lacunas e decisões

1. **Provedor:** validar elegibilidade, ativação, preços, eventos standby, autoria MBA, handoff, confirmação, retorno, contexto e conectores em documentação oficial e ambiente real. D7 relata limitações e condições de rollout que podem ter mudado (D7 pp. 2, 4–8).
2. **Contact Center:** confirmar contratos e implantação, autorização no servidor, semântica de estados, identidade e compatibilidade com sessões multicanal; D2 combina versões e deixa pontos não lidos (D2 pp. 1, 3, 18, 24–25).
3. **Padrões:** a diretiva indica Prisma como referência inicial, enquanto D5 prescreve TypeORM para serviço comum (D5 pp. 6, 12, 27–28, 40, 42). Registrar decisão com responsáveis pelos padrões; não presumir equivalência. O guia também pede schema manual sem migrations (D5 pp. 27–28): decidir processo seguro e reproduzível de evolução.
4. **Erros e confiança:** D5 pede `error.message` original e também proíbe exposição de detalhes internos (D5 pp. 20, 25, 31). Propor mensagens externas sanitizadas e detalhes restritos em logs; confirmar adequação ao padrão. Definir propagação autenticada de empresa e usuário e proteção de webhook, não especificada pelo guia (D5 pp. 22–23, 30–31).
5. **Escopo adjacente:** conhecimento MBA, upload e GraphQL de D1 exigem confirmação de backend; a ausência do botão de upload tem causa desconhecida (D1 pp. 8, 12, 16). D3 e D6 oferecem cenários e inventário, não autorização para adicionar Reclame Aqui, dashboards ou outros módulos ao escopo (D3 pp. 3–7; D6 pp. 7–12).
6. **Operação:** definir retenção, SLOs, limites de retentativa, filas de falha, reconciliação, disponibilidade, custos e critérios de separação física. Nenhuma tecnologia adicional deve entrar sem justificativa registrada (diretiva §§ 9–10.5).

## Backlog incremental por dependência

| Ordem | Entrega e dependências | Aceite da etapa |
|---|---|---|
| 0 | Confirmar contratos do Contact Center e capacidades oficiais MBA; resolver decisões de padrões e confiança; documentar limites e riscos | Matriz de contratos e ADRs com pendências e responsáveis; sem alegar validação real antes da evidência. |
| 1 | Núcleo mínimo modular e primeiro fluxo vertical com adaptadores de teste | A13 demonstrado por testes automatizados; histórico e correlação consultáveis. |
| 2 | Persistência confiável, isolamento, idempotência e recuperação sobre o fluxo vertical | A9–A11 demonstrados com duplicidade, concorrência, falha e duas empresas; ampliar conforme integração real. |
| 3 | Adaptador WhatsApp e observação MBA, após validação do provedor | A1–A2 demonstrados em ambiente real, com limitações documentadas. |
| 4 | Integração ao Contact Center existente e handoff seguro, conforme contratos confirmados | A3–A5 demonstrados incluindo falha e confirmação possível; histórico e saída oficial verificados. |
| 5 | Webchat Socket.IO e interface de IA independente | A6–A8 e A12 demonstrados, incluindo reconexão e transição para humano. |
| 6 | Ferramentas de negócio compartilhadas e endurecimento operacional | Autorização por empresa e agente, testes de integração, falhas, ordem e observabilidade; validação real separada de mocks. |

A ordem detalhada pode ajustar dependências técnicas, preservando a primeira entrega vertical antes da expansão e os critérios de aceite da diretiva §§ 10.4, 11–12.