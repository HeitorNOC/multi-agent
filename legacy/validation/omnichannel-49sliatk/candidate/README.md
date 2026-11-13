# Omnichannel · fatia vertical A6

Aplicação de laboratório em Node.js e TypeScript com PostgreSQL. O domínio define as entradas, saídas e interfaces de persistência. O adaptador usa transações do TypeORM, SQL parametrizado para as operações concorrentes e uma migration SQL versionada. A configuração segue o [ADR A2](../../reports/aurora-omnichannel-acervo-chief/05-A2-adr-proposto.md).

## Executar

Use um banco PostgreSQL dedicado e vazio. Configure `OMNICHANNEL_TEST_DATABASE_URL` localmente com a URL desse banco. A suíte aplica a migration e usa identificadores de teste aleatórios. Ela grava dados fictícios e pode ser executada novamente no mesmo banco.

```sh
cd apps/omnichannel
npm ci
npm test
```

## Cobertura

- O contexto é fornecido pela fixture de confiança. A operação verifica o escopo e o vínculo da integração e do canal com a empresa antes de aceitar o evento.
- O recebimento preserva o payload JSON, normaliza o texto e registra autoria técnica e correlação. Sessões são resolvidas pela combinação de empresa, integração, canal e identificador externo.
- A resposta determinística, a entrada e a fila de saída são gravadas juntas. O histórico é consultado por cursor no escopo de empresa e sessão. A entrada de saída no histórico representa uma resposta registrada.
- O adaptador simulado reserva o envio uma vez e registra aceite, rejeição ou resultado incerto. Aceite é um resultado do adaptador. Confirmação de entrega ao destinatário requer evidência própria. Uma reserva que sobrevive à queda do executor exige reconciliação antes de qualquer novo despacho.

A validação usa a interface TypeScript e um canal simulado. O teste de QA encerra um processo de laboratório depois que a reserva é persistida e antes de chamar um canal. O processo principal confere que o item segue reservado, bloqueia outro despacho e aplica a reconciliação simulada. A autenticação de fronteira, o worker de recuperação, a transferência humana, o Contact Center, Kafka, Socket.IO e os provedores reais pertencem às etapas seguintes.

## Recuperar uma saída

1. Em um contexto autenticado da empresa com escopo `outbound:reconcile`, execute `ListRecoverableDispatches`. A consulta retorna até 100 itens. Estados incertos entram imediatamente. Uma reserva em trânsito aparece após 60 segundos.
2. Use o ID de despacho e a correlação para localizar evidência do canal. A idade da reserva indica que ela merece revisão. O resultado do envio continua indeterminado até obter evidência.
3. Com evidência de aceite ou rejeição, execute `ReconcileDispatch` com a referência da evidência e, em caso de aceite, o identificador externo. A operação registra responsável e correlação e aceita a repetição idêntica. O laboratório usa um recibo fictício.
4. Confira o estado em `ReadHistory`. Para saídas anteriores à migration cujo vínculo é ambíguo, o histórico indica `untracked`. A aplicação não tenta reenviar itens em revisão.

Essas operações são casos de uso TypeScript. A consulta automática ao provedor e a interface operacional dependem das integrações posteriores.

## Kafka no laboratório

Depois de instalar as dependências com `npm ci`, execute `pwsh -File test/run_kafka.ps1` dentro de `apps/omnichannel`. O script usa PostgreSQL e Kafka descartáveis em loopback. Alternativamente, configure `OMNICHANNEL_TEST_DATABASE_URL` e `OMNICHANNEL_TEST_KAFKA_BROKER` para serviços dedicados e execute `npm run test:kafka`.

O publicador usa a fila transacional e uma chave Kafka por empresa e sessão. O consumidor valida a referência ao despacho no PostgreSQL e confirma o offset após o tratamento. Uma reentrega pode repetir a leitura do evento. A reserva persistida protege a chamada ao canal simulado contra duplicação. Um envio anterior incerto impede o despacho do próximo item da conversa até reconciliação e retomada do consumidor.

Após cinco tentativas de publicação, `reply_outbox.publish_error` fica em `retry_limit` para triagem. Eventos inválidos ficam registrados em `kafka_dispatch_quarantine` por tópico, partição e offset, sem armazenar o payload. O laboratório usa um publicador por banco e partições fixas. Agendamento contínuo, alertas, autenticação do broker e operação de retomada pertencem à preparação operacional.

O ensaio encerra o primeiro consumidor depois de persistir o aceite simulado e antes de confirmar o offset. Um segundo processo no mesmo grupo relê o primeiro evento, despacha apenas a segunda resposta e registra o envelope inválido em quarentena. A falha de publicação é exercitada com um produtor desconectado. Uma mensagem posterior da mesma conversa fica atrás do item que esgotou as tentativas.

## Adaptador WhatsApp da 360dialog

`ObserveWhatsappWebhook` recebe os bytes originais do callback. A configuração confiável vincula a credencial Basic, a conta WABA, o número, a integração e a empresa. O caso de uso devolve 200 depois de gravar o lote e as observações na mesma transação. O teste verifica autenticação, vínculo do número, limite de 1 MiB e reentrega concorrente. [Webhooks da 360dialog](https://docs.360dialog.com/docs/messaging/webhook)

Os eventos `messages` e `standby` são classificados em entrada do cliente, eco do MBA ou status. A mesma evidência dentro de um campo é deduplicada. O mesmo ID observado em campos diferentes mantém as duas evidências. Os callbacks recebidos nesta etapa ficam no modo de observação. Eventos de transferência são preservados no original quando trazem o vínculo configurado. A interpretação dos eventos e a decisão de controle pertencem à A10. [Eventos de coexistência do MBA](https://360dialog.com/blog/bsp-integration-meta-business-agent-whatsapp/)

`SendWhatsappText` usa o transporte injetado e exige autorização por despacho, controle da plataforma e janela de texto aberta. O contrato testado usa `POST /messages` e `D360-API-KEY`. Um `wamid` válido registra aceite. Timeout ou resposta ambígua vira resultado incerto para reconciliação. [Envio de texto pela 360dialog](https://docs.360dialog.com/partner/messaging/sending-and-receiving-messages/text-messages)

Os testes da A9 rodam com `npm test`. Eles usam callbacks sintéticos e respostas HTTP simuladas. A exposição HTTPS, as credenciais, a origem dos callbacks da conta, a associação dos status à fila de saída e o envio real precisam ser verificados no ambiente elegível. O armazenamento do payload original exige política de retenção e acesso antes de usar dados reais.
