# A7 · Parecer de QA

## Avaliação das etapas

- Recebimento e validação — escopo, integração e texto vazio são verificados. A rejeição não cria sessão nem evento.
- Normalização — espaços são removidos do texto registrado e da resposta. O payload original é preservado.
- Empresa e sessão — duas empresas e dois canais produzem sessões distintas. A leitura e o despacho cruzados são negados ou vazios.
- Persistência — evento, mensagens e outbox são gravados em transação. A migração foi reaplicada sem alterações.
- Roteamento — o despacho carrega integração, canal e sessão esperados para o canal de teste.
- Processamento — a resposta é simulada e identificada pelo prefixo `Simulado`.
- Envio e resultado — o canal de teste aceita uma chamada concorrente. Timeout gera `unknown`, seguido de reconciliação manual.
- Histórico e rastreabilidade — paginação, direções e correlação foram verificadas no fluxo principal.

## Achados para fechar A7

- A suíte exercita duplicidade concorrente, conflito de payload e isolamento entre empresas, mas a evidência fornecida não inclui um relatório reproduzível com comandos completos, configuração do banco e resultados por etapa. Esse artefato é exigido pelo aceite.
- Após a saída abrupta do executor, o despacho permanece em `in_flight` e não pode ser retomado por `DispatchReply`. O teste demonstra apenas a reconciliação manual via `settle`, sem mecanismo operacional de recuperação ou evidência de como determinar o resultado real.
- O histórico grava a mensagem de saída antes do envio e não expõe seu estado ou identificador do provedor. Assim, uma resposta ainda na fila ou rejeitada aparece como saída no histórico, sem evidência do resultado correspondente.

## Escopo posterior

- O processamento e o provedor são simulados. Integrações reais e comportamento de provedores não foram demonstrados pela execução informada.

## Veredito

- Não liberar A8 ainda. O build e os dois testes passaram em Node 24.20.0 e PostgreSQL 16.15 descartável, inclusive o subprocesso encerrado com código 88 após a reserva. Os bloqueios registrados impedem concluir o aceite de A7.

## Registro da execução

A revisão acima recebeu o código e o resultado do teste. A receita abaixo fecha a pendência de documentação reproduzível apontada no parecer. As duas lacunas funcionais seguem abertas.

1. Inicie um PostgreSQL 16 dedicado a testes. A execução registrada usou a imagem `postgres:16-alpine` com a porta publicada apenas em loopback.
2. Configure `OMNICHANNEL_TEST_DATABASE_URL` localmente com a URL do banco dedicado. A suíte aplica a migration e cria dados fictícios.
3. Em `apps/omnichannel`, execute `npm ci` e `npm test`.

```text
Node v24.20.0
PostgreSQL 16.15
tsc concluído
2 testes passaram
0 falhas, 0 ignorados
```

| Etapa da diretiva | Resultado observado |
|---|---|
| Receber | A entrada passou pelo caso de uso TypeScript da fixture. |
| Validar e normalizar | Texto vazio foi recusado sem gravar evento ou sessão. O texto válido foi normalizado e o original foi preservado. |
| Identificar empresa e sessão | Duas empresas e dois canais com IDs externos iguais receberam sessões distintas. |
| Persistir | Evento, mensagens e fila ficaram vinculados. A FK composta recusou gravação em outra empresa. |
| Rotear | A fixture de canal recebeu empresa, integração, canal e sessão de origem. |
| Processar ou gerar resposta | A saída determinística foi gravada com o texto esperado. |
| Enviar | Oito tentativas concorrentes produziram uma chamada ao canal simulado. |
| Persistir resultado | A queda após a reserva deixou o item em trânsito. A reconciliação explícita registrou o aceite simulado sem novo despacho. |
| Consultar histórico | A paginação por cursor e o isolamento passaram. A consulta ainda carece de estado de envio. |
| Rastrear | O mesmo identificador de correlação apareceu na entrada, na fila e no histórico. |

O subprocesso terminou antes de chamar o canal. Um teste separado simula perda de confirmação com timeout. Nenhum deles comprova o comportamento de um provedor após uma chamada real.
