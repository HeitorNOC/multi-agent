# Registro da simulação Aurora — 05/11/2026

Workspace C:\Users\PC\multi-agent. Orientação do usuário: empresa grande fictícia, documentos/fluxos mais complexos e catálogo amplo no qual Chief escolhe apenas alguns agentes. Login corporativo continua adiado. Nenhuma ação externa, compra, dado real de empresa/pessoa ou contratação.

## Construção

Reutilizados BrainLab, LightRAG, PostgreSQL/pgvector, Neo4j, ONNX e provider Codex já disponíveis. API TypeScript `demo/server.ts` ganhou seleção de perfil somente via configuração do launcher, para reaproveitar admissão, approval/receipt e processos sem duplicar motor. Perfil ACME permanece padrão; regressão HTTP sem modelo passou.

Criados corpus de 17 originais (16 vigentes), catálogo de 7 diretores + 14 especialistas, política de equipe limitada, workers LangGraph com subgrafos departamento/especialista e interface React com mapa central. Cargos são configuração fictícia; nenhum agente fora da seleção recebe slot de inferência. Guard de corpus confere conteúdo/hashes e bloqueia arquivos fora da lista.

Comandos de build/checks:

```powershell
node demo-enterprise/build.cjs
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json
node --test demo-enterprise/policy.test.ts demo/policy.test.ts
node --test demo/server.test.ts
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest demo-enterprise/test_embedding_pooling.py -q
& validation/integrated-pilot/.venv/Scripts/python.exe -m py_compile demo-enterprise/start.py demo-enterprise/worker.py validation/brain-recovery/native.py
```

Strict e oito testes de política passaram; regressão HTTP compartilhada passou. Dois testes de segmentação/pooling passaram. Emissão de warning preexistente do pytest-asyncio sobre loop scope foi preservada. Não se trata de testes dos artefatos acadêmicos.

## Tentativa 1: fragmentação, custo e cancelamento

Inicialmente configurado teto de 48 reservas de modelo, corpus fictício autorizado, parâmetros de extração de 512 tokens. O limitador de embedding de 128 tokens do perfil herdado ainda partia cada documento em vários chunks. Isso gerou múltiplas chamadas de extração por documento, apesar do chunk configurado. A tentativa foi parada antes de consumir o teto completo.

A parada graciosa inicial só verificava o evento depois de todo o loop de ingestão: ela não interrompeu a preparação como esperado. Interrompida então a árvore exata do launcher PID 31708, após conferir comando `demo-enterprise/start.py` e derivar apenas seus descendentes; a árvore incluiu o subprocesso Codex em andamento. Nenhum processo alheio/ACME foi encerrado.

Captura final: **23 reservas, 22 chamadas com saída registrada e uma desconhecida/interrompida**. Não chamar essa reserva de gratuita ou supor que não executou. Dados em `evidence/first-attempt.json`; logs/saídas originais em `.state/session-919139542b`, teste em `first-scenarios.log` e `evidence/first-scenarios.json`. Containers desse ID foram parados somente após conferir label qualification; volumes e arquivos preservados. Sem prune.

Adaptação: perfil enterprise passou a declarar embedding composto de 512 tokens e o serviço ONNX a segmentar todos os textos em janelas WordPiece até 120 tokens; todos os segmentos são embutidos e combinados por média ponderada normalizada. Log mede quantidade, comprimento real e truncamentos. O comportamento padrão dos outros perfis é mantido. O loop de startup passou a verificar parada antes de cada próximo documento.

O teto agregado foi explicitamente ajustado para **64 reservas somando tentativas**, descontando as 23 anteriores: sessão corrigida tem cap 41. Novo lançamento foi autorizado com esse escopo. Não foi fixado gasto monetário porque a bancada Codex não fornece fatura atribuível. Não ocultar custo da tentativa inicial ao mostrar apenas a sessão corrente.

## Tentativa 2: identificador do embedding

O identificador novo e longo produziu um nome de tabela PostgreSQL com 64 caracteres, excedendo 63. Startup falhou antes de chamar modelo; zero novas reservas. Corrigido para `minilm-faf4aa4-pool512`, com espaço vetorial distinto do modelo direto original. Evidência da falha em `.state/session-9dbbabf997` e `evidence/second-scenarios.json` / `scenarios-second.log`. Encerrada graciosamente.

## Tentativa 3: perfil corrigido

Lançamento em segundo plano com `Start-Process -WindowStyle Hidden`; sessão `.state/session-4ad8bd6ed4`; endereço http://127.0.0.1:58678 . Os recursos são exclusivos da instalação; a demo ACME anterior continua separada.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/test_scenarios.py *> demo-enterprise/scenarios-third.log
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/record.py
```

O teste aguarda ingestão, pede campanha e incidente em sequência e verifica: equipe escolhida = agentes efetivamente concluídos = slots de inferência; inativos não invocados; equipes diferentes; fatos/cálculos do corpus; aprovação pendente sem efeito; retomada em outro processo sem inferência nova. Gabarito está na política/teste, não no prompt do modelo. Resultados finais em `RESULTS.md` e `evidence/scenarios.json`.

## Interface e evidências

Na terceira sessão, o stdin do Python no Windows alterou os acentos do pedido UTF-8 recebido do Node, impedindo a identificação do cenário na síntese. Corrigido para `sys.stdin.buffer.read().decode('utf-8')`; o mesmo checkpoint foi retomado, preservando nove inferências anteriores. Ver `evidence/third-initial-scenarios.json`.

A síntese retomada foi rejeitada: `Fato inconsistente: combined_demand_units`. O contexto recebido levou o modelo a tratar 5.000 pedidos como quantidade desconhecida de unidades, sem reconciliar as 5.000 unidades explicadas pelo Comercial. Não se alterou o gabarito nem o resultado armazenado para fazê-lo passar. Uma confirmação do erro reutilizou a síntese sem nova inferência. Ver `evidence/third-recovered-campaign.json`.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/test_scenarios.py --campaign-job 52f79404-51c9-4660-8e2d-c11ec9479ac6 *> demo-enterprise/scenarios-final.log
```

O parâmetro adota o trabalho existente para evitar nova campanha. O teste continua para o incidente, mantém resultado global FAIL se qualquer cenário falhar e agora retorna código diferente de zero. A execução iniciada antes desse ajuste final de código de saída deve ser interpretada pelo campo `result` do JSON, não só pelo código do processo.

Conferência final dos dois trabalhos existentes, sem nova inferência:

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/test_scenarios.py --campaign-job 52f79404-51c9-4660-8e2d-c11ec9479ac6 --incident-job f21b2829-9513-4f5a-9c7c-02d15e443d0c *> demo-enterprise/scenarios-verified.log
```

Saída observada: código **1**, resultado global **FAIL**, incidente com seis slots e retomada sem inferência. Exportação final: 32 chamadas na sessão, 55 reservas agregadas, zero truncamentos registrados. `evidence/decisions.json` verifica seleção = execução = inferências e preserva o candidato rejeitado. Oito testes de política e dois de embeddings passaram; logs `unit-tests.log` e `embedding-tests.log`.

Browser in-app reaberto após reset da ligação antiga. A interface foi conferida por accessibility/screenshot; SVG interativo usa grupo e botões acessíveis, e seletor textual permite inspecionar os 21 agentes. Ajustados enquadramento/ampliação para não cortar o cérebro em viewport estreito. Nenhum vídeo indisponível foi alegado como assistido.

`record.py` exporta somente corpus fictício, catálogo, planos, retornos/traces, métricas e hashes. Não exporta tokens, DSNs, credenciais de fixture ou prompts privados. A evidência da primeira tentativa e suas reservas é mantida separada. Nenhum resultado altera os quatro FAIL de V1 ou declara homologação de carga/produção.
