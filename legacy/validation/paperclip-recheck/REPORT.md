# Reavaliação do Paperclip — 2026-11-03

## Decisão da etapa

**Impossibilidade de composição sem fork: NÃO confirmada.** A primeira execução completa desta nova prova passou com Paperclip real, adaptador externo nosso, LangGraph e LightRAG reais. Não houve alteração rastreada no repositório upstream. O antigo NO-GO continua válido para homologação integral/produção, mas não demonstra impossibilidade arquitetural. Descartar o Paperclip pode ser uma escolha de custo/complexidade; não deve ser apresentado como impedimento técnico já provado.

## Versões e condições

Paperclip `1e3ab690b072bbf6a1c1f1d0454ea49315b2074c`; Node 24.20; pnpm 9.15.4; LangGraph `3c916d750575b22c464790e9774494d810ccd322`; LightRAG `aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a`. Reutilizamos as dependências fixadas e registradas em `../../poc`. Banco e diretório de dados exclusivos, API local_trusted em loopback, efeitos e modelos sintéticos, nenhuma despesa de API.

## Evidências e falhas

- 19 testes upstream selecionados PASS: adapter-execution-control e adaptador HTTP, `evidence/upstream-contracts.log`. Não representa toda a suíte.
- 4 testes do ledger PASS: intenção estável entre runs/reabertura, tombstone contra submit tardio, conclusão não regride e recuperação mantém trabalho incerto suspenso; `evidence/store-corrected.xml`.
- A primeira coleta do ledger falhou por colisão do módulo runtime; corrigimos apenas nossa importação. Falha preservada em `evidence/store.log`.
- Primeira prova viva retornou 409 no cancelamento: a execução remota havia parado, mas não havia recibo reconhecido pelo Paperclip. `evidence/live-e2e-before-receipt.json`.
- Adaptador corrigido usa `ctx.onCancellationReady()`, acompanha `ctx.signal`, solicita cancelamento remoto persistente e aguarda a tarefa terminar. Somente depois devolve o recibo em `resultJson.executionCancellation.state=acknowledged`. Não é suficiente abortar fetch ou aceitar HTTP 202 como conclusão.
- Primeira execução completa PASS: `evidence/live-e2e-first-pass.json`. Run concluído e issue done; custo fixture não nulo 0.003, 30/5 tokens, dois modelos; novo run da mesma intenção mantém um único efeito. Cancelamento em aproximadamente 285 ms, tarefa remota terminada, nenhum efeito após aguardar além do atraso original, issue não marcada done. Contratos financeiros são sintéticos, não medição de provedor real.
- Repetição final com código estabilizado PASS: `evidence/live-e2e.json`; recibo persistido foi conferido pela API; cancelamento em aproximadamente 314 ms e nenhum efeito após a janela original.
- Contratações sem aprovação 409, acesso cruzado 403 e token revogado 401 também foram exercitados. Duas empresas no banco são uma fixture de autorização, não mudança para produto SaaS multi-tenant.

## Adaptações e limites do contrato

A extensão está em `adapter/`, fora do clone. O runtime nosso implementa submit/status/cancel, chave de idempotência por intenção de negócio e efeito, persistência SQLite, bloqueio de trabalho incerto na reinicialização e HMAC de requisição. Isso é camada própria, não funcionalidade pronta do Paperclip. A resposta da fixture usa HTTP loopback; não é recibo criptograficamente assinado nem identidade de produção.

Fontes locais: `packages/adapter-utils/src/types.ts` (onCancellationReady/resultJson), `server/src/services/adapter-execution-control.ts`, `heartbeat/runtime-execution.ts`, `heartbeat/run-control.ts` (exige acknowledgement), `run-cancellation.ts` (preserva metadata). O campo de recibo foi integrado ao resultado permitido do adaptador, mas é um acoplamento semântico ao núcleo e precisa de teste de regressão por versão. Não basta inventar o campo sem comprovar a parada remota.

Há outra limitação: `heartbeat/process-settlement.ts` presume que adaptador desconhecido é processo local, salvo target remoto ou tipo http. O caminho de Stop desta fixture passou com recibo real da nossa tarefa; isso NÃO qualifica promoção de filas, handoff, Budget Stop, lease cleanup ou recuperação após morte do servidor. Não usamos override do tipo HTTP nem alteramos esse arquivo para fazer o teste passar.

Permanecem abertos: orçamento com reserva/estouro concorrente e custos parciais reais, cancelamento em falha de rede, morte de processos em cada fronteira, retomada segura de efeitos externos não transacionais, ACL/proveniência/tempo e integração completa do cérebro, isolamento entre instalações, sandbox de ferramentas, PostgreSQL de produção e operação Linux/backup. Uma tabela UNIQUE local não garante exactly-once em API externa.

## Arquitetura preservada

Instalação dedicada por cliente, cérebro persistente central e UI JARVIS própria permanecem requisitos. Chief of Staff comunica e sintetiza; controlador próprio escolhe capacidades/estratégia/risco; Paperclip, se futuramente selecionado, governa organização e aprovações. Nenhuma autoridade duplicada foi aprovada. LangGraph e LightRAG foram reutilizados; Graphiti segue em avaliação. Não iniciamos implementação integral do produto.

## Reproduzir

Na raiz do workspace, com os ambientes registrados previamente:

```powershell
& poc/.venv/Scripts/python.exe -m pytest validation/paperclip-recheck/test_store.py -q --junitxml=validation/paperclip-recheck/evidence/store-corrected.xml
node --import ./vendor/paperclip/server/node_modules/tsx/dist/loader.mjs validation/paperclip-recheck/live_e2e.ts
```

Testes locais exigiram acesso a subprocessos/sockets fora do sandbox restrito. O driver cria home exclusivo; parar seu PostgreSQL após cada execução. Chaves efêmeras não devem ser publicadas. Consulte o relatório integrado para a sequência AgentScope → OpenAgents.
