# Code review do Aurora para o piloto com dados reais

**Implementação posterior.** Os quatro controles foram implementados no [perfil consultivo do piloto](../docs/PILOTO_AURORA.md). Este relatório conserva os achados da versão revisada.

06/11/2026 · Windows · instalação de um único host

**Decisão.** O Aurora está apto a continuar no laboratório fictício. A primeira carga real e a execução de uma tarefa aberta ficam bloqueadas pelos quatro achados P1 abaixo. A revisão cobre o código ativo de `apps/aurora/`, `packages/aurora-api/`, `packages/aurora-business/`, os pontos de entrada locais e os testes pertinentes. A raiz disponível não contém metadados Git, por isso as referências apontam para os arquivos revisados no workspace.

## Achados prioritários

### P1. Falta uma entrada de piloto para documentos e tarefas

O launcher lê e publica um corpus estático. O guardião exige um manifesto fictício, um número fixo de documentos e conteúdo previamente listado. A admissão aceita apenas dois cenários. O parecer compara números com as respostas do ensaio. A recuperação percorre fontes fixadas por agente, com consultas sobre Grupo Aurora, SKU-AURA e INC-47, e cache por ID de fonte. Assim, substituir o corpus ou adaptar somente o formulário não produz uma tarefa real válida.

**Correção para o piloto.** Criar um perfil local separado com entrada autorizada, manifesto com versão, hash, classificação e origem, publicação explícita, tarefa livre com limites, consulta contextual e evidências fixadas por trabalho. O corpus de demonstração continua sendo um teste de regressão independente. O perfil de piloto deve recusar caminhos fora da pasta autorizada e diferenciar as versões substituídas das vigentes.

[Guardião do corpus](../apps/aurora/runtime/services/payload_guard.py#L11) · [Recuperação fixa](../apps/aurora/ops/launcher.py#L306) · [Admissão](../apps/aurora/domain/policy.ts#L25) · [Respostas esperadas](../apps/aurora/domain/policy.ts#L102)

### P1. A API local não identifica quem lê ou aprova a tarefa

`GET /api/state` retorna fontes, históricos e trabalhos completos, incluindo o conteúdo e o hash da revisão. A rota de aprovação verifica o estado e o hash, mas registra sempre `operador-local-demo`. A restrição a loopback e a validação de Host e Origin reduzem exposição, porém um cliente local que conhece a porta pode ler e aprovar sem credencial. A autenticação da central de recuperação é uma fronteira separada.

**Reprodução.** Iniciei a API canônica em porta local com backend stub e um diário SQLite temporário. Um GET sem sessão leu o marcador de conteúdo fictício e o hash da revisão. Um POST JSON com esse hash, sem sessão e sem cabeçalho de origem, recebeu 202 e gravou `human_approved` com o ator fixo. Confirmei zero registros em `effects`.

**Correção para o piloto.** Exigir sessão local autenticada para ler ou alterar trabalhos, separar permissão de consulta da de aprovar, derivar o ator da sessão e expor documentos apenas por consulta autorizada. Para o primeiro piloto, uma identidade local explícita é suficiente como desenho inicial. A validação deve demonstrar que um cliente local sem sessão recebe recusa e que o ator da aprovação corresponde ao operador.

[Leitura de estado](../packages/aurora-api/server.ts#L567) · [Aprovação](../packages/aurora-api/server.ts#L685) · [Sessão da central de recuperação](../packages/aurora-api/recovery.ts#L102)

### P1. Conteúdo e prompts precisam de limites de envio e retenção

O perfil instrumentado anexa o texto integral do original ao contexto recuperado para o especialista ou diretor. O provedor envia o prompt ao Codex CLI e grava prompt, saída e stderr localmente. O outbox também armazena entradas, saídas e conteúdo recuperado. O guardião detecta strings de credenciais conhecidas pelo processo. Não há nesse caminho uma política de quais classes documentais podem ser transmitidas, quais campos devem ser omitidos, por quanto tempo cada cópia fica retida ou como removê-la. A cópia do PostgreSQL guarda os dumps em arquivos separados do manifesto DPAPI.

**Correção para o piloto.** Definir classificação e autorização por fonte para envio ao provedor, minimizar trechos enviados e persistidos, separar trilha de auditoria de artefatos com conteúdo e definir retenção e proteção das cópias. Validar com marcadores fictícios que conteúdo bloqueado não chega ao provedor, aos logs ou a artefatos indevidos. A revisão não fez chamadas comerciais.

[Original integral no contexto](../apps/aurora/runtime/telemetry.py#L95) · [Artefatos do worker](../apps/aurora/runtime/worker.py#L101) · [Gravação do provedor](../apps/aurora/runtime/services/codex_provider.py#L102) · [Cópia local](../apps/aurora/ops/local_backup.py#L111)

### P1. A citação pode ser válida no catálogo e ainda assim não sustentar a afirmação

O contrato atual verifica a identidade, a versão e o hash do original durante a recuperação. O validador final aceita IDs do conjunto global de fontes vigentes e confere os números esperados do cenário. Ele não liga cada afirmação aos fragmentos efetivamente recuperados, nem verifica que o trecho citado sustenta aquele fato.

**Reprodução.** Chamei `reviewable` com os cinco valores esperados do incidente e a única fonte `aurora-marketing` em todos os fatos. A função aceitou o parecer e calculou o hash.

**Correção para o piloto.** Validar primeiro que cada citação pertence ao conjunto de evidências permitido e visto naquele trabalho, com referência à versão e ao trecho. Depois, verificar o suporte às afirmações-chave com casos conhecidos e revisão de alguém da área. Uma fonte vigente porém irrelevante deve reprovar o teste.

[Reconciliação do original](../apps/aurora/runtime/telemetry.py#L76) · [Validação das citações](../apps/aurora/domain/policy.ts#L147)

## Pendências operacionais

- **P2. O orçamento exibido pode divergir do saldo de reservas.** O painel calcula chamadas a partir das linhas gravadas em `model-calls.jsonl`. A reserva ocorre antes da execução e um timeout pode encerrar a chamada antes de criar a linha. O teto assinado continua aplicável. A leitura do saldo para o piloto deve vir da autoridade e separar reserva, uso confirmado e custo faturado. [Painel de consumo](../apps/aurora/ops/launcher.py#L282) · [Reserva e execução](../apps/aurora/runtime/services/codex_provider.py#L37)
- **P2. O polling cresce com todo o acervo e todo o histórico.** A interface atualiza a cada 1,3 s e `/api/state` carrega todos os trabalhos, com todos os eventos de cada um e os originais. A fila pode operar no recorte demonstrado, mas a tela e o tráfego precisam de projeção resumida, paginação e consulta sob demanda para um acervo maior. [Polling](../apps/aurora/web/main.tsx#L62) · [Snapshot dos trabalhos](../packages/aurora-api/server.ts#L163)
- **P2. A API pode corromper acentos conforme a fragmentação HTTP.** O código concatena cada `Buffer` como texto antes de decodificar o JSON completo. Reproduzi 202 para o corpo UTF-8 inteiro e 409 para o mesmo corpo com um acento dividido entre dois chunks. Decodificar o corpo uma vez com limite em bytes, ou usar um decodificador incremental. [Leitura de JSON](../packages/aurora-api/server.ts#L481)
- **P2. A restauração provada preserva os demais armazenamentos existentes.** O backup local auditado restaura PostgreSQL e exige diários compatíveis no host. A prova não recupera SQLite, Neo4j, arquivos e credenciais após perda simultânea. Documentar a janela recuperável e o procedimento para a cópia autorizada do piloto. [Verificação dos diários](../apps/aurora/ops/local_backup.py#L35) · [Recusa de estado divergente](../apps/aurora/ops/local_backup.py#L152)
- **P2. Credenciais operacionais locais dependem da proteção do diretório de sessão.** O marcador ativo guarda o token do backend, e o arquivo de revisão contém as duas credenciais em texto. O registro de retomada tem DPAPI. Para dados reais, explicitar os usuários Windows que podem ler a sessão, retirar segredos dos arquivos informativos e proteger a custódia das credenciais de revisão. [Marcador ativo](../apps/aurora/ops/launcher.py#L476) · [Credenciais dos revisores](../apps/aurora/runtime/recovery_bridge.py#L9) · [Retomada com DPAPI](../apps/aurora/ops/local_session.py#L56)

## Evidências e ordem de liberação

As verificações do laboratório abrangem admissão durável, slots de inferência, revisão humana, checkpoint, efeitos locais vinculados ao hash, interface e restauração.

| Verificação executada nesta revisão | Resultado |
| --- | --- |
| Build, TypeScript, Ruff e `pip check` nos dois ambientes | PASS |
| Regressão Node da política, HTTP, fila, revisão, telemetria e atividade | 36 passaram |
| Slots de inferência e outbox | 6 passaram |
| Edge, mapa 3D, acervo, delegação, lista e p95 em tela larga e estreita | PASS com respostas fictícias |
| Backup e restauração com o ambiente dedicado | PASS em 162,43 s. Reabertura em 49,203 s, 16 fontes preservadas, zero novas extrações, mesmo recibo e ID do trabalho enfileirado. |
| Provas dirigidas com SQLite temporário e backend controlado | Confirmadas a leitura e aprovação sem sessão, a aceitação de citação irrelevante e a corrupção de UTF-8 fragmentado. |

[JUnit da restauração](../validation/aurora-local-restart/review-01.xml) · [Evidência operacional](../validation/aurora-local-restart/evidence-13f046d114.json) · [Comandos da suíte](../docs/ORGANIZACAO_AURORA.md#verificação)

Ordem de liberação

1. Preparar a entrada local de piloto e o isolamento do perfil fictício. Definir o que pode sair da máquina para o provedor.
2. Proteger leitura e aprovação e comprovar a identidade do operador com clientes locais independentes.
3. Vincular citações ao material efetivamente consultado e exercitar uma tarefa aberta com versões conflitantes, uma citação irrelevante e uma pergunta sem evidência suficiente.
4. Repetir com uma área e uma tarefa real, mantendo a entrega em modo consultivo, com conferência das fontes por alguém da área.
