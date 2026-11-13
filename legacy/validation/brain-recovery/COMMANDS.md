# Comandos e limites — 04/11/2026

Execução em `C:\Users\PC\multi-agent`, Windows/PowerShell. Diretórios `.state` contêm somente fixtures desta qualificação; dumps e chaves privadas não são artefatos de distribuição.

## Inspeção e pré-checagem

```powershell
git -C vendor/lightrag rev-parse HEAD
git -C vendor/lightrag status --porcelain
git -C vendor/langgraph rev-parse HEAD
git -C vendor/langgraph status --porcelain
& validation/python/cpython-3.11.18-windows-x86_64-none/python.exe validation/brain-recovery/payload_guard.py
```

LightRAG `aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a`, LangGraph `3c916d750575b22c464790e9774494d810ccd322`; ambos sem alterações locais na inspeção. Versões do ambiente são registradas separadamente. Os pesos ONNX são conferidos por hash ao iniciar o serviço, sem downloads.

A primeira solicitação de execução elevada foi recusada pela revisão automática antes da criação do processo: risco de enviar fontes canônicas ao modelo sem comprovar payload sintético. Não foi contornada. Depois foram criados [corpus fechado](corpus.json), [guard](payload_guard.py) e [pré-checagem](payload-preflight.json). Nova execução foi aceita. O corpus contém três políticas inventadas da empresa fictícia ACME; o marcador `SIGILO_FIXTURE_FINANCEIRO` é um canário sintético de ACL, não segredo de cliente. O dossiê não integra o payload.

## Ensaios integrados

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_brain.py --basetemp=validation/brain-recovery/.temp-first -q -s --junitxml=validation/brain-recovery/attempt-1.xml > validation/brain-recovery/attempt-1.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_brain.py --basetemp=validation/brain-recovery/.temp-second -q -s --junitxml=validation/brain-recovery/attempt-2.xml > validation/brain-recovery/attempt-2.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_brain.py --basetemp=validation/brain-recovery/.temp-third -q -s --junitxml=validation/brain-recovery/attempt-3.xml > validation/brain-recovery/attempt-3.log 2>&1
```

Cada instalação limita a autoridade a 16 reservas de modelo e 64 unidades sintéticas de negócio. Não são limites monetários. Chamadas reais usam o adaptador Codex existente com Terra, CLI efêmera, sem shell/web, ambiente filtrado e auditoria de eventos de ferramentas. O guard confere o conteúdo aprovado com a allowlist e procura credenciais de serviço antes da inferência. Isso delimita o ensaio; não homologa um filtro DLP empresarial.

Tentativa 1: FAIL, espera da trava retida de dez segundos insuficiente para duas leituras paralelas com inferência. Adicionado `commitWaitMs` configurável, mantendo dez segundos por padrão; perfil deste ensaio usa espera 330 s e leases 900 s. Não prova renovação de lease ou throughput.

Tentativa 2: FAIL depois da primeira consulta e backup; Neo4j havia iniciado, mas a conexão Bolt ainda não estava pronta. A bancada passou a consultar a prontidão antes de iniciar/reabrir o serviço nativo. As capturas anteriores permanecem em `attempt-1-evidence` e `attempt-2-evidence`.

## Regressões

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_witness.py validation/concurrent-reconciliation/test_authority.py validation/governed-recovery/test_votes.py validation/langgraph-retained-flow/test_budget.py -q --basetemp=validation/brain-recovery/.temp-unit > validation/brain-recovery/unit-tests.log 2>&1
node --test validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts > validation/brain-recovery/node-tests.log 2>&1
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-retained-flow/retained.ts validation/brain-recovery/brain.ts > validation/brain-recovery/typecheck.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/governed-recovery/test_recovery.py --basetemp=validation/brain-recovery/.temp-regression -q --junitxml=validation/brain-recovery/regression.xml > validation/brain-recovery/regression.log 2>&1
```

A primeira invocação Node desta rodada apontou para `business.test.ts`, nome inexistente, e executou somente quatro testes de assinatura. A lista foi corrigida: o log final contém os 16 testes efetivamente executados. O compilador é reaproveitado da instalação existente; isso não recoloca Paperclip na arquitetura.

A regressão governada inicialmente usou o destino padrão e substituiu `results.json` e a chave pública exportada daquele bloco. Os novos arquivos foram capturados em `regression-evidence`; o export atual foi alinhado à nova execução. JUnit/log/manifesto/verification anteriores e o stream anterior de provas foram preservados. A chave pública do stream antigo não foi recuperada, portanto esta rodada não o reconta como novamente verificado. `RecoveryLab` agora respeita `QUALIFICATION_EVIDENCE_DIR`, evitando novas colisões.

Docker opera somente contêineres/volumes rotulados com o ID da instalação; cleanup verifica rótulos, sem prune. PostgreSQL/Neo4j têm imagens fixadas por digest. Neo4j-admin dump/load é offline; a restauração usa novos volumes. Chaves de aplicação são cifradas com AES-GCM; KEK e autoridade retida ficam fora do bundle, na mesma bancada. Não é KMS/DR externo.

## Consolidação

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe validation/brain-recovery/record.py
```

O verificador confere assinaturas Ed25519, instalação, nonce/prazo registrado, head e sequência, reservas e usage observado. As provas históricas verificadas não são autorizações atuais. Ausência de usage é reportada como desconhecida, nunca como custo zero.
