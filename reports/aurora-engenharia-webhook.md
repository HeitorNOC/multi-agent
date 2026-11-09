# Ensaio de engenharia do Aurora

O recorte da diretiva omnichannel foi a ingestão idempotente de um webhook. O ensaio usou um adaptador HTTP local com eventos fictícios, uma tabela de efeitos no SQLite e um workflow LangGraph de laboratório. O GPT-6.1 Terra produziu o plano, as atribuições, o desenho, o código e os pareceres. O executor rodou o código e um teste de aceitação escrito separadamente. O PostgreSQL armazenou os checkpoints do trabalho.

O Chief recebeu o recorte de Tecnologia e um conjunto limitado de candidatos do catálogo. O ensaio exigiu Tech Lead, Backend e QA e uma vaga de reserva. A diretora formulou subtarefas distintas e decidiu entre encaminhar a entrega e devolver o trabalho para correção. A ordem técnica deste recorte foi validada pelo fluxo. Uma verificação local aceitou a atribuição válida e recusou agente de fora do grupo, duplicação e ordem invertida. O orçamento foi limitado a 11 chamadas e a duas tentativas de implementação.

O executor usou a imagem Docker local `adaptive-webchat-executor:local` com Node 24.20.0, rede desativada, raiz somente leitura, usuário sem privilégios, limites de CPU, memória e processos. A montagem somente leitura continha dois arquivos, a implementação candidata e o teste de aceitação. O banco de efeitos viveu no `tmpfs` do contêiner. O banco de checkpoints foi um contêiner separado com porta restrita a loopback. A experiência não qualificou a imagem como sandbox de produção. [Workflow](../validation/aurora-engineering/run.py) · [Teste de aceitação](../apps/aurora/runtime/engineering_fixtures/webhook-acceptance.cjs)

## Primeira execução

A prova negativa confirmou que a implementação inicial aceitou duas entregas repetidas com HTTP 202. O workflow gerou uma implementação, gravou o checkpoint com `qa` como próximo nó e encerrou o primeiro worker com código 88. O segundo processo retomou no QA. Os testes automatizados do módulo gerado passaram, mas o log apresentou apenas um nome de teste genérico. QA considerou que o registro não demonstrava conflito, persistência e recuperação de falha. A diretora solicitou retrabalho, e o limite de duas tentativas impediu encaminhar a entrega quando a mesma lacuna permaneceu. O executor passou a emitir um registro depois de cada asserção de aceitação, e a trilha passou a preservar as decisões da diretora por tentativa.

[Registro da primeira execução](aurora-engenharia-webhook/primeira-execucao.json)

## Reexecução com evidência por critério

| Papel | Autorizado pelo Chief | Acionado pela diretora | Entrega |
| --- | --- | --- | --- |
| Tech Lead | Sim | Sim | Desenho da chave por tenant e evento, estratégia transacional e revisão do código |
| Backend | Sim | Sim | Implementação do módulo de ingestão |
| QA | Sim | Sim | Conferência das evidências do executor |
| Plataforma | Sim | Não | Ficou disponível como reserva |

As duas entregas concorrentes do mesmo evento receberam HTTP 202 e 200 e produziram uma única linha de efeito. O mesmo identificador com payload diferente recebeu HTTP 409 e preservou o valor original. Outro tenant pôde registrar o mesmo identificador. Depois de reabrir o arquivo SQLite, a duplicata continuou reconhecida. Uma falha de gravação injetada devolveu HTTP 500 sem efeito persistido e a nova tentativa gravou exatamente um efeito. QA e Tech Lead aceitaram a entrega. A diretora encaminhou o diff para revisão humana na primeira tentativa desta rodada.

O processo 28036 encerrou com o próximo nó `qa`. O processo 1488 abriu o mesmo ID de checkpoint no PostgreSQL. Das sete chamadas ao modelo, quatro ocorreram antes do corte. A quinta foi a avaliação de QA. O Chief, a atribuição da diretora, o desenho do Tech Lead e a implementação do Backend tiveram uma chamada cada e foram reaproveitados. As sete chamadas concluíram sem erros e sem eventos de ferramenta inesperados. [Trilha da reexecução](aurora-engenharia-webhook/result.json) · [Diff para revisão](aurora-engenharia-webhook/webhook.patch) · [Módulo gerado](aurora-engenharia-webhook/webhook.cjs)

**Decisão do ensaio.** O recorte passou na aceitação funcional e na retomada entre nós do LangGraph. A distinção entre grupo autorizado e agentes acionados ficou registrada na trilha do laboratório. O teste de retomada cortou depois de um checkpoint confirmado e não cobre queda durante uma chamada ao modelo. O endpoint de teste é local e o módulo pressupõe esquema novo, entrada validada e efeitos na mesma base SQLite. O código ficou como artefato para revisão humana. O usuário concordou com o resultado do ensaio.

## Integração ao Aurora

O cenário **Engenharia de webhook** passa pela fila do Aurora e usa o grafo compartilhado com o laboratório. O painel exibe o grupo autorizado, quem recebeu atribuição, as subtarefas, o resultado de cada tentativa, a decisão da diretora e o diff. A aprovação vincula o recibo local ao conteúdo da entrega.

A integração passou com o launcher, a API, o LangGraph, o PostgreSQL e o executor Docker reais. O provedor controlado fez sete chamadas registradas. O teste conferiu o especialista de reserva, os testes, o diff, a ausência de recibo antes da aprovação e o recibo de engenharia depois da retomada. A primeira tentativa detectou que a fixture de inferência esperava um objeto onde o desenho técnico usa texto. A fixture foi corrigida. A verificação no Edge confirmou a exibição de subtarefas, reserva, testes, diff e revisão. [JUnit](../validation/aurora-local-restart/engineering-integration.xml)

## Execução pelo painel com o modelo real

Em 7 de novembro de 2026, o cenário foi submetido e aprovado no painel do Edge, em uma sessão local com GPT-6.1 Terra. O Chief autorizou Tech Lead, Backend, QA e Plataforma. A diretora acionou os três primeiros. O Docker confirmou HTTP 202 e 200 nas duas entregas concorrentes, uma única gravação, preservação do payload original em caso de conflito, isolamento entre tenants, persistência após reabertura e nova tentativa após falha de escrita. A entrega chegou à revisão na primeira tentativa. O diff introduziu uma chave composta por tenant e evento e uma inserção que ignora conflitos nessa chave. [Painel em revisão](aurora-engenharia-webhook/live-panel-delegacao.png) · [Diff da rodada](aurora-engenharia-webhook/live-panel-webhook.patch)

Da admissão até a revisão foram 47,49 s. A tarefa consumiu sete chamadas, com 86.096 tokens de entrada, incluindo 63.744 em cache, e 1.065 tokens de saída. A preparação da sessão consumiu separadamente 16 chamadas de indexação, com 222.698 tokens de entrada, incluindo 143.488 em cache, e 16.152 de saída. Nenhuma chamada registrou evento inesperado de ferramenta. O custo faturado ficou fora da medição.

A aprovação registrou o recibo `b67da7fb-cfc4-4e2a-866c-bbc9316fcd1b` para o mesmo hash da entrega revisada. O recibo saiu 0,99 s após o registro da aprovação. O trabalho terminou como `completed`. A rodada cobre o webhook fictício e o executor local do Aurora. [Trilha da revisão](aurora-engenharia-webhook/live-panel-review.json) · [Recibo e métricas](aurora-engenharia-webhook/live-panel-approved.json)

## Ensaio no repositório `que`

O grafo de engenharia do Aurora foi executado em bancada com GPT-6.1 Terra sobre uma cópia do commit `5cf77950e29c0d203b3ee1d10471b775f6b91af4`. A diretora acionou Tech Lead, Backend e QA. Plataforma ficou de reserva. A mudança acrescentou um teste ao spec do webhook de pagamentos. O teste verifica que, quando o provedor ignora um evento, o comando retorna `null` e mantém `runSystem` sem chamadas.

No Docker com rede desativada, a suíte passou de 11 para 12 testes aprovados. Na prova negativa, o comando ainda retornava `null`, mas chamava `runSystem`. O novo teste foi o único a falhar e apontou exatamente a chamada indevida. `git apply --check` confirmou que o diff é aplicável à revisão de origem. O repositório original permaneceu limpo.

Na primeira execução, a suíte passou e QA devolveu a entrega porque os resultados não traziam o diff. Na reexecução, o grafo apresentou o diff, a revisão de origem e os resultados do teste de regressão. A diretora encaminhou a entrega para revisão humana após sete chamadas ao modelo. Essa rodada usou o grafo em bancada. [Diff](aurora-engenharia-webhook/que/que.patch) · [Evidência final](aurora-engenharia-webhook/que/result.json) · [Primeira execução](aurora-engenharia-webhook/que/primeira-execucao.json)

No painel, **Revisar entrega do que** abre essa entrega específica com o commit, a delegação, o diff e as evidências dos testes. O servidor confere o hash da evidência importada e vincula a aprovação ao conteúdo persistido da entrega. O teste no Edge usou a API real e um backend de status controlado. Conferiu a recusa de hash divergente, o registro local da aprovação e a devolução do mesmo recibo em caso de repetição. A sessão de teste registrou zero chamadas de execução. [Teste do painel](../validation/aurora-engineering/que-panel-smoke.cjs) · [Recibo da sessão descartável](aurora-engenharia-webhook/que/painel-revisao.json)

## Nova tarefa no `que` iniciada pelo painel

O pedido **Executar nova tarefa no que** entrou pela interface do Edge, passou pela fila e gerou um novo diff com GPT-6.1 Terra. O cenário cadastrado usa a revisão `5cf77950e29c0d203b3ee1d10471b775f6b91af4` e um volume de dependências do lockfile montado somente para leitura durante os testes. A preparação baixou as dependências com scripts de instalação desativados. O Vitest rodou em contêineres sem rede. Apenas o spec foi alterado na proposta.

O novo teste exige rejeição com `PAYMENT_CHARGE_NOT_FOUND` e zero chamadas a `runSystem` quando o evento verificado aponta para outra cobrança. Passaram os 11 testes existentes e o novo. Ao remover a verificação da cobrança no contêiner de teste, somente o novo caso falhou. O Git confirmou que o diff se aplica à revisão de origem. A entrega chegou a `awaiting_approval` em 57,90 s, na primeira tentativa, com sete chamadas ao modelo. O painel mostrou o commit, o diff e o resultado da suíte para o mesmo trabalho. [Diff](aurora-engenharia-webhook/que/nova-tarefa.patch) · [Evidência da execução](aurora-engenharia-webhook/que/nova-tarefa.json)

Para habilitar esse cenário, inicie o launcher com `AURORA_QUE_VOLUME` apontando para o volume preparado do `que`. O volume deve ter o prefixo `aurora-que-panel-` e a etiqueta `aurora.que.revision` com o commit indicado. O worker lê os dois arquivos de origem via Git na cópia local `validation/aurora-engineering/.state/que-5cf7795`. Esse caminho aceita o pedido cadastrado para o `que`. O trabalho do ensaio ficou aguardando revisão humana.

## Entrega aprovada aplicada em branch isolada

A aprovação da tarefa `df894225-5854-40a4-9883-fbded6834b3e` foi confirmada na API. O hash do parecer, o hash recalculado do conteúdo e o recibo `020f0a0f-b46b-42a4-bea4-ca336440c5e0` coincidiram. O diff foi aplicado à cópia isolada do `que`, na branch `aurora/que-webhook-charge-guard`, a partir do commit `5cf77950e29c0d203b3ee1d10471b775f6b91af4`.

O executor Docker repetiu a suíte com o arquivo aplicado. Os 12 testes passaram. O Prettier apontou a diferença de quebras de linha no arquivo de trabalho do Windows. A normalização passou na verificação de estilo e não alterou o conteúdo Git. A entrega ficou em um único commit, `316fc1744f120c799f5bd5f8a20e7f40ce578211`, com árvore de trabalho limpa. O repositório original em `D:/Workspace/que` foi conferido e permaneceu no commit de origem.

O commit foi criado com autoria local `Aurora Engineering <aurora@local.invalid>`. O bundle contém a branch a partir da revisão de origem para revisão ou transporte. [Vínculo da entrega](aurora-engenharia-webhook/que/entrega-git.json) · [Testes da branch](aurora-engenharia-webhook/que/testes-branch.json) · [Bundle Git](aurora-engenharia-webhook/que/que-entrega.bundle)

## Reprodução do cenário original

Com as imagens locais, o ambiente Python do Aurora e o Codex CLI autenticado, execute com um novo diretório de saída:

```powershell
& validation/aurora-engineering/Run-WebhookLab.ps1 `
  -Output validation/aurora-engineering/.state/webhook-reexecucao
```

O roteiro cria e encerra o PostgreSQL temporário e grava `result.json`, `webhook.cjs` e `webhook.patch` na pasta indicada ao concluir a retomada. As evidências incluem as atribuições, os pareceres, o checkpoint e os identificadores das chamadas ao modelo.
