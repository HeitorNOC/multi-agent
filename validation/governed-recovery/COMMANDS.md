# Execução e evidências — 04/11/2026

Raiz: `C:\Users\PC\multi-agent`. Lidos módulos retained/authority, worker LangGraph, API TypeScript e harness anterior. Não se modificou vendor LangGraph nem se instalou dependência.

## Testes principais

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/governed-recovery/test_recovery.py --basetemp=validation/governed-recovery/.temp-missing-receipt -q -s --junitxml=validation/governed-recovery/final.xml
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/governed-recovery/test_votes.py validation/langgraph-retained-flow/test_budget.py validation/concurrent-reconciliation/test_authority.py --basetemp=validation/governed-recovery/.temp-unit-final -q --junitxml=validation/governed-recovery/units-final.xml
node --test validation/langgraph-retained-flow/proof.test.ts validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-retained-flow/retained.ts
```

O compilador existente sob vendor/paperclip é apenas ferramenta de verificação; Paperclip não foi reintroduzido na arquitetura.

## Progressão e negativos

`attempt-1`: E2E de encerramento de admissão e retomada da confirmação, PASS. Captura preservada em `evidence/admission-only-pass.json`.

`attempt-2`: ampliado para recibo externo e retomada do efeito, PASS. Preservado em `evidence/effect-reconciliation-pass.json`.

Primeira execução com segunda restauração: FAIL ao abrir g2. Cópia dos artefatos para `stale-bundle-failed.*` antes da correção. Inspeção SQLite de leitura comparou quantidade de operações da autoridade e recibos nas cópias/original/ativo: 29/18/29. O backup havia usado caminhos antigos. A correção do helper foi acompanhada da repetição integrada inteira, sem mudar o critério.

Typecheck inicial da ampliação para efeito recusou propriedades ausentes na união de retornos; o contrato de inspeção foi completado e o check final passou.

O roteiro injeta quedas 77 (depois da intenção), 78 (depois do commit local de recuperação) e 74 (depois do efeito, antes do recibo local). Interrompe e reinicia o provedor sintético para testar ausência de disponibilidade da evidência. Não substitui recibo por dado fornecido pelo cliente.

Uma última ampliação apontou a consulta a uma segunda store vazia do mesmo provedor: lookup sem recibo foi recusado e nenhum send foi emitido. O PASS anterior à ampliação foi preservado em `pre-missing-receipt.*` e `evidence/pre-missing-receipt-pass.json`; o E2E inteiro foi repetido para o resultado final.

## Regressão do fluxo anterior

```powershell
$env:QUALIFICATION_EVIDENCE_DIR = Join-Path (Get-Location) 'validation/governed-recovery/evidence/signed-regression'
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/langgraph-retained-flow/test_signed_flow.py --basetemp=validation/governed-recovery/.temp-signed-regression -q -s --junitxml=validation/governed-recovery/signed-regression.xml
```

As evidências da regressão têm diretório próprio para preservar as capturas anteriores. Env var controla só o destino dos artefatos.

## Segurança operacional da bancada

Backup para diretórios novos, SQLite backup API, dump/restore lógico PostgreSQL; autoridade/store/chave fora dos bundles. Contêineres/volumes nomeados por instalação, cleanup com checagem de rótulo, sem prune. Dumps privados e `.state` não devem ser distribuídos como configuração de produção. Logs exportados não contêm tokens/chaves privadas.

Nenhum modelo, ferramenta externa real ou conta empresarial foi usado. Aviso pytest-asyncio sobre configuração futura permaneceu nos logs. Provas assinadas exportadas são verificadas contra a chave pública e nonces/horários de requisição registrados; essa verificação histórica não transforma uma prova antiga em autorização atual.
