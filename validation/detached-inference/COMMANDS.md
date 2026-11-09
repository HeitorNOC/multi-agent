# Registro de execução — 04/11/2026

Workspace `C:\Users\PC\multi-agent`, Windows/PowerShell. Reutilizados repositórios reais fixados, ambiente Python e imagens da rodada anterior. Inspeção do fluxo e dos resultados precedeu as alterações; a decisão anterior era continuar protótipo com produção NO-GO.

## Teste controlado e falhas preservadas

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/detached-inference/test_detached.py --basetemp=validation/detached-inference/.temp-first -q -s --junitxml=validation/detached-inference/attempt-1.xml > validation/detached-inference/attempt-1.log 2>&1
```

1. `attempt-1`: FAIL no startup. O construtor TypeScript usava parameter property aceita pelo compilador, mas não pelo Node strip-only. Corrigido para propriedade explícita; import direto Node conferido antes de repetir. Nenhum modelo usado.
2. `attempt-2`: FAIL em 5,80 s, `local inventory differs from retained receipt`. A bancada ativara a tabela nova depois do bootstrap assinado. Corrigida a ordem para configurar o perfil antes da primeira assinatura; não se relaxou a conferência de inventário. [Captura](attempt-2-evidence/results.json).
3. `attempt-3`: PASS em 13,79 s, sete checkpoints. [Captura preservada](attempt-3-evidence/results.json). O roteiro foi ampliado para incluir queda sem recibo, tentativa de injetar resposta e reutilização de ID com input diferente.
4. A primeira execução do roteiro ampliado falhou no startup PostgreSQL em 4,57 s. [JUnit](postgres-startup-failed.xml), [log](postgres-startup-failed.log). `pg_isready` podia ver o socket do servidor temporário de inicialização. Startup e restore passaram a testar `-h 127.0.0.1`, aguardando o serviço final TCP. Sem mudança nas políticas de dados.
5. Roteiro ampliado inteiro repetido: PASS em 14,36 s. [JUnit final](final.xml).

As repetições usaram `.temp-second`, `.temp-third`, `.temp-final` e `.temp-final-second`; logs/JUnit anteriores foram preservados antes de reutilizar o nome final. Cada teste criou seu próprio ID de instalação, processos e volumes. `.state` e dumps privados não são distribuídos.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/detached-inference/test_detached.py --basetemp=validation/detached-inference/.temp-final-second -q -s --junitxml=validation/detached-inference/final.xml > validation/detached-inference/final.log 2>&1
```

O provedor controlado usa HTTP autenticado, SQLite durável, gates explícitos e códigos de saída 80/81 antes/depois do recibo. Nenhuma chamada de modelo. A queda das APIs ocorreu depois de observar admissão/início do provedor; restart consultou o recibo, sem recriar a resposta. Seis duplicatas enquanto pendente receberam 409, não seis sucessos.

## Requalificação nativa com modelos

```powershell
$env:QUALIFICATION_EVIDENCE_DIR = Join-Path (Get-Location) 'validation/detached-inference/native-evidence'
$env:BRAIN_DETACHED_PROFILE = '1'
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_brain.py --basetemp=validation/detached-inference/.temp-native-second -q -s --junitxml=validation/detached-inference/native-2.xml > validation/detached-inference/native-2.log 2>&1
```

A tentativa `native-1` falhou na mesma incompatibilidade Node antes de iniciar modelos; [captura](native-1-evidence/results.json). `native-2` repetiu o E2E inteiro com perfil desacoplado e passou em 251,42 s. O diretório de evidência foi configurado explicitamente para preservar a rodada `brain-recovery` anterior. Sua classe agora respeita a variável de destino. Processos iniciados/reiniciados carregaram os controles da rodada; a conferência final de campos de `read_commit` também foi exercitada pelo roteiro controlado ampliado.

Execuções elevadas foram aceitas para Docker local e corpus fictício fechado já autorizado. PayloadGuard permaneceu ativo, usando [corpus](../brain-recovery/corpus.json) com três releases inventadas e bloqueio de credenciais conhecidas. Codex Terra efêmero, ambiente filtrado, sem shell/web, teto de 16 reservas por instalação, sem documentos do dossiê ou de cliente. Os pesos ONNX locais são conferidos por hash ao iniciar. Não se usou um modelo para responder o teste controlado.

## Regressões e conferência

```powershell
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-retained-flow/retained.ts validation/brain-recovery/brain.ts validation/brain-recovery/inference.ts > validation/detached-inference/typecheck.log 2>&1
node --test validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts > validation/detached-inference/node-tests.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/brain-recovery/test_witness.py validation/concurrent-reconciliation/test_authority.py validation/governed-recovery/test_votes.py validation/langgraph-retained-flow/test_budget.py -q --basetemp=validation/detached-inference/.temp-units --junitxml=validation/detached-inference/units.xml > validation/detached-inference/units.log 2>&1
$env:QUALIFICATION_EVIDENCE_DIR = Join-Path (Get-Location) 'validation/detached-inference/governed-regression-evidence'
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/governed-recovery/test_recovery.py --basetemp=validation/detached-inference/.temp-governed -q --junitxml=validation/detached-inference/governed-regression.xml > validation/detached-inference/governed-regression.log 2>&1
& validation/integrated-pilot/.venv/Scripts/python.exe validation/detached-inference/record.py
```

O compilador vem da instalação existente; Paperclip não foi recolocado na arquitetura. Verificador confere assinatura Ed25519/instalação/nonce/prazo registrado/ordem/head, reservas e usage, oito execuções controladas únicas e três recibos nativos após restore. Provas antigas não são autorizações atuais. Exportações possuem diretórios próprios. Manifesto exclui o próprio manifesto e stdout do verificador para evitar hash circular.

Cleanup verifica rótulo `qualification=<installation>` antes de remover contêiner/volume; sem prune. A fixture interrompe somente seus próprios processos, sem ações em produção, compras ou mensagens externas. Aviso de configuração futura do pytest-asyncio permaneceu nos logs. Nenhum preço financeiro foi inferido de contagem de reservas/tokens.
