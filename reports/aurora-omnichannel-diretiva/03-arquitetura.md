# Plano arquitetural — primeira missão

## Evidências e limites

- **Requisito:** a diretiva, §§ 4–10 e 14, determina núcleo compartilhado, isolamento por empresa, handoff seguro e primeira entrega vertical. A diretiva foi fornecida sem paginação; as referências a ela usam seção.
- **Documentado em referências:** sessão e mensagem são entidades distintas no sistema de referência [fluxo, p. 12]; seu handoff altera o tipo de sessão entre ML_MODEL e HUMAN [fluxo, p. 12]. Essa alteração não comprova transferência de controle no provedor. O Contact Center de referência prevê atendimento finalizado [contact, p. 9] e verifica permissões e estado em operações [contact, p. 15]. São descrições de outro sistema, não de componentes existentes neste projeto.
- **Documentado em resumo:** o MBA é descrito como agente para WhatsApp [mba, p. 3]; o resumo menciona ativação, termos, pagamento e configuração de conhecimento e conectores [mba, p. 4], além de limitações em transferência, cobrança e arquivos [mba, p. 8]. Isso não confirma capacidades atuais das APIs oficiais.
- **Proposto:** arquitetura, nomes, contratos, estados e critérios técnicos abaixo são decisões iniciais de engenharia, sujeitos aos padrões integrais e à validação.
- **Exige teste:** nenhuma integração, comportamento de provedor, código ou teste real foi executado nesta análise. Mocks demonstrarão apenas o comportamento do sistema sob as hipóteses configuradas.

## 1. Componentes e limites

Proposta: um repositório e uma aplicação modular Node.js/TypeScript, PostgreSQL com Prisma, Kafka e Socket.IO. Inicialmente, API e worker podem ser processos do mesmo artefato, com módulos compartilhados e implantação independente apenas se necessária. Não usar NestJS ou FastAPI [diretiva, §§ 8 e 10].

```text
WhatsApp/360dialog -> adaptador webhook --+
Webchat/Socket.IO  -> adaptador tempo real +-> ingestão -> núcleo de conversas
Contact Center     -> API/workspace ------+                 |
                                                          +-- sessões/ownership/handoff
                                                          +-- roteamento/histórico
                                                          +-- saída -> adaptador do canal
                                                          +-- IA Webchat -> interface IA
                                                          +-- ferramentas de negócio
                                                          |
                                               PostgreSQL + outbox -> Kafka -> workers
```

O núcleo decide estados, autorização de envio, idempotência e histórico; adaptadores traduzem protocolos e erros. IA, integrações empresariais e Contact Center usam interfaces de aplicação, sem acesso direto às regras internas. Separar fisicamente somente mediante ADR que demonstre necessidade de escala, isolamento de falhas ou implantação e compare custo operacional com a alternativa modular. Kafka é previsto pela diretiva; não adicionar outro broker ou banco sem justificativa.

## 2. Fluxos de entrada e saída

```text
Entrada: origem -> autenticar/validar -> identificar tenant e integração
 -> preservar original -> normalizar/deduplicar -> transação: mensagem + sessão + outbox
 -> publicar Kafka -> consumidor idempotente -> verificar estado/ownership -> rotear
 -> IA própria | fila humana | apenas observar MBA -> histórico e auditoria

Saída: comando autorizado -> verificar versão e controle -> persistir intenção + outbox
 -> worker -> adaptador do canal -> registrar aceitação/erro/incerteza
 -> evento posterior de entrega, quando disponível -> atualizar histórico e notificar cliente
```

A identificação do tenant vem de credencial/configuração autenticada, não de um campo confiado ao cliente. Persistência e outbox ocorrem na mesma transação; publicação e consumo são pelo menos uma vez, com deduplicação persistente. Ordenar por conversa e tratar eventos atrasados sem regredir estados de entrega. Resultado de envio externo incerto entra em reconciliação; não reenviar cegamente. Sem idempotência ou consulta confiável do provedor, não é possível garantir ausência absoluta de envio duplicado após timeout.

## 3. Máquina de estados e transições

Proposta: separar **atendimento** de **controle externo**. Atendimento: OPEN, HANDOFF_PENDING, QUEUED, HUMAN_ACTIVE, RETURN_PENDING, CLOSED, EXCEPTION. Controle: AI, HUMAN, UNKNOWN; AI distingue MBA e IA própria pelo responsável. Uma sessão também registra responsável interno, versão, motivo e evidência.

```text
OPEN/AI -> HANDOFF_PENDING/AI ou UNKNOWN -> QUEUED/HUMAN -> HUMAN_ACTIVE/HUMAN
             | timeout/falha -> EXCEPTION/UNKNOWN                 |
             |                                                   +-> CLOSED/HUMAN
             +-- confirmação aplicável                           +-> RETURN_PENDING/HUMAN ou UNKNOWN
                                                                      | confirmação -> OPEN/AI
                                                                      + falha/timeout -> EXCEPTION/UNKNOWN
```

Solicitar handoff persiste intenção e bloqueia respostas concorrentes antes da chamada externa. A confirmação aplicável, não o início da chamada HTTP, permite avançar; ausência ou ambiguidade mantém pendência ou exceção e exige reconciliação operacional. No Webchat, o controle interno pode ser confirmado atomicamente; no WhatsApp, evidência e mecanismo dependem do provedor. Atribuição humana usa comparação de versão para impedir dois atendentes assumirem. Conclusão e retorno à IA são ações distintas. Toda transição registra ator, versão anterior/nova, horário, correlação, motivo e evidência. Confirmações atrasadas são reconciliadas contra a operação e versão correspondentes.

## 4. Modelo de dados inicial

Todas as entidades de domínio têm tenantId e chaves/índices compostos que impedem referências entre tenants. PostgreSQL é a fonte transacional; Prisma implementa acesso com escopo obrigatório.

- Tenant e Integration: canal, configuração e referência segregada à credencial, nunca o segredo em eventos.
- Customer e ChannelIdentity: identificador por integração/canal; vínculo ou desvínculo auditado, com evidência e autorização. Nunca unir WhatsApp e Webchat anônimo por suposição.
- Conversation e Session: cliente opcional, canal, estado, controle externo, responsável interno, versão e timestamps; uma sessão pertence a uma conversa.
- Participant e Message: autor conhecido ou desconhecido, tipo, conteúdo normalizado, providerMessageId, clientMessageId, timestamps, estado de entrega e sequência interna. Restrição única por tenant, integração e identificador externo quando presente.
- RawEvent: payload original protegido, origem, identificador e referência à mensagem; retenção própria. ConversationEvent/Handoff: transições, evidência, ator e correlação; histórico observado deve sinalizar lacunas.
- IdempotencyRecord, Outbox e ConsumerReceipt: chave, resultado/estado, timestamps e restrições únicas; Assignment registra fila e atendente.

Índices por tenant/conversa/sequência suportam paginação e recuperação. Definir retenção, exclusão, anexos e backups com Jurídico; conteúdo bruto e logs não devem expor segredos.

## 5. Contratos Kafka e Socket.IO

**Kafka — proposta v1.** Tópicos lógicos `conversation.events.v1` para fatos e `delivery.commands.v1` para comandos de saída; nomes e política operacional sujeitos a validação. Chave estável `tenantId:conversationId`, serialização JSON validada por esquema e compatibilidade aditiva. Envelope:

```json
{"schemaVersion":1,"eventId":"uuid","eventType":"message.received","occurredAt":"2026-01-01T00:00:00Z","tenantId":"uuid","integrationId":"uuid","conversationId":"uuid","sessionId":"uuid","correlationId":"uuid","causationId":"uuid","payload":{"messageId":"uuid","rawEventId":"uuid"}}
```

Tipos iniciais: `message.received`, `message.send.requested`, `message.send.result`, `message.delivery.updated`, `handoff.requested`, `handoff.confirmed`, `handoff.failed` e `session.changed`. O payload específico deve ser validado por tipo; IDs referenciam dados protegidos. Produtor publica outbox e marca após confirmação; consumidor registra `eventId` e efeito na mesma transação, confirmando offset depois. Retentativas limitadas preservam ordem por conversa; evento irrecuperável bloqueia ou encaminha a quarentena visível com alerta e procedimento de replay, evitando avanço silencioso. Alterar partições exige plano para preservar ordenação; não presumir ordem global.

**Socket.IO — proposta v1.** Autenticar conexão; autorizar tenant, identidade e conversa no servidor antes de ingressar em sala. Não confiar em `tenantId` ou sala enviados pelo cliente. Eventos:

- `session.open` `{resumeToken?}` -> ack `{conversationId,sessionId,cursor}` após autorização.
- `message.send` `{conversationId,clientMessageId,text}` -> ack `{messageId,status}` somente após persistência; repetição da mesma chave retorna o mesmo resultado.
- `message.created` `{conversationId,messageId,sequence,author,content,createdAt}`; `message.status` `{messageId,status,sequence}`.
- `conversation.state` `{conversationId,state,version}`; estados só refletem evidência disponível.
- `history.sync` `{conversationId,afterCursor,limit}` -> `{items,nextCursor,hasMore}`; cursor estável, paginação autorizada e deduplicação por ID/sequence após reconexão.

Acks de persistência não significam entrega ao destinatário. Limitar tamanho e frequência, validar payloads e revogar acesso quando permissões mudarem. Contratos do workspace devem oferecer consulta paginada, atribuição exclusiva, resposta idempotente, conclusão e solicitação de retorno com versão e autorização; o front-end vem depois dos fluxos de backend.

## 6. WhatsApp e MBA

Validar documentação vigente e sandbox da Meta/360dialog antes de escolher endpoints, autenticação, assinatura, tipos de evento e confirmação. Construir adaptador que preserve eventos de mensagens, status e standby efetivamente recebidos, identifique origem quando comprovada e registre o histórico observado. Enquanto MBA controlar a conversa, não gerar resposta paralela. Handoff e retorno usam operação persistida, confirmação quando suportada, timeout, estado desconhecido e reconciliação; sem evidência confiável, não declarar sucesso nem liberar respostas concorrentes. Validar elegibilidade, ativação, contexto/histórico, conectores, limites e cobrança; não assumir que o histórico observado é completo.

## 7. IA do Webchat e operações compartilhadas

Definir interface `generate(context, tools, cancellation) -> response` com implementação simulada no primeiro marco e adaptadores substituíveis. O contexto é limitado ao histórico autorizado do tenant e sujeito a política de dados; falhas e timeout produzem estado recuperável. Um catálogo de operações de negócio recebe identidade do tenant e agente, parâmetros validados, autorização específica, idempotência para efeitos e auditoria. O Webchat usa ferramentas por seu adaptador; exposição ao MBA depende de conectores oficialmente confirmados.

## 8. Segurança, confiabilidade e observabilidade

Autenticar webhooks pelo mecanismo oficialmente suportado, validar payloads, proteger contra repetição e segregar credenciais por integração; criptografar em trânsito e repouso. Autorizar por tenant e função em API, Socket.IO, workers, arquivos e ferramentas; aplicar privilégio mínimo e rotação de credenciais. Registrar logs estruturados sem segredos ou conteúdo desnecessário, com tenant, conversationId, eventId, correlationId e resultado. Medir atraso e falhas de consumidores, idade da outbox, duplicidades, handoffs pendentes, envios incertos e recuperação; alertar sobre quarentena e atrasos. Definir retenção, direitos de titulares, incidentes e contratos com Jurídico conforme jurisdição, sem inventar prazos.

## 9. Estrutura de módulos e repositórios

```text
repo/
  src/domain/{conversation,session,message,handoff}/
  src/application/{ingestion,routing,history,delivery,tools}/
  src/adapters/{whatsapp,webchat,ai,contact-center,kafka,postgres}/
  src/runtime/{api,worker}/
  prisma/  contracts/  tests/  docs/adr/
```

Domínio não depende de transportes ou Prisma; aplicação usa portas, adaptadores as implementam. Um repositório reduz coordenação inicial e permite compartilhar contratos e testes; padrões finais dependem dos documentos ainda não lidos.

## 10. Backlog por dependência e valor

1. **Fundação:** obter documentos completos e padrões, ADRs, ameaças e critérios de aceite; validar capacidades oficiais em paralelo.
2. **Primeiro fluxo vertical:** banco, núcleo mínimo, outbox/consumidor, adaptadores simulados, histórico e correlação; teste automatizado de ponta a ponta. Este marco precede expansão arquitetural.
3. **WhatsApp/MBA:** webhook e observação, depois handoff e retorno conforme mecanismos comprovados; testar com simulador e ambiente real separadamente.
4. **Webchat:** Socket.IO, recuperação por cursor e IA independente; testar desconexão, duplicidade e autorização.
5. **Contact Center:** fila, atribuição exclusiva, histórico, resposta e retorno; validar jornadas com Produto e Atendimento.
6. **Ferramentas e operação:** catálogo autorizado e integrações comprovadas; retenção, direitos, incidentes, observabilidade e testes integrados antes da produção.

Políticas de fila e operações de negócio são refinadas com Produto e Atendimento; controles de dados e termos de fornecedores com Jurídico. Cada marco exige demonstração reproduzível e registro do que é simulado.

## 11. Justificativa dos limites

O domínio compartilhado evita duplicar regras entre canais; adaptadores isolam protocolos sujeitos a mudança; workers isolam processamento assíncrono sem impor microsserviços por responsabilidade. API e worker podem escalar separadamente quando métricas justificarem. O orquestrador coordena decisões e transições, mas não implementa protocolo de provedor, lógica das ferramentas ou interface do operador. Qualquer nova separação requer ADR com problema, alternativas, dependências, monitoramento, testes e custo [diretiva, §§ 10.1 e 10.5].

## 12. Primeiro fluxo vertical e aceite

Usar adaptador de entrada e IA simulados: receber texto com tenant autenticado; validar e normalizar; identificar/criar sessão; persistir mensagem e outbox; consumir e rotear; gerar resposta simulada; persistir intenção; enviar ao adaptador de teste; persistir resultado; consultar histórico e rastrear pela correlação. Executar localmente com PostgreSQL e Kafka e instruções reproduzíveis a serem criadas na implementação.

Aceite automatizado: histórico contém entrada e resposta na ordem interna; repetição da entrada e do comando não cria efeitos extras; falha entre commit e publicação é recuperada; reinício do consumidor não perde nem duplica o efeito; tenant distinto não lê ou envia na conversa; logs e eventos permitem rastrear a execução. Adicionar testes de concorrência, eventos fora de ordem e envio externo incerto na evolução. A aceitação final do produto exige ainda WhatsApp e MBA reais, handoff e retorno suportados, Webchat, reconexão e isolamento conforme diretiva, § 12. Nenhum desses resultados é afirmado como concluído.