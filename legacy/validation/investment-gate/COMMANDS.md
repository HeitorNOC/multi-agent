# Comandos e registro de execução — 05/11/2026

Ambiente Windows/PowerShell, `C:\Users\PC\multi-agent`. Critérios registrados em [PLAN.md](PLAN.md) antes dos ensaios. Dados e identidades exclusivamente fictícios; nenhuma implantação, compra, contrato ou mensagem externa.

## V1 — continuidade e heartbeat

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/investment-gate/test_v1.py --basetemp=validation/investment-gate/.temp-v1 -q -s --junitxml=validation/investment-gate/v1.xml > validation/investment-gate/v1.log 2>&1
```

Resultado: **3 FAIL, 1 PASS em 41,69 s**. Quatro instalações isoladas; nenhuma chamada de modelo. Saídas injetadas 77 (após intenção, antes do negócio), 82 (após commit empresarial, antes do recibo local) e 83 (após recibo local, antes da confirmação retida). Cada instalação reiniciou APIs, tentou inspeção de recuperação e restaurou a geração pendente em novos caminhos/PostgreSQL/volume. Os FAIL verificam o critério operacional desejado, não foram invertidos para fazer a suíte ficar verde.

O caso complementar de inferência unknown foi executado em outra instalação, sem modelos: `python -m pytest validation/investment-gate/test_unknown.py --basetemp=validation/investment-gate/.temp-unknown -q --junitxml=validation/investment-gate/unknown.xml`, com o mesmo executável acima e log `unknown.log`. **1 FAIL em 5,94 s**: três retries não reexecutaram, mas a inspeção de recuperação recusou o encerramento dessa categoria. [JUnit](unknown.xml).

Modificações: novos pontos opcionais de injeção na bancada retida; worker LangGraph ganhou heartbeat opcional `heartbeat_ms`, requisições de renovação com IDs distintos e interrupção de avanço do grafo quando renovar falha. O teste manteve a consulta bloqueada por três segundos com lease de dois segundos; outra consulta foi fenced durante a execução. Conferiu parada de renovações após terminar e ausência de leitura tardia no caso fenced. Não é homologação de toda falha de rede/heartbeat.

## V2/V3 — conhecimento nativo e equipe

Pré-checagem stdlib conferiu hash e conteúdo dos oito documentos em [corpus.json](corpus.json) com PayloadGuard e credencial fictícia bloqueada: [resultado](payload-preflight.json). A revisão automática aceitou as execuções elevadas com esse payload delimitado. O modelo não recebeu documentos de cliente/dossiê.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/investment-gate/test_v23.py --basetemp=validation/investment-gate/.temp-v23 -q -s --junitxml=validation/investment-gate/v23.xml > validation/investment-gate/v23.log 2>&1
```

- Primeira execução: FAIL em 161,65 s, 13 CLI concluídas. V2 e baseline A1 executados; Psycopg rejeitou ProactorEventLoop no Windows antes da equipe. Corrigido para SelectorEventLoop, conforme o restante dos workers. [JUnit preservado](v23-first.xml), [captura](v23-first-evidence/results.json).
- Segunda execução completa, `.temp-v23-second`: FAIL em 191,18 s, 18 CLI. Equipe real executou, mas pergunta genérica de recuperação trouxe `[no-context]` para quatro fontes; os especialistas se abstiveram e a síntese não tinha os números. [JUnit](v23-second.xml), [captura](v23-second-evidence/results.json). Não atribuir essa falha à incapacidade geral do modelo ou do LangGraph.
- Adaptação: perguntas por capacidade/fonte e erro explícito quando um contexto requerido estiver ausente. Grader passou a reconhecer o mesmo ID com sufixo `:vN.md` como citação equivalente; números, abstenção, causalidade e aprovação não foram relaxados. Quatro regressões do grader incluem a saída original incompleta, que continua reprovada.
- Terceira execução completa, `.temp-v23-third`: FAIL em 211,91 s, 18 chamadas. Fatos e citações foram recuperados, mas a síntese marcou aprovação false enquanto plano/backend a exigiam e mantiveram o interrupt. [JUnit final](v23.xml), [captura](v23-evidence/results.json). O parecer distingue inconsistência do metadado de bypass real e preserva os dois negativos anteriores.

Cada instalação tem teto de 24 reservas Terra. Codex efêmero, sem shell/web, ambiente filtrado, prompts/usage auditados. Extração, respostas, embeddings e armazenamento nativos, sem mock de qualidade. O endpoint de avaliação é somente perfil de bancada autenticado por chave de serviço; não é API empresarial de usuários.

A fonte é assinada por revisor de fixture para staging; isso não reproduz todo o fluxo editorial de produto. Política TypeScript confere identidade Ed25519, grants do contexto assinado, catálogo de capacidades, teto de unidades e aprovação. LangGraph é o único owner do grafo e checkpoint PostgreSQL; interrompe antes de ação externa. Propostas de modelo não são aprovações humanas.

Carga: 16 contextos por concorrência 1/4/8, sem novas gerações LLM; embeddings locais para mil registros sintéticos e tabela pgvector em schema separado, 32 consultas. Medições de storage/recuperação não são benchmark de mil documentos com extração semântica nem de respostas geradas simultaneamente. Delete nativo de um documento torna seu certificado antigo inválido e a consulta é recusada sem nova inferência.

## V4 — controles locais e consulta comercial

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/investment-gate/test_v4.py --basetemp=validation/investment-gate/.temp-v4 -q --junitxml=validation/investment-gate/v4.xml > validation/investment-gate/v4.log 2>&1
```

1 PASS em 4,16 s. Docker com imagem fixada, usuário sem privilégios, sem rede, filesystem readonly, sem volumes do host/credenciais, limites e tmpfs; timeout mata contêiner com processo filho, capacidades expiradas/alteradas/repetidas recusadas. AES-GCM com bytes sintéticos rejeita chave errada e recupera com a correta. Não houve perda física de host, integração KMS ou SSO empresarial nesta prova. [JSON](v4-local.json).

Skill OpenAI Docs aplicada; busca e leitura de páginas oficiais de modelo/API, identidades de projeto, preços e dados: [fontes](SOURCES.md), [snapshot de preço](api-price-snapshot.json). Verificou-se somente presença de `OPENAI_API_KEY` no ambiente do processo: ausente; nenhum valor de credencial foi lido. Nenhuma chamada comercial faturável foi feita. Preço de lista aplicado aos tokens CLI é cenário hipotético, não gasto real do cliente.

## Regressões e conferência

```powershell
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-retained-flow/retained.ts validation/brain-recovery/inference.ts validation/investment-gate/policy.ts > validation/investment-gate/typecheck.log 2>&1
node --test validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts > validation/investment-gate/node-tests.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_witness.py validation/concurrent-reconciliation/test_authority.py validation/governed-recovery/test_votes.py validation/langgraph-retained-flow/test_budget.py -q --basetemp=validation/investment-gate/.temp-units --junitxml=validation/investment-gate/units.xml > validation/investment-gate/units.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/investment-gate/test_grader.py -q --basetemp=validation/investment-gate/.temp-grader --junitxml=validation/investment-gate/grader.xml > validation/investment-gate/grader.log 2>&1
$env:QUALIFICATION_EVIDENCE_DIR=Join-Path (Get-Location) 'validation/investment-gate/governed-evidence'
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/governed-recovery/test_recovery.py --basetemp=validation/investment-gate/.temp-governed -q --junitxml=validation/investment-gate/governed.xml > validation/investment-gate/governed.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe validation/investment-gate/record.py
```

Regressão governada: PASS em 29,18 s; seis testes de autoridade, quatro do grader, 16 Node e strict passaram. Reuso do compilador não reintroduz Paperclip no produto. Não rerodar evidência antiga como se validasse todos os novos contratos.

Exports próprios preservam as rodadas anteriores; provas verificadas por assinatura/nonce/instalação/prazo registrado/head/sequência e contabilidade. Cleanup somente recursos das instalações, com rótulo de ownership verificado pelos helpers; sem prune. Dumps/segredos ficam em `.state`, sem exportá-los como artefatos comerciais. Aviso de configuração futura do pytest-asyncio permaneceu nos logs.
