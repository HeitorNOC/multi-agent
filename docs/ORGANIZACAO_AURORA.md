# Organização do Aurora

## Onde trabalhar

```text
apps/aurora/
  domain/        Cenários, validação da seleção e regras de aprovação
  web/           Entradas React, mapa, parecer, central de recuperação e build
  runtime/       Worker LangGraph, prompts e serviços de conhecimento e inferência
  ops/           Inicialização, retomada da sessão, backup e restauração
packages/
  aurora-api/    API HTTP e SQLite, admissão da fila, recuperação e eventos
  aurora-business/ Serviço de negócio, publicação editorial e autoridade assinada
demo-enterprise/ Comandos de compatibilidade, HTML, catálogo e corpus fictício
demo/            Jornada ACME e pontos de entrada usados por testes existentes
validation/      Ensaios reproduzíveis e evidências
docs/            Decisões, guias e critérios
```

- Para mudar a composição das equipes e os requisitos da proposta, comece em [domain/policy.ts](../apps/aurora/domain/policy.ts). A API seleciona essa política na inicialização pelo launcher local.
- Para mudar a execução do grafo, comece em [runtime/worker.py](../apps/aurora/runtime/worker.py). Os quatro contratos de texto do modelo ficam em [runtime/prompts.py](../apps/aurora/runtime/prompts.py). O estado do LangGraph e os pontos de pausa humana continuam definidos no worker.
- Para mudar a capacidade ou a reserva de vagas, comece em [queue-admission.ts](../packages/aurora-api/queue-admission.ts). O servidor mantém sob a mesma transação as atualizações do trabalho, da fila e dos eventos.
- Para mudar a apresentação, use [BrainMap.tsx](../apps/aurora/web/BrainMap.tsx) para os mapas de agentes e acervo, [PerformancePanel.tsx](../apps/aurora/web/PerformancePanel.tsx) para o monitoramento e [DecisionReport.tsx](../apps/aurora/web/DecisionReport.tsx) para o parecer. [main.tsx](../apps/aurora/web/main.tsx) compõe a jornada e coordena o estado da tela.
- Para operar uma instalação, use os comandos do [guia do Aurora](../demo-enterprise/README.md) e do [procedimento de backup](../validation/aurora-local-restart/BACKUP.md). As implementações estão em [ops](../apps/aurora/ops/).

## Referências de estrutura

O Open SWE separa a aplicação HTTP da composição do grafo. No Aurora, a API local e o worker também têm pontos de entrada próprios. [Open SWE](https://github.com/langchain-ai/open-swe)

O LightRAG organiza a interface React/TypeScript em código de apresentação com responsabilidades separadas. O Aurora mantém componentes para mapa, parecer e recuperação na interface que os usa. [LightRAG WebUI](https://github.com/HKUDS/LightRAG/tree/main/lightrag_webui/src)

## Compatibilidade e limites

Os lançadores, testes e procedimentos existentes mantêm seus caminhos. O código de compatibilidade encaminha a execução para a implementação canônica. Catálogo, corpus, estado de sessão e arquivos gerados continuam sob `demo-enterprise/`, pois os ensaios e as ferramentas de operação usam esses caminhos.

A instalação Aurora usa `apps/aurora/package-lock.json` e dois ambientes Python dedicados. O launcher e o backup usam [local_engine.py](../apps/aurora/ops/local_engine.py) e os serviços da aplicação. Os checkouts de LangGraph e LightRAG em `vendor/` são entradas de build verificadas por commit. O setup instala esses componentes de forma não editável no ambiente Aurora. A demonstração ACME e os ensaios históricos mantêm suas próprias ferramentas.

## Instalar e iniciar em Windows

Use Node 24, Python 3.12, Git, Docker com as imagens fixadas do PostgreSQL e do Neo4j e a pasta dos pesos de embeddings. Consulte os nomes, a revisão e os hashes dos arquivos no [manifesto de embeddings](../apps/aurora/runtime/services/embedding-manifest.json). O setup confere os hashes antes de copiar os pesos para a instalação Aurora. Para o laboratório já provisionado, o comando abaixo reaproveita a pasta de pesos existente.

```powershell
& apps/aurora/ops/Setup-Aurora.ps1 -Python 'C:/caminho/python.exe' -EmbeddingWeights 'validation/decision-qualification/.models/faf4aa4225822f3bc6376869cb1164e8e3feedd0'
& demo-enterprise/Start-Aurora.ps1
```

O launcher da demonstração continua usando a sessão local selecionada e o corpus fictício. Para documentos reais, use o [perfil consultivo do piloto](PILOTO_AURORA.md) com manifesto autorizado e sessão própria. Os dois perfis usam o Codex CLI disponível e autenticado quando executados com o provedor real.

## Mapas e monitoramento

- **Agentes.** A projeção 3D exibe o Chief, diretorias e especialistas. Os estados distinguem disponibilidade, seleção, execução e conclusão a partir dos eventos do trabalho atual. É possível girar, ampliar e recentrar o mapa, além de selecionar um nó pelo teclado.
- **Delegação.** O Chief aparece no topo ou à esquerda. Cada grupo de ramos é distribuído simetricamente a partir do centro do seu nó pai. Cartões e conectores SVG usam as mesmas coordenadas, com pontos de ligação no centro das bordas. O diagrama permite rolagem própria em telas estreitas. As ramificações mostram as diretorias e os especialistas escolhidos no plano do trabalho, e os cartões abrem a mesma inspeção do mapa.
- **Lista operacional.** Mostra o Chief e todo o catálogo. Para cada agente, mostra o status, a última atividade registrada, os marcos confirmados de contexto, inferência e entrega, e o tempo observado. O tempo restante usa a mediana de pelo menos três execuções comparáveis do mesmo agente no mesmo cenário, com até dez amostras recentes. Eventos atrasados de uma tentativa anterior não reativam o agente após retomada.
- **Conhecimento.** Documentos aparecem agrupados por área, com versões vigentes e históricas. Selecione um documento para abrir o original no painel lateral. As conexões representam a classificação documental.
- **Desempenho.** Fila e workers representam a instalação. Espera na fila e latência p95 representam o trabalho selecionado. O p95 usa pares de início e fim por slot e execução do worker e informa o tamanho da amostra. CPU e RAM representam o host, RSS representa o processo da API, e os tokens representam a sessão. O painel usa a atualização periódica já existente e o coletor de CPU amostra a cada dois segundos.

## Verificação

Execute na raiz do repositório com o ambiente do laboratório configurado.

```powershell
npm --prefix apps/aurora run build
npm --prefix apps/aurora run typecheck
```

Para editar o código canônico, use Prettier 3.6.2 no TypeScript, JSX, CSS, JSON e build, e Ruff 0.11.13 no Python. Os formatadores são ferramentas de desenvolvimento.

```powershell
npx --yes prettier@3.6.2 --check 'apps/aurora/{web,domain}/**/*.{ts,tsx,css,cjs}' 'apps/aurora/{package,tsconfig}.json' 'packages/{aurora-api,aurora-business}/*.{ts,json}'
ruff check --select E4,E7,E9,F,I apps/aurora
ruff format --check --line-length 100 apps/aurora
```

Os quatro prompts foram comparados com as expressões originais usando as mesmas entradas, incluindo caracteres Unicode. Build e TypeScript passaram para as duas interfaces. Passaram 34 testes Node que cobrem, entre outros, admissão da fila, aprovação, política, eventos e recuperação. Os seis testes de slots de modelo e telemetria também passaram. [Resultado de slots e telemetria](../validation/aurora-local-restart/organization-components-01.xml)

```powershell
node --test validation/aurora-queue/reserve.test.ts validation/human-recovery/recovery_auth.test.ts demo/telemetry.test.ts demo/policy.test.ts demo/server.test.ts demo-enterprise/policy.test.ts validation/observability-recovery/api_effect.test.ts validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts

& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest -q validation/aurora-model-slots/test_slots.py validation/observability-recovery/test_telemetry.py
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest -q validation/aurora-local-restart/test_launcher.py::test_operational_postgres_backup_restore
```

O teste ponta a ponta passou em 136,93 segundos. O laboratório restaurou o PostgreSQL em um contêiner substituto, recuperou 16 fontes sem nova extração, preservou o identificador do trabalho enfileirado e reaproveitou o recibo sem duplicar o efeito. Também recusou o backup adulterado e a tentativa de restauração sobre estado com uma admissão mais recente. O ensaio usou documentos fictícios, provedor de modelo controlado e chamadas HTTP locais. A interface foi verificada pelo build e pela checagem TypeScript. [JUnit da restauração](../validation/aurora-local-restart/organization-01.xml) · [Evidência operacional](../validation/aurora-local-restart/evidence-6c0c5a0959.json)

### Instalação dedicada e mapas 3D

Foram executados o setup, `pip check` nos dois ambientes, o build, a checagem TypeScript e os 34 testes Node de regressão. O teste do Edge verifica os 22 nós, a rotação por arraste e botão, zoom, retorno ao centro, seleção por teclado, estados de execução, abertura de versão histórica e p95. Usa respostas HTTP controladas no navegador.

A restauração ponta a ponta passou em 138,28 segundos com os ambientes Python dedicados e os pesos locais. O ensaio verificou as métricas de memória da API e da máquina, preservou 16 fontes sem nova extração e manteve o recibo e o trabalho enfileirado. Usou PostgreSQL e Neo4j locais e um provedor controlado. [JUnit](../validation/aurora-local-restart/independent-03.xml) · [Evidência](../validation/aurora-local-restart/evidence-36fd4d3f95.json)

```powershell
npm install --prefix validation/.tools/aurora-browser playwright-core@1.65.0 --no-audit --no-fund
node validation/aurora-local-restart/browser-smoke.cjs
node --test validation/aurora-local-restart/agent-activity.test.ts
$env:AURORA_TEST_PYTHON = (Resolve-Path apps/aurora/.venv/Scripts/python.exe).Path
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest -q validation/aurora-local-restart/test_launcher.py::test_operational_postgres_backup_restore
Remove-Item Env:AURORA_TEST_PYTHON
```
