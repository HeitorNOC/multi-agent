# Parecer de integração com o Contact Center existente

O Chief aprovou a divisão do PDF em cinco lotes. Dois especialistas receberam o texto das páginas 1 a 25 e produziram resumos por página. O Chief consolidou esses resumos. Os diagramas das páginas 5, 9 e 19 foram conferidos visualmente e as observações foram incluídas nos lotes correspondentes. Os contratos descritos ainda exigem validação no código e no ambiente de integração.

## Descrito

- A arquitetura relatada liga o workspace-ui ao contact-center-portal por GraphQL; o portal extrai accountID e userID do token e encaminha chamadas ao contact-center REST. O fluxo em tempo real envolve cc-message-socket, cc-message-consumer e tópicos Kafka (p. 5–6).
- Na criação de atendimento de mensageria, o atendimento recebe WAITING e a sessão é alterada para HUMAN; o sent-consumer passa a publicar em message-human. A distribuição considera ordem, capacidade e departamento, conforme as regras descritas (p. 11, 19–20).
- Estado de atendimento e controle da conversa são conceitos distintos. WAITING, ACTIVE e os demais status descrevem o ciclo do atendimento; HUMAN e bot representam o tipo de controle da sessão de mensageria. Uma alteração em um não comprova, por si só, a alteração correta do outro. As mudanças de status registram o anterior e o novo em attendance_status_processing (p. 9–11, 15–16).
- O workspace usa salas identificadas pela sessão e envia texto, arquivo ou áudio por tatodesk.conversation_agent_to_client:utter; o socket publica respostas em <canal>-reply. Na reconexão, recompõe salas e recarrega mensagens. A publicação ou emissão à sala não comprova entrega ao cliente (p. 13).
- Para aplicativos de mensageria, o histórico é consultado por appMessagesByIntegrationIDAndSessionID com useCache; arquivos privados usam link temporário. O material não estabelece retenção, abrangência ou autorização completa do histórico. O cache de mensagens tem ciclo de vida próprio e é apagado em algumas operações; isso não comprova a exclusão do histórico persistente (p. 14, 23).
- A finalização de mensageria descrita chama updateAppSessionToBot e, em caso de falha no processo, devolve a sessão ao tipo humano. O cancelamento e o cancelamento por inatividade também incluem retorno ao bot; os demais caminhos precisam ser conferidos individualmente. A compensação descrita não comprova tratamento de falha de entrega de mensagens (p. 15–16, 21).
- Há regras de permissão verificadas no front; o resumo informa que as regras de backend não foram revisadas integralmente. Os schedules tratam posição na fila e cancelamento por inatividade; o aviso deste último está comentado. Telefonia tem fluxo SIP próprio e partes de servidor e infraestrutura não foram lidas (p. 18, 21–22, 24–25).

## Inferido

A integração entre bot, fila, atendente e retorno ao bot exige continuidade de contexto e coordenação entre o status do atendimento, o controle da sessão e as mensagens em trânsito. Essas necessidades não demonstram que exista hoje um contrato completo de handoff, garantia de entrega ou acesso do atendente a todo o histórico. A concentração relatada de decisões de acesso no front pode representar risco se endpoints forem acessíveis diretamente, sujeito à verificação de barreiras adicionais (p. 11–16, 24).

## Proposto

1. Mapear os contratos atuais antes de alterá-los: operações GraphQL e REST, identidade e escopo de conta, eventos Socket.IO e Kafka, payloads, identificadores, respostas e erros. Preservar compatibilidade dos consumidores existentes e definir critérios de aceite por canal e fluxo.
2. Especificar o handoff de entrada e retorno: gatilho, vínculo entre conta, integração, sessão e atendimento, contexto e histórico disponibilizados, responsável por cada transição, concorrência e compensação quando uma etapa falhar. Tratar separadamente estado do atendimento e controle da sessão.
3. Após verificar os mecanismos existentes, definir correlação, idempotência, ordenação, confirmação, repetição e apresentação de falhas para mensagens. Distinguir publicação interna de aceitação, envio, entrega e leitura confirmados pelo provedor.
4. Executar testes de sucesso, falha e segurança: criação e distribuição; transferência, pausa, finalização, cancelamento e retorno ao bot; envio de texto e mídia; reconexão e mensagens em trânsito; duplicidade e repetição; autorização por conta, departamento e perfil; histórico, anexos e download; limites dos schedules; e telefonia. Incluir testes de fronteira e concorrência, com critérios de aceite verificáveis.

## Pendente de verificação

No código, conferir os chamadores de criação, validações, contratos e autorização de backend, fontes e retenção do histórico, vínculo de atendimentos relacionados, implementação e TTL dos caches, escolha de tópicos, tratamento de falhas e os fluxos não lidos. Verificar especialmente o status e o controle da sessão em todos os encerramentos, inclusive falta de resposta e encerramento pelo cliente (p. 16, 23–25).

Em ambiente real, validar consistência entre atendimento, sessão e caches, roteamento, recuperação após desconexão, concorrência, isolamento de acesso, desempenho das consultas periódicas e comportamento dos schedules. Com cada provedor, confirmar capacidades e restrições de entrega, mídia, retenção e janela de templates do WhatsApp; validar separadamente as credenciais e a infraestrutura SIP (p. 13–15, 21–22, 24).
