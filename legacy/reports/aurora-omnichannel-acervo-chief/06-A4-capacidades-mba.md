# A4 · Capacidades do Meta Business Agent e da 360dialog

Verificação documental. A equipe ainda precisa de uma conta elegível, credenciais e números de teste para confirmar comportamento, acesso e custo.

| Capacidade | Evidência disponível | Aceite pendente |
|---|---|---|
| Elegibilidade e ativação | A Meta apresenta o Business Agent integrado à plataforma WhatsApp Business. A 360dialog descreve termos do cliente e do parceiro, permissões e configuração com `ALLOWLISTED_ONLY` para testar com números selecionados. | Confirmar elegibilidade da conta e do número reais, aceite dos termos, perfil da credencial e ativação limitada aos números de teste. |
| Webhooks | A 360dialog documenta configuração por número e por WABA, com prioridade do webhook por número. Seu guia de integração do MBA descreve os campos `messages`, `standby` e `messaging_handovers`. | Capturar cada evento, verificar origem e permissões, persistir antes de confirmar processamento e provar deduplicação e tolerância à inversão de ordem. |
| Mensagens e autoria | O parceiro descreve mensagens recebidas, ecos do MBA e status no campo `standby`. Os eventos de coexistência do app WhatsApp Business são uma família distinta. | Capturar IDs e autoria em mensagens do cliente, do MBA e do operador. Validar mídia, status e correlação na conta de teste. |
| Transferência e devolução | A 360dialog descreve `take`, `pass` e `release`, com restrições de papel. Um envio da aplicação pode mudar o controle. O parceiro aponta variantes do endpoint com hosts e cabeçalhos de versão diferentes nas referências da Meta. | Confirmar endpoint, versão, permissões e comportamento de callbacks antes de fixar o adaptador. Exercitar `take` e `release`, perda de confirmação e reentrega. |
| Histórico | A referência de webhook da 360dialog documenta sincronização de histórico na coexistência mediante aprovação. Isso deixa em aberto a cobertura histórica disponível ao MBA e ao Contact Center. | Confirmar origem, alcance, retenção e permissões. Usar eventos observados e armazenados como base do protótipo. |
| Conectores | A Meta anuncia integração com sistemas empresariais. | Confirmar lista e disponibilidade para a conta, contratos, escopo de credenciais e auditoria por empresa. |
| Cobrança | A documentação separa a assinatura de canal da 360dialog, tarifas do WhatsApp e cobrança do MBA pela Meta. | Conferir condições vigentes da conta e conciliar consumo com cobrança. A documentação pública sustenta o modelo de custos. Valores faturados dependem da conta. |

**Comportamento proposto para o núcleo.** Persistir eventos `standby` para contexto e bloquear resposta automática da aplicação. Quando o controle estiver em transição ou incerto, bloquear novos envios e reconciliar com evidência do provedor antes de retomar. Tratar aceite do envio e entrega ao cliente como marcos separados.

**Limite da verificação.** O guia de integração do parceiro cita `graph.facebook.com/v21.0` com `X-API-Version: 2.0.0` e uma referência Cloud API com `api.facebook.com` e `X-API-Version: 1.0.0`. A consulta direta às referências técnicas da Meta retornou HTTP 429 ou indisponibilidade no cache. Nenhuma variante foi selecionada para implementação.

- [Anúncio oficial da Meta](https://about.fb.com/br/news/2026/06/conversations-2026-apresentamos-o-meta-business-agent/amp/)
- [Guia de integração do MBA da 360dialog](https://360dialog.com/blog/bsp-integration-meta-business-agent-whatsapp/)
- [Webhooks da 360dialog](https://docs.360dialog.com/docs/messaging/webhook)
- [Referência de eventos e histórico da 360dialog](https://docs.360dialog.com/docs/messaging/webhook/webhook-reference)
- [Cobrança da 360dialog](https://docs.360dialog.com/docs/get-started/pricing)
