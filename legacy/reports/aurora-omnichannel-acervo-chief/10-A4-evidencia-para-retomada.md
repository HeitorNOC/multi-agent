# Evidência para o Chief retomar A9 e definir A10

A documentação da 360dialog mostra que o webhook pode ser configurado com o cabeçalho `Authorization: Basic …`. Isso sustenta o contrato local de um webhook encaminhado pela 360dialog com a credencial configurada. A configuração da conta, a chegada do cabeçalho em HTTPS e a rejeição de credenciais incorretas devem ser verificadas na homologação posterior. [Configuração do webhook com Basic Auth](https://docs.360dialog.com/partner/messaging/sending-and-receiving-messages/receiving-messages-via-webhook)

A 360dialog descreve `standby` para observação quando o MBA tem o controle e `messages` quando o parceiro controla a conversa. O envio pela aplicação pode tomar controle. O parceiro descreve `release`, `pass` e `take`, com restrições de função e variantes de endpoint e versão que exigem validação por conta. [Integração do MBA com a 360dialog](https://360dialog.com/blog/bsp-integration-meta-business-agent-whatsapp/)

A homologação real foi adiada pelo usuário até o código estar pronto. O Chief deve decidir a fronteira entre A9 e A10 para o laboratório. A equipe pode usar eventos e transportes simulados para testar proteção contra corrida e deixar a confirmação da variante de Thread Control para a homologação. A conta, credenciais e provedor real ficam fora desta rodada.
