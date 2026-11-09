# Verificação de reaproveitamento com camada própria — 2026-11-03

**Resposta:** AgentScope e OpenAgents demonstraram integração com módulos nossos fora dos clones. OpenCompany demonstrou registro e execução de um plugin externo por import explícito, mas ainda falta qualificar a aplicação/worker completos. Eigent não teve a execução Workforce confirmada: oito cenários selecionados falharam por timeout, mesmo com o uv.lock congelado. Nenhum desses resultados significa plataforma empresarial completa aprovada.

Os nomes considerados, após a confirmação do usuário, são OpenCompany/zeenie-ai, OpenAgents, Eigent e AgentScope 2.0. Não identificamos um quinto produto independente chamado StudioZote. Não atribuímos testes a um produto sem identidade confirmada.

## Correção sobre Paperclip

A composição com componentes prontos e camada empresarial própria já era uma decisão do produto. A PoC anterior provou um fluxo Paperclip→LangGraph→LightRAG→Paperclip sem fork; portanto não confirmou impossibilidade dessa composição. O NO-GO referia-se aos requisitos não demonstrados e à falha de cancelamento do boundary experimental. A retirada do Paperclip continua sendo a decisão do usuário; a auditoria histórica permanece intacta.

## O que foi realmente provado

| Projeto | Teste executado | Resultado e conclusão permitida |
|---|---|---|
| AgentScope | Equipes, delegação, interrupção/cleanup e engine de permissões upstream | 31 testes PASS, 22 SKIP no Windows; 162 subtestes reportados separadamente. Reuso das primitivas de runtime demonstrado, sem concluir durabilidade de negócio |
| AgentScope | `agentscope/own_layer/probe.py`, fora do clone | PASS: nossa camada compôs dois especialistas, ferramenta própria, política por empresa/escopo e 32 eventos. Modelos determinísticos; nenhuma chamada paga |
| OpenAgents | API/SQLite upstream: access model, identidade e aprovações | 92 PASS; não prova PostgreSQL de produção nem execução cognitiva |
| OpenAgents | `openagents/own_layer/test_api_bridge.py`, fora do clone | 1 PASS: API ASGI real recebeu evento da nossa camada, preservou enterprise_run_id, permitiu polling e negou token inválido com 401 |
| OpenCompany | Helpers upstream de plugins | 9 PASS, no ambiente mínimo inicial. Não é homologação de todas as classes ou do scheduler |
| OpenCompany | `opencompany/own_layer/plugin_probe.py`, dependências declaradas do servidor | PASS: ActionNode nosso, fora do clone, registrado no registry real e chamado por execute. Consulta sintética permitida; empresa divergente negada. Sem stubs do container nessa prova final |
| Eigent | Perfis admitidos/rejeitados upstream | 5 PASS, 37 deselected; perfil correto exigido e browser/terminal/MCP/delegação não aprovados rejeitados na fixture. Esse subconjunto precedeu o alinhamento integral ao lock |
| Eigent | Dependências/handoff privado, assignment inválido e falha do especialista, com lock oficial | 8 FAIL por TimeoutError em 86,36 s; logs mencionam execution preparation requires cleanup. Não afirmar causa raiz sem investigação adicional |

Os números JUnit do AgentScope incluem subtestes: o XML informa 215 entradas, enquanto o resumo pytest informa 31 passed + 22 skipped + 162 subtests. Não apresentar 215 como testes independentes aprovados. Os 22 skips são testes Bash que o próprio projeto desabilita no Windows.

## 1. AgentScope: sim como componente de runtime

SHA: `9668b4c90c70cc214e1b7bb65dec2a6e70b90010`; pacote instalado do clone: `2.0.12.dev0`; Python 3.12.14.

Usamos Agent, Toolkit, ToolBase, TeamMember e TeamPipeline públicos, sem editar o núcleo. O código da nossa camada escolhe capacidades e monta a equipe; o modelo é MockModel do conjunto de testes, não um serviço externo. A ferramenta de conhecimento e suas regras são nossas, com dados sintéticos e fontes/versionamento mínimos no payload. Não se tratou de substituir o runtime real por um mock.

Foi encontrada uma adaptação necessária: em modo DEFAULT, a engine pode autoautorizar ferramentas classificadas como somente leitura antes de consultar check_permissions. Nossa primeira asserção de bloqueio antes de call falhou por isso. Para a ferramenta de conhecimento protegido, sobrescrevemos check_read_only para não usar esse caminho rápido, implementamos check_permissions e mantivemos autorização obrigatória dentro de call. O teste final comprovou que as solicitações sem escopo ou para empresa diferente nem chegaram à chamada. Os logs iniciais de falha foram preservados.

Isso demonstra que nossa política pode ser integrada, não que ACL venha pronta. Uma classificação de efeito/somente leitura não é permissão para ler informação confidencial. O servidor de conhecimento precisa autorizar cada operação independentemente de prompts e modos de confirmação do framework.

**Ainda aberto:** ciclo empresarial durável de run/task, reserva e conciliação financeira, Knowledge API com LightRAG/Graphiti, morte do processo, sandbox e operação por cliente. O pacote avaliado é um snapshot de desenvolvimento, não um release homologado. Se selecionarmos AgentScope, ele e LangGraph precisam ser comparados como donos da execução; não montar coordenadores redundantes automaticamente.

## 2. OpenAgents: sim como infraestrutura de colaboração por API

SHA: `6a330c789c321bdce5856578b7c47c2539ea7fc6`; Python 3.12.14.

A própria camada pode manter sua UI JARVIS, controlador e conhecimento, usando APIs do workspace para colaboração. O wrapper EnterpriseCollaboration foi mantido fora do clone e chamou endpoints reais POST/GET /v1/events via TestClient ASGI. Usamos banco SQLite sintético e fixtures upstream; não houve servidor em produção. Os testes upstream separados exercitaram regras de acesso, identidade e aprovações.

**Limites:** nosso teste de integração usou o modo legado de token de workspace; isso não equivale à identidade assinada granular de produção. Não testamos um executor LangGraph/AgentScope remoto conectado à rede, recuperação de tarefas, orçamento ou ACL de um cérebro semântico. OpenAgents demonstrou colaboração, não a plataforma inteira. A camada própria continua responsável por decisões empresariais, com divisão explícita de autoridades.

A instalação regenerou três arquivos egg-info versionados no clone. O diff foi preservado em openagents/evidence/generated-packaging.diff e somente esses metadados foram restaurados ao SHA original. Nenhuma alteração funcional foi feita no runtime ou nos testes.

## 3. OpenCompany: sim para o mecanismo de extensão; integração de aplicação parcial

SHA: `dc69aec7cfa70732de486512c1ba424bb855fd52`; Python 3.12.14.

Nosso EnterpriseKnowledgeNode estende ActionNode e usa Params/Output Pydantic, Operation, NodeContext e o registry reais. Foi importado de validation/opencompany/own_layer, sem colocar código em server/nodes e sem alterar o núcleo. O execute real retornou conteúdo/fonte sintéticos para empresa autorizada e erro PermissionDeniedError para a divergente.

A primeira tentativa real mostrou que execute importa serviços de chat e chega ao container da aplicação. Um ambiente mínimo não bastou (faltava bcrypt). Instalamos as dependências efetivamente declaradas pelo servidor, incluindo o pin Pydantic 2.12.5, e repetimos com DATA_DIR exclusivo e gateway desligado. Registrar SDKs de provedores durante import não é realizar inferência; a operação de prova não os chamou.

**Limite decisivo:** auto-discovery percorre server/nodes. O import explícito que funcionou não prova que um pacote externo será automaticamente instalado, descoberto e carregado em todos os workers e entrypoints oficiais. Precisamos qualificar um bootstrap nosso para aplicação e workers, NodeSpec/UI e dispatch Temporal. Não demonstramos isso nesta rodada. Tampouco provamos que trocar seu loop/controller pela arquitetura desejada será uma adaptação pequena. Seu próprio loop/delegação/Temporal pode conflitar com um runtime adicional se a divisão não for desenhada.

Stop é documentado como barrar novas admissões e drenar trabalho já admitido, não interrupção imediata de efeitos. Não presumir que usar Temporal elimina o problema de cancelamento visto na PoC anterior.

**Conclusão:** ponto de extensão reutilizável confirmado; aplicação inteira como fundação da nossa camada ainda não confirmada.

## 4. Eigent: não confirmado como fundação nesta rodada

SHA: `4958c94bd91faf4e0bfff270a971d4d1810fb6db`; Python 3.11.18 portátil exclusivo da validação. Backend exige >=3.11,<3.12, então não usamos o Python 3.12 de outros ambientes.

O backend fixa CAMEL e contém serviços de workspace/runtime/journal próprios. O projeto é uma aplicação com conceitos próprios, não apenas uma biblioteca drop-in. Instalamos dependências e depois alinhamos o ambiente ao uv.lock original com uv sync --frozen. A resolução inicial foi preservada, assim como as falhas/interrupções anteriores.

Cinco testes simples de perfil passaram. Os oito cenários selecionados da execução real Workforce, usando CAMEL e substituindo fronteiras de modelo/tokenização, falharam por timeout. Há stack dumps e avisos de preparação/cleanup. Isso impede confirmar reuso operacional do backend. Não prova que CAMEL seja inviável ou que o projeto não funcione em outro ambiente, e não atribuímos a causa exclusivamente ao Windows.

**Conclusão:** manter como referência de produto/UI e estudar CAMEL separadamente se necessário. Não recomendá-lo agora como base confirmada do nosso backend.

## Decisão prática

A evidência mais forte de **camada própria sobre runtime existente** nesta rodada é AgentScope. OpenAgents também se mostrou utilizável para colaboração por API, uma responsabilidade diferente. Isso não significa recomendar obrigatoriamente os dois na mesma instalação. OpenCompany merece qualificação de bootstrap/worker antes de ser tratado como fundação. Eigent não deve receber confirmação com os testes atuais.

Nenhum recebeu GO para todos os requisitos do dossiê. Não testamos cérebro empresarial com ACL/tempo/proveniência completos, budgets agregados não zero, worker morto depois de efeito externo, backup/restore completo ou distribuição comercial por cliente. Licenças citadas na pesquisa continuam sujeitas a inventário de componentes/assets e edição; nenhum desses testes é aprovação jurídica/comercial.

**Preservado:** instalação por empresa, cérebro central persistente, Chief of Staff e Controlador Adaptativo distintos, agentes por capacidades com permanentes aprovados e temporários limitados, colaboração transversal, JARVIS funcional, Obsidian opcional e stack híbrida sem NestJS obrigatório. Não estamos propondo outra vez a composição já decidida; estamos verificando quais componentes aceitam essa composição.

## Evidências e reprodução

manifest.json registra SHAs, Python, dependências observadas, hash do uv.lock Eigent e resultados XML. Cada projeto tem evidence/ com instalação, falhas, stdout, JSON e JUnit. own_layer/ contém somente nosso código experimental. Todos os clones terminaram com diff versionado vazio. Modelos e dados de negócio são sintéticos; não houve produção, publicação, compras ou despesa de inferência.

Instalações usaram ambientes separados. Alguns pytest ficaram sem resultado sob o sandbox; foram registrados/interrompidos apenas os processos desta validação e repetidos com escalonamento. AgentScope inicialmente precisou do extra oficial [service] por import apscheduler. Não transformamos falha de dependência em falha de produto. A coleta XML permite distinguir skipped, collection error, failure e PASS.

Comandos e versões completos podem ser reconstruídos pelos scripts do diretório e pelos logs de instalação. Comandos principais, executados da raiz multi-agent salvo os pytest upstream com cwd indicado:

```powershell
./validation/agentscope/.venv/Scripts/python.exe -X utf8 validation/agentscope/own_layer/probe.py
./validation/openagents/.venv/Scripts/python.exe -X utf8 -m pytest validation/openagents/own_layer/test_api_bridge.py -q
$env:DATA_DIR='C:\Users\PC\multi-agent\validation\opencompany\data'
$env:OPENCOMPANY_GATEWAY_ENABLED='false'
./validation/opencompany/.venv/Scripts/python.exe -X utf8 validation/opencompany/own_layer/plugin_probe.py
```

Upstream AgentScope (cwd vendor/agentscope-audit): `pytest tests/pipeline_team_test.py tests/pipeline_team_cleanup_test.py tests/permission_engine_test.py -q`.

Upstream OpenAgents (cwd vendor/openagents-audit/workspace/backend): `pytest tests/test_access_model.py tests/test_agent_identity.py tests/test_approvals.py -q`.

Upstream Eigent (cwd vendor/eigent-audit/backend): `pytest tests/app/workspace_runtime/test_workforce_adapter.py -k 'actual_task_dependencies_and_private_handoff or unapproved_assignments_fail_before_worker_model_or_tools or worker_failure_preserves_partial_without_publishing_or_retry' -vv -s`. Usar ambiente sincronizado com backend/uv.lock, não resolver ranges novamente. Resultado observado: oito falhas, não uma suite aprovada.


## Adendo posterior: reavaliação solicitada pelo usuário

A ordem Paperclip → AgentScope → OpenAgents foi executada em nova etapa. A impossibilidade do Paperclip NÃO se confirmou: adaptação externa com parada remota verificada passou. A integração conjunta AgentScope/OpenAgents teve 6 cenários PASS, incluindo caracterização de duplicação após perda de acknowledgement. Consulte [reavaliação Paperclip](paperclip-recheck/REPORT.md) e [prova conjunta e decisão](engine-collaboration/REPORT.md). Este adendo atualiza a decisão sem apagar as falhas e limites históricos acima.


## Comparação seguinte dos motores

Foi concluída a etapa autorizada de comparação: 17 PASS, com preferência provisória por LangGraph como dono do workflow. AgentScope continua viável; os limites de produção permanecem abertos. Veja [parecer e evidências](motor-comparison/REPORT.md).


## Investigação posterior de produção

A rodada seguinte investigou cérebro/integridade/ACL, identidade, sandbox, custos e operação por cliente. Foram reproduzidos riscos de informação confidencial no grafo compartilhado e limitações da ingestão direta. Os testes PostgreSQL canônico e saver nativo passaram, inclusive após queda abrupta, mas produção permanece NO-GO. Consulte o [parecer de preparação para produção](production-readiness/REPORT.md). A investigação preserva os resultados históricos acima.
