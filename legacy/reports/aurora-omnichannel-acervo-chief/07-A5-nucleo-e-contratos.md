# A5 — Especificação técnica do núcleo compartilhado

Esta proposta fornece uma base para A6 em Node.js, TypeScript, PostgreSQL e TypeORM. Deriva da diretiva §§ 4–10 e 12–14, da análise A1, do ADR A2 aprovado pelo usuário e das restrições documentais A4. Os contratos externos e os cenários abaixo ainda precisam de validação. Não há implementação nem homologação alegada.

## Primeira fatia

Implementar um fluxo vertical de texto com adaptadores de canal e Contact Center simulados. A fatia recebe um evento autenticado, resolve empresa e sessão, preserva o original, deduplica, persiste a mensagem e a auditoria, decide o roteamento e registra uma intenção de saída. Um adaptador simulado registra o resultado e o histórico é recuperado por cursor. A mesma interface central deve servir aos adaptadores futuros de WhatsApp e Webchat.

A fatia inclui isolamento entre empresas, concorrência, inbox, outbox, recuperação e observabilidade desde o início. MBA real, transferência real, Socket.IO público e integração real com o Contact Center dependem dos contratos e acessos indicados nos bloqueios. O modelo prevê essas capacidades sem afirmar que o provedor as oferece na forma proposta.

```text
Adaptador autenticado → ReceiveInbound → transação PostgreSQL
  → inbox + original + mensagem + auditoria + outbox
  → RouteConversation → intenção de saída → outbox
  → adaptador simulado → resultado → histórico por cursor
```

## Módulos e interfaces

Os módulos são limites lógicos no serviço Tatodesk. `identity-config` resolve empresa, integração e credenciais a partir de contexto autenticado. `conversation` mantém sessões, participantes, mensagens e histórico. `orchestration` mantém controle, decisões e transferências. `attendance-adapter` integra o Contact Center, dono de fila, atribuição e atendimento humano. `channel-adapters` traduzem protocolos. `ai-tools` expõe IA substituível e operações de negócio autorizadas. `delivery` cuida de inbox, outbox, publicação e reconciliação. Nenhum módulo acessa diretamente o banco de outro domínio.

```ts
type Context = { tenantId: string; principalId: string; scopes: string[]; correlationId: string; causationId?: string };
type SessionKey = { tenantId: string; integrationId: string; channel: string; externalSessionId: string };
type Result<T> = Promise<T>;

interface ReceiveInbound { execute(ctx: Context, input: { key: SessionKey; providerEventId: string; originalRef: string; payload: unknown }): Result<{ sessionId: string; messageId?: string; duplicate: boolean }>; }
interface RouteConversation { execute(ctx: Context, input: { sessionId: string; messageId: string; expectedVersion: number }): Result<void>; }
interface RequestHandoff { execute(ctx: Context, input: { sessionId: string; target: 'HUMAN' | 'MBA'; idempotencyKey: string; expectedVersion: number }): Result<{ handoffId: string }>; }
interface RecordControlEvidence { execute(ctx: Context, input: { sessionId: string; handoffId?: string; evidenceId: string; observedControl: 'MBA' | 'PLATFORM' | 'UNKNOWN' }): Result<void>; }
interface RequestSend { execute(ctx: Context, input: { sessionId: string; idempotencyKey: string; content: unknown; expectedVersion: number }): Result<{ messageId: string; status: string }>; }
interface RecordSendResult { execute(ctx: Context, input: { messageId: string; evidenceId: string; status: 'ACCEPTED' | 'DELIVERED' | 'FAILED' | 'UNKNOWN'; providerMessageId?: string }): Result<void>; }
interface ReadHistory { execute(ctx: Context, input: { sessionId: string; cursor?: string; limit: number }): Result<{ items: unknown[]; nextCursor?: string }>; }
interface ChannelPort { send(input: { tenantId: string; integrationId: string; sessionId: string; messageId: string; idempotencyKey: string; content: unknown }): Result<{ status: 'ACCEPTED' | 'FAILED' | 'UNKNOWN'; providerMessageId?: string }>; }
interface AttendancePort { requestHandoff(input: { tenantId: string; sessionId: string; handoffId: string; idempotencyKey: string }): Result<void>; }
```

`Context` é produzido pela camada de confiança, não aceito do payload como autoridade. Interfaces usam DTOs de domínio e não importam TypeORM. A infraestrutura contém entidades ORM, transações, consultas parametrizadas e migrations SQL versionadas conforme A2. Erros inesperados retornam mensagem genérica e correlação, com detalhes apenas em logs restritos. As exceções de A2 ao padrão Tatodesk ainda requerem alinhamento com seus responsáveis.

## Identidade e modelo relacional

A identidade externa de sessão é a tupla `(tenant_id, integration_id, channel, external_session_id)`. O núcleo gera `session_id` interno globalmente único. A integração deve pertencer à empresa e o canal deve ser autorizado para essa integração. O mapeamento ao identificador do Contact Center é explícito e validado, inclusive quanto ao escopo real de unicidade. Telefone, ID externo ou coincidência de atributos não comprovam que identidades de canais distintos pertencem à mesma pessoa. Um vínculo de `customer` exige evidência confiável, origem e auditoria.

O esquema mínimo proposto usa `tenant`, `integration`, `conversation`, `channel_session`, `channel_identity`, `identity_link`, `message`, `provider_event`, `handoff`, `attendance_link`, `state_history`, `inbox`, `outbox` e `send_attempt`. Toda linha de negócio carrega `tenant_id`. `provider_event` conserva referência ao original protegido, hash, metadados de origem e timestamps. `message` conserva autoria, conteúdo normalizado, correlação e sequência por conversa.

As restrições abaixo ilustram o desenho SQL, com tipos e demais colunas definidos nas migrations. Chaves compostas impedem que uma referência válida de outra empresa seja associada por engano.

```sql
ALTER TABLE integration ADD CONSTRAINT uq_integration_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE conversation ADD CONSTRAINT uq_conversation_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE channel_session ADD CONSTRAINT uq_session_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE channel_session ADD CONSTRAINT uq_external_session
  UNIQUE (tenant_id, integration_id, channel, external_session_id);
ALTER TABLE channel_session ADD CONSTRAINT fk_session_integration
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integration (tenant_id, id);
ALTER TABLE channel_session ADD CONSTRAINT fk_session_conversation
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversation (tenant_id, id);
ALTER TABLE message ADD CONSTRAINT fk_message_session
  FOREIGN KEY (tenant_id, session_id) REFERENCES channel_session (tenant_id, id);
ALTER TABLE message ADD CONSTRAINT uq_message_sequence
  UNIQUE (tenant_id, conversation_id, sequence);
ALTER TABLE message ADD CONSTRAINT fk_message_conversation
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversation (tenant_id, id);
ALTER TABLE inbox ADD CONSTRAINT uq_inbox_event
  UNIQUE (tenant_id, integration_id, source, external_event_id);
ALTER TABLE outbox ADD CONSTRAINT uq_outbox_event UNIQUE (tenant_id, event_id);
```

A migration deve garantir também que a conversa da mensagem seja a mesma da sessão, por chave composta `(tenant_id, session_id, conversation_id)` referenciada em `channel_session`, e aplicar FKs de empresa equivalentes às demais tabelas. Campos das chaves de deduplicação são `NOT NULL`. Se uma fonte não fornecer ID estável, o adaptador precisa de estratégia comprovada para essa fonte e deve registrar a limitação. Um hash de payload sozinho não é garantia universal de identidade. Consultas sempre filtram empresa e recursos autorizados.

## Estados e transições

As dimensões são independentes e auditadas em transação com versão, estado anterior e novo, motivo, ator, evidência e correlação. A sessão segue `OPEN → CLOSED`. Reabertura exige uma decisão de produto e não está autorizada nesta proposta.

O atendimento interno segue `NONE → AI`, `NONE → QUEUED`, `AI → QUEUED`, `QUEUED → HUMAN` e `HUMAN → QUEUED` quando o Contact Center confirmar a mudança aplicável. `AI`, `QUEUED` ou `HUMAN` podem passar a `NONE` por encerramento confirmado ou cancelamento autorizado. O Contact Center é autoritativo para fila e atribuição. Eventos externos fora de ordem ou sem evidência suficiente não fazem o núcleo inventar uma atribuição.

O controle externo segue `MBA`, `PLATFORM` ou `UNKNOWN`. Uma solicitação de transferência não altera o controle confirmado. Evidência autenticada e correlacionada pode confirmar `MBA → PLATFORM` ou `PLATFORM → MBA`. Perda de confirmação, conflito ou resultado ambíguo leva a `UNKNOWN`. Só evidência reconciliada restaura um estado conhecido. Não existe envio automático pela aplicação enquanto MBA controla, ou enquanto controle e transferência estão incertos.

A transferência segue `NONE → REQUESTED → AWAITING_CONFIRMATION → CONFIRMED`. Falha comprovada pode produzir `FAILED`. Resultado incerto, conflito ou confirmação ausente no prazo produz `RECONCILIATION_REQUIRED`. Reconciliação por evidência pode concluir em `CONFIRMED` ou `FAILED`. Uma nova tentativa exige decisão explícita e segurança idempotente. Transferências concluídas permanecem no histórico e uma nova operação recebe novo ID.

```text
REQUESTED → AWAITING_CONFIRMATION → CONFIRMED
    └──────────────→ FAILED
                    └→ RECONCILIATION_REQUIRED → CONFIRMED | FAILED
```

O envio exige sessão aberta, controle confirmado `PLATFORM`, nenhuma transferência pendente ou incerta, autorização do ator e responsável compatível. A aplicação não envia durante `MBA`, `UNKNOWN` ou transição. Uma possível mudança de controle causada por envio, relatada em A4, exige validação antes do adaptador real. Encerramento bloqueia novas intenções e preserva histórico, sem tratar uma chamada externa como confirmação.

## Concorrência, idempotência e recuperação

Cada comando recebe chave idempotente no escopo de empresa, operação e recurso. Persistir chave, hash da solicitação e resultado na mesma transação do efeito local. Repetição com mesmo conteúdo devolve o resultado anterior. Mesma chave com conteúdo diferente gera conflito. Para eventos de entrada, inserir a chave de inbox com restrição única antes de produzir efeitos. Duplicatas não criam outra mensagem, transição, transferência ou intenção de envio.

Serializar decisões por sessão com bloqueio de linha PostgreSQL ou atualização condicional por `version`. A transação verifica estado e autorização, incrementa a versão e grava estado, auditoria e outbox juntos. A restrição única decide disputas de deduplicação. Um índice único parcial deve impedir mais de uma transferência ativa por sessão. O consumidor confirma o offset apenas após o commit. Uma falha após commit pode repetir a entrega, tratada pela inbox.

O publicador reivindica registros da outbox com lease recuperável, publica e marca sucesso após confirmação do broker. Falha entre publicação e marcação pode duplicar eventos. Consumidores deduplicam por `eventId`. Retentativas têm limite e backoff configuráveis, falhas permanentes vão para quarentena observável e replay autorizado preserva IDs e correlação. Alertas cobrem atraso, leases expirados, falhas e reconciliações pendentes.

Para ordem interna, alocar sequência monotônica por conversa sob o mesmo bloqueio e publicar Kafka com chave estável de empresa e conversa. O publicador deve preservar a sequência por chave, inclusive em retentativas. Consumidores detectam lacunas e não aplicam eventos posteriores dependentes antes de recuperar os anteriores. A ordem de chegada externa pode divergir da ocorrência, portanto guardar ambos os tempos e IDs, sem prometer reconstruir uma ordem que o provedor não comprova. Cursor de histórico usa sequência estável e paginação autorizada.

Uma intenção de envio é persistida antes da chamada externa, com ID e chave estáveis. `ACCEPTED` significa apenas aceite do provedor, não entrega. `DELIVERED` requer evidência própria. Timeout, desconexão ou falha após possível recepção significa `UNKNOWN`, não falha comprovada. Bloquear reenvio automático e reconciliar por consulta ou evento correlacionado. Se o provedor comprovar idempotência, uma repetição com a mesma chave pode ser permitida conforme seu contrato. Sem consulta nem idempotência verificável, manter o caso pendente para resolução operacional e registrar o risco de perda ou duplicação. Não se promete entrega externa exatamente uma vez.

## Contratos propostos

Kafka usa envelope versionado, sem pressupor nomes de tópicos existentes. `eventId` é estável em republicações. `correlationId` acompanha o fluxo e `causationId` identifica o evento ou comando imediato. `sequence` é por conversa. `originalRef` aponta para armazenamento protegido, sem publicar payload sensível em todos os tópicos.

```json
{
  "specVersion": "1.0",
  "eventId": "uuid",
  "type": "conversation.message.recorded.v1",
  "tenantId": "uuid",
  "integrationId": "uuid",
  "channel": "webchat",
  "conversationId": "uuid",
  "sessionId": "uuid",
  "sequence": 12,
  "occurredAt": "2026-01-01T00:00:00Z",
  "receivedAt": "2026-01-01T00:00:01Z",
  "correlationId": "uuid",
  "causationId": "uuid",
  "originalRef": "protected-reference",
  "data": { "messageId": "uuid", "author": "CUSTOMER" }
}
```

Socket.IO propõe `conversation.message.v1` e `conversation.resume.v1`, ambos com `version`, `requestId`, `sessionId`, `correlationId` e `data`. Mensagem de cliente inclui chave idempotente e conteúdo. Resposta inclui `messageId`, `sequence` e estado persistido. Retomada inclui cursor e retorna itens e próximo cursor. O ACK confirma apenas o processamento descrito na resposta, não entrega final ao destinatário. Salas usam identificador interno e ingresso autorizado no servidor. Compatibilidade com eventos e salas do Contact Center depende de validação.

Schemas são publicados e validados nas bordas. Adições opcionais compatíveis mantêm a versão principal. Remoção, mudança de significado ou campo obrigatório exige nova versão, coexistência e migração de consumidores. Rejeições são observáveis e não expõem dados sensíveis.

## Autorização de entrada e saída

Na entrada, o adaptador verifica a origem segundo o contrato real do canal, resolve a integração pela credencial confiável e deriva a empresa dessa configuração. Para Socket.IO, autentica o handshake e autoriza criação, ingresso, leitura e retomada para cada sessão. Para Kafka e integrações internas, autentica produtores e consumidores e verifica autorização por empresa e tipo de evento. `tenantId` recebido em payload é conferido contra o contexto, nunca usado sozinho como prova. O ACK ao provedor só ocorre após persistência durável ou conforme contrato validado.

Na saída, autenticar o ator ou serviço e verificar empresa, integração, sessão, permissão de enviar, vínculo com atendimento ou papel de IA e estado atual sob a mesma transação da intenção. Selecionar credenciais exclusivamente pela integração autorizada. Ferramentas de negócio repetem autorização na operação proprietária, com escopo mínimo e identidade delegada comprovada. A resposta do operador passa pelo pipeline oficial do canal. Logs e originais têm acesso restrito e política de retenção a definir.

## Cenários verificáveis para QA

- Duas empresas usam o mesmo ID externo. Criam sessões distintas e tentativas cruzadas de leitura, sala, escrita e envio são negadas. Uma FK composta rejeita associação cruzada.
- Duas entregas simultâneas do mesmo evento produzem uma mensagem e um efeito local. A mesma chave de comando com conteúdo alterado retorna conflito.
- Dois comandos concorrentes de envio ou handoff com a mesma versão não ultrapassam a precondição de estado nem criam duas transferências ativas.
- Um evento MBA observado é registrado com original e autoria quando comprovada, sem resposta automática. Controle desconhecido ou transferência pendente bloqueia saída.
- Uma chamada de handoff aceita sem confirmação não muda controle para confirmado. Evento duplicado, atrasado ou conflitante mantém auditoria e aciona reconciliação quando necessário.
- Timeout após possível envio produz `UNKNOWN` e não reenvia automaticamente. Aceite e entrega permanecem estados distintos. Uma evidência posterior correlacionada atualiza o estado uma vez.
- Derrubar consumidor antes do commit e depois do commit permite recuperação sem perda silenciosa nem efeito local duplicado. Derrubar publicador depois da publicação produz duplicata deduplicada pelo consumidor.
- Entregar eventos fora de ordem exercita detecção de lacuna. Reconexão por cursor retorna o histórico autorizado sem lacunas ou duplicatas visíveis.
- Aplicar migrations em banco vazio e atualizar versão anterior representativa, incluindo falha e recuperação. Validar que erro inesperado retorna mensagem genérica com correlação e não revela SQL ou payload.

Cada execução deve registrar evidência e distinguir adaptadores simulados de integração real. Estes são critérios propostos, não resultados de teste.

## Bloqueios externos

A integração real com MBA e 360dialog depende de conta elegível, credenciais e números de teste, confirmação de webhook, autoria, IDs, ordenação, `take`, `pass`, `release`, callbacks, semântica de envio e custos. A4 registra variantes de endpoint e versão ainda não resolvidas. O histórico disponível e os conectores também exigem confirmação.

O Contact Center exige confirmação das versões implantadas, contratos, autorização de backend, escopo de IDs e salas, estados, idempotência, histórico e comportamento de encerramento. Operações e responsáveis pelo padrão devem alinhar migrations, privilégios, backup, retenção e tratamento de erros conforme A2. Até essas confirmações, A6 pode iniciar a fatia simulada e seus testes, mas não declarar integração externa validada.
