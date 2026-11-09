# Decisão técnica — 2026-11-03

**NO-GO para aprovar a adoção agora.** Paperclip permanece candidato a control plane organizacional: a integração mínima por plugin externo funcionou sem fork. A falha de cancelamento da fronteira e os gates abertos impedem aprovação empresarial. Isso não é rejeição definitiva do projeto nem invalida a arquitetura do produto.

O dossiê foi lido integralmente; não recebemos a exportação literal da conversa original. O workspace estava vazio. Dados e credenciais criadas são de teste. A auditoria foi seletiva, com PoC real; não é certificação integral de segurança/licença/produção.

## Versões e alcance

| Componente | Versão efetivamente usada |
|---|---|
| Paperclip | SHA 1e3ab690b072bbf6a1c1f1d0454ea49315b2074c, detached; shared/adapter-utils 0.3.1, plugin-sdk 1.0.0 |
| LangGraph | SHA 3c916d750575b22c464790e9774494d810ccd322; 1.2.19, checkpoint 4.3.1, sqlite 3.1.3, SDK 0.4.11 |
| LightRAG | SHA aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a; 1.5.8 |
| Ambiente | Windows; Node 24.20.0; Git 2.55.0.windows.5; Python 3.12.14; pnpm usado 9.15.4 |
| Banco | embedded-postgres 18.1.0-beta.16; 421 migrations |

[manifest.json](evidence/manifest.json) fixa versões/hashes e diff versionado vazio nos três clones. Há 1.541 arquivos de teste no servidor; executamos uma seleção, não toda a suíte. [COMMANDS.md](COMMANDS.md) relaciona comandos e falhas. [SOURCE_TRACE.md](SOURCE_TRACE.md) fornece links imutáveis SHA/arquivo/linha. [MATRIX.csv](MATRIX.csv) separa requisitos e evidências. Nenhum core foi modificado.

O GitHub foi consultado com timestamp em [github-metrics.json](evidence/github-metrics.json). Popularidade não foi critério de aprovação. O upstream avançou depois do clone; a decisão continua vinculada ao SHA registrado.

## Resultado executado

| Execução | Resultado |
|---|---|
| Baseline corrigido | 116 testes PASS; três suites sem coleta por SDK não compilado; exit 1; 37,92s |
| Heartbeat após preparo oficial SDK | 193 PASS, 2 asserções FAIL; 2 arquivos FAIL/4 PASS; também falhou teardown PostgreSQL; 226,31s |
| Segurança/orçamento/cancelamento upstream | 116 testes PASS; um arquivo FAIL no teardown PostgreSQL; exit 1; 192,02s |
| PoC Python final | 8 PASS; 3,48s; [JUnit](evidence/boundary-python-final.xml) |
| HTTP upstream real contra stub | 9 diagnósticos PASS, mas requisitos de lifecycle FAIL; [JSON](evidence/http-probe.json) |
| E2E aplicativo real | PASS; run 7397218f-c102-4085-8b7e-7564c7b82036 e issue a82311c6-f159-40d3-9160-cf733f2c4fb1; [JSON](evidence/live-e2e.json) |
| Serviço Python real sob falha | replay concorrente PASS, conflito 409, assinatura forjada 403; cancelamento remoto FAIL; [JSON](evidence/fault-probe.json) |
| PostgreSQL restore físico | PASS após diagnosticar PID órfão; dados de issue/run/usage preservados no mesmo host/versão; [JSON](evidence/postgres-restore.json) |
| LightRAG upstream workspace | 42 PASS; 4 FAIL por FastAPI ausente no SDK-only; [log](evidence/lightrag-upstream.log) |

Não somar contadores como testes únicos: existe sobreposição. As falhas de teardown não viraram sucesso porque as asserções passaram. Duas asserções de recovery esperavam processGroupAlive:true; o observado no Windows difere, embora o PID continue vivo. A causa exclusivamente Windows é hipótese, não conclusão: reproduzir Linux antes de escolher plataforma.

O baseline iniciou API sem UI, PostgreSQL exclusivo e telemetria desligada em loopback. O E2E criou outro home e instalou plugin pela API oficial. Duas companies fictícias testam scoping interno; isso não transforma o produto em SaaS multi-tenant. Os modelos são stubs/vetores constantes, sem chamadas pagas ou contas pessoais.

## Caminho real: issue → run → executor → conclusão → custos → recovery

1. `server/src/routes/issues.ts:13911` recebe PATCH; alterações de assignment/status disparam queueIssueAssignmentWakeup (também :12948 e :17656). `services/issue-assignment-wakeup.ts:46` ignora backlog/sem responsável e emite wake assignment com issueId.
2. `services/heartbeat/queue.ts:368` constrói fila; :1995 retoma e :2063 despacha. Checkout em `services/issues.ts:12150` valida agente/empresa/holds/dependências; a atualização transacional em :12234 condiciona status/assignee/checkoutRunId/executionRunId. Isso não estabelece exatamente-uma-vez sobre ferramentas externas.
3. `heartbeat/runtime-execution.ts:258` deriva JWT do host para adapter que declara supportsLocalAgentJwt; :845 chama adapter.execute com identidade, signal e callbacks. `packages/adapter-utils/src/types.ts` contém authToken/onUsage/usageByModel e campos mais ricos que os exemplos resumidos do dossiê.
4. `POST /api/adapters/install` em `routes/adapters.ts:330` carrega factory pelo plugin-loader. Nosso adapter recebe identidade do host, assina envelope com chave efêmera e chama serviço Python loopback. Nenhuma role informada pelo LLM concede permissão.
5. Python valida assinatura/tempo/empresa, deduplica admissão SQLite e executa LangGraph com checkpoint. Chief of Staff e controlador são nós distintos; dois especialistas por capacidades consultam LightRAG. A decisão A3 com razão é fixture registrada; não é um controlador adaptativo completo nem benchmark A0–A4.
6. Após retorno Python completed, o plugin usa authToken do run e X-Paperclip-Run-Id para PATCH /api/issues/:id {status:done}. `heartbeat/run-completion.ts:432` resolve o run e :564 projeta usage. Observado: run succeeded, issue done, effects:1, recibo com custo/tokens zero, coerente com ausência de modelo.
7. `heartbeat/runtime-execution.ts:951` captura usage; recovery tem caminho próprio em `heartbeat/recovery.ts:2640`. Checkpoint reaberto e restore de banco são evidências menores que recuperação integrada de worker morto durante efeito externo.

Em auth, middleware/auth.ts hasheia API keys e verifica JWT/revogação. `services/authorization.ts:2270` nega company divergente e cruza grants, responsável e escopo; access.ts centraliza memberships/grants. Isso não propaga ACL automaticamente ao Knowledge/MCP. E2E: contratação sem aprovação →409; token agente A acessando company B →403; chave revogada →401. O operador local_trusted é somente laboratório: não prova login humano de produção.

## Achados e adaptações necessárias

**HTTP built-in é insuficiente para nosso lifecycle.** `http/execute.ts:11` lê timeoutMs, enquanto docs/registry anunciam timeoutSec. O payload não inclui companyId automaticamente no top level; envia agentId/runId/context, com campos adicionais via payloadTemplate. Não há contexto empresarial assinado por padrão. Respostas 200 e 202 retornam exitCode 0 sem interpretar body, usage ou cost; 400/500 lançam erro sem retry no execute. Testes reais confirmaram timeoutMs funcional, timeoutSec ignorado, ctx.signal abortado ignorado e dois efeitos em duas entregas ao worker ingênuo. Sucesso do adapter/run não implica automaticamente issue concluída. Não usar esse adapter como solução assíncrona completa.

**SSRF tem controles reais reutilizáveis.** O guard bloqueou privados fora de allowlist e metadata mesmo allowlisted. Testes upstream exercitam redirects manuais, DNS e rebinding. A autorização privada é por origem exata incluindo porta, via PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST. Nosso plugin restringe loopback; isso não é egress policy/mTLS empresarial.

**Aprovação de contratação exige configuração explícita.** `packages/db/src/schema/companies.ts:19` usa default(false). A PoC habilitou requireBoardApprovalForNewAgents:true após criar o bridge de laboratório e confirmou 409. No produto, ativar no bootstrap antes de qualquer contratação e usar hire/approval. O período aberto da fixture não é padrão de implantação proposto.

**Cancelamento remoto bloqueia aprovação.** Propagar AbortSignal à espera HTTP não interrompe o grafo Python: faltam comando durável cancel, ack de término, fencing e reconciliação. O teste atrasou revisão em 500ms, abortou cliente em 100ms e consultou após 800ms: o remoto concluiu com efeito. Replay não repetiu esse efeito, mas também não o cancelou. Timeout e término são fatos diferentes. Essa falha pertence ao boundary experimental; não demonstra incapacidade intrínseca do Paperclip.

**LightRAG não foi aprovado como cérebro completo.** Injetamos chunks preparados via ainsert_custom_kg e consultamos naive com embeddings/tokenização determinísticos, IDs/fontes e empresas sintéticas A/B. Negação pré-retrieval e segregação foram exercitadas no wrapper. Não testamos ranking/extração reais, híbrido com relações, ACL entre departamentos no mesmo corpus, vigência, versões documentais ou qualidade. `lightrag.py:4354` avisa que custom KG está fora da garantia journaled de recuperação documental. Usar ainsert/ainsert_custom_chunks no próximo ensaio de ingestão e avaliar Graphiti se a memória temporal exigir; não reimplementar essas bibliotecas.

**Orçamento não se reduz à UI, mas ainda não foi qualificado E2E.** O código atual possui reservas/recibos, reportado/estimado/unpriced e gates concorrentes (`services/budgets.ts:206` e :220). As asserções upstream selecionadas passaram. E2E conciliou somente zero. A reserva concorrente de 9 unidades no teste Python é fictícia, não o orçamento mensal Paperclip integrado. Não prova teto com APIs externas, overshoot, per-model e estimativa versus fatura. Implementação final deve delegar limites de uma única autoridade financeira; não manter políticas concorrentes no Paperclip e no runtime.

## Recuperação do banco de laboratório

A primeira tentativa de restore falhou porque pg_ctl encontrou postmaster.pid de um processo já inexistente. O arquivo inicial permanece em evidence/postgres-restore-initial-failure.json. Antes da segunda tentativa, confirmamos PID ausente e conexão recusada na porta 54339. Copiamos o cluster parado para outro diretório da PoC e removemos somente o marcador PID da cópia; o original permaneceu intacto. O PostgreSQL restaurado em 54349 recuperou a issue done, o run succeeded e os recibos de usage; foi desligado com sucesso. Isso prova restauração física local após saída do processo, inclusive WAL recovery se necessário, sem provar DR entre hosts, backup de secrets/storage/cache ou retomada completa do aplicativo.

## Gates do dossiê

| Gate | Status no escopo auditado |
|---|---|
| 1 E2E Paperclip/LangGraph/LightRAG | PASS integração real com conteúdo/vetores/especialistas sintéticos; sem qualidade LLM |
| 2 Ack ≠ conclusão e estado honesto | PASS plugin no fluxo feliz; HTTP insuficiente; falhas de callback NOT TESTED |
| 3 Retry sem duplicação externa | PASS mesmo run/inbox SQLite; novo runId e fornecedor externo NOT TESTED |
| 4 Permissões/isolamento | PASS company e negações fixture; ACL confidencial intradomínio/MCP real NOT TESTED |
| 5 Credenciais e sandbox | NOT TESTED produção autenticada, mTLS, sandbox e secrets |
| 6 Custo/orçamento multiagente | NOT TESTED E2E não zero/per-model/ferramenta; primitivas upstream existem |
| 7 Sem patch extenso | PASS fluxo mínimo sem core alterado; custo de evolução não demonstrado |
| 8 Cancel/recovery/trace | FAIL cancel remoto; recovery integrado NOT TESTED; IDs rastreáveis PASS |
| 9 Sem conta pessoal obrigatória | PASS PoC sem conta/modelo; service accounts e termos atuais NOT TESTED |
| 10 Instalação/backup/telemetria isolados | PASS home/banco/telemetria de laboratório; DR completo por cliente NOT TESTED |

MATRIX.csv explicita requisito → arquivo/contrato → teste → resultado PASS/FAIL/BLOCKED/NOT TESTED. Sucesso de probe que reproduz falha não é PASS do requisito. Não executamos cancelamento em cada etapa, todas as ordens de callbacks reais, MCP real, corrupção/migração de checkpoint, morte abrupta e retomada completa do worker, rotação HMAC, restauração de secrets/storage/cache ou benchmark p50/p95. Oito testes locais não preenchem essas lacunas.

## Riscos e responsáveis propostos

Probabilidade é julgamento de engenharia, não frequência estatística medida.

| Risco | Criticidade / probabilidade | Mitigação | Owner |
|---|---|---|---|
| Efeito após cancel/timeout | Crítica / demonstrada | cancel durável, ack, fencing e reconciliação | Boundary + runtime |
| Novo run repete intenção | Crítica / não medida | chave de intenção estável, outbox/inbox, dedupe no provedor | Boundary + MCP gateway |
| Vazamento Knowledge entre ACLs | Crítica / não medida | autorização antes de graph/vector retrieval; testes por domínio | Knowledge API |
| Custo concorrente supera teto | Alta / não medida | reserva única, receipts completos, unpriced fail closed | Control plane + Controller |
| Issue done com run falho | Alta / não medida | outbox de conclusão versionada e reconciliação | Boundary |
| Recovery/teardown Windows | Alta / reproduzida | repetir Linux no SHA; qualificar ownership/stop | Infra + integração |
| Hire sem approval por default | Alta / default observado | bootstrap fechado e fluxo governado | Governança |
| Chaves/sandbox insuficientes | Crítica / não medida | workload identity, rotação/revogação, egress/sandbox por cliente | Segurança/Infra |
| Drift docs/contratos/deps | Média / observado | SHA/lock fixados e upgrade gates | Manutenção |
| Custom KG sem journal | Alta / documentada | ingestão recuperável e teste de rollback/reindex | Knowledge API |

## Classificação por componente e manutenção

Estas classificações indicam a via técnica candidata; não são aprovação de produção.

| Componente | Classificação | Evidência/custo relativo |
|---|---|---|
| Empresas/organograma/objetivos/issues | Adotar por API, condicionado | E2E e checkout reais; reportsTo é supervisão, não grafo cognitivo. Manutenção média |
| Aprovações/hire | Adotar por API, condicionado | Gate funcionou com flag ligada. Custo baixo/médio |
| HTTP built-in como lifecycle completo | Rejeitar nessa função | ack/custos/cancel insuficientes; útil para invocação simples |
| Fronteira LangGraph | Plugin externo | Factory/API oficial funcionou. Protocolo durável/receipts ainda exigidos; custo médio/alto |
| Scheduler/checkout/recovery | Adotar por API, condicionado | Preservar domínio Paperclip; não copiar serviços. Qualificação alta |
| Usage/budgets | Adotar por API + plugin externo | Emitir onUsage/usageByModel e reservas delegadas; financeiro E2E aberto |
| Auth/identidade | Adotar por API + fronteira externa | JWT/run/scoping reais; grants precisam alcançar Knowledge/MCP |
| Chief of Staff/Controlador | Runtime externo LangGraph | Autoridades separadas; fixture não valida composição adaptativa |
| LightRAG | Integração externa condicionada | Não fork; Knowledge API própria para ACL/fontes/tempo/versões |
| Graphiti | Avaliar se necessário | Candidato temporal, sem reimplementação caseira |
| UI JARVIS | Separada, adiada | Manter grafo vivo/clicável; auditar assets/licença |
| Fork Paperclip | Não necessário no experimento | Nenhum patch. Se exigir refazer auth/issues/scheduler, reabrir decisão; fork não autorizado implicitamente |

Os três cores trazem LICENSE MIT nos clones; hashes preservados. ClipLab embutido também tem MIT e PROVENANCE próprios. Não houve inventário completo de transitivas/plugins/imagens/fontes/JARVIS ou termos de provedores. A distribuição exige preservar notices e completar esse inventário; esta observação dos arquivos não é aprovação jurídica.

Upgrades devem fixar SHA/lock, registrar migrations e repetir contract probes, E2E, auth/hire, receipts, cancel/recovery e restore antes de promover. Versionar o plugin separadamente e manter tabela de compatibilidade. Não há estimativa de horas medida; comparar manutenção plugin/fork exige ensaiar ao menos uma atualização upstream.

## Arquitetura preservada e segundo experimento

Uma instalação por cliente, um cérebro central, dados/segredos/execução/logs/políticas/orçamento isolados; nenhum cadastro público multi-tenant. Produto estruturalmente multiagente, catálogo por capacidades e colaboração transversal sem alterar organograma. As duas capacidades fixas são fixture de teste; cargos/agentes não são fixos no produto. Agentes permanentes exigem aprovação e temporários respeitam policy. Markdown/Obsidian opcionais. JARVIS funcional continua requisito, adiado até backend qualificado.

Chief of Staff comunica/sintetiza; Controlador Adaptativo escolhe estratégia/concorrência/composição dentro de limites delegados; Paperclip governa responsabilidades, approvals e orçamento. LangGraph governa etapas/checkpoints. Um só disparo organizacional evita cron/heartbeat/Temporal concorrentes. Sem NestJS ou microserviços por estética. FastAPI/MCP/Temporal/Kafka/Redis continuam opções justificáveis, não obrigações. A PoC usou aiohttp, já nas dependências, como fronteira mínima.

O primeiro experimento foi mensurado e reproduz um bloqueio específico. Segundo experimento recomendado: fechar cancelamento durável e reconciliação de conclusão no plugin/serviço, com intenção estável entre retries e outbox. Matar worker após efeito e antes da resposta; reiniciar e provar uma entrega, estado honesto e receipts não zero por modelo com fixtures. Repetir Linux sem patch core. Depois qualificar ACL intradomínio, MCP, budgets concorrentes e DR completo. Não iniciar produto/UI ou contratar infraestrutura antes dos gates.

Se satisfazer o protocolo exigir reescrever scheduler/issues/auth, rejeitar Paperclip como fundação e manter LangGraph + Knowledge API com módulo organizacional mínimo ou comparar outro control plane existente. Implementar apenas a lacuna, sem reimplementar LangGraph, LightRAG, Graphiti ou o Paperclip inteiro.
