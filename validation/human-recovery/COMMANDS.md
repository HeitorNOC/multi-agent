# Comandos da integração da central humana

## Compilação e contratos

```powershell
node demo-enterprise/build.cjs
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json *> validation/human-recovery/typecheck-ui-final.log
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-retained-flow/retained.ts validation/langgraph-retained-flow/recovery_queue.ts validation/langgraph-retained-flow/inference_recovery.ts *> validation/human-recovery/typecheck-protocol-final.log
node --test validation/human-recovery/recovery_auth.test.ts demo/telemetry.test.ts demo/policy.test.ts demo/server.test.ts demo-enterprise/policy.test.ts validation/observability-recovery/api_effect.test.ts validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts *> validation/human-recovery/node-final.log
```

Resultado: 33 Node PASS, strict e build PASS. As dependências já instaladas foram reutilizadas; nenhum pacote, imagem ou serviço externo foi contratado.

## Integração e recuperação

Suíte principal efetivamente executada:

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/human-recovery/test_console.py validation/observability-recovery/test_recovery_contracts.py validation/observability-recovery/test_regressions.py validation/governed-recovery/test_votes.py -q --tb=short --basetemp=validation/human-recovery/.temp-final --junitxml=validation/human-recovery/final.xml *> validation/human-recovery/final.log
```

Resultado: 16 PASS. **O roteiro de regressão dessa linha usava exports fixos e substituiu quatro arquivos históricos de resumo/chave pública**, conforme RESULTS.md. Para novas execuções, usar o wrapper isolado abaixo no lugar de `validation/observability-recovery/test_regressions.py`.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/human-recovery/test_console.py -q --tb=short --junitxml=validation/human-recovery/console-final.xml *> validation/human-recovery/console-final.log
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/human-recovery/test_regressions.py -q --tb=short --junitxml=validation/human-recovery/isolated-regressions.xml *> validation/human-recovery/isolated-regressions.log
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/human-recovery/test_console.py -q --tb=short --junitxml=validation/human-recovery/inspection-release.xml *> validation/human-recovery/inspection-release.log
```

Resultados: 2 PASS e 2 PASS, reexecuções de cenários existentes. O wrapper carrega o módulo anterior com nome próprio para evitar colisão de imports e altera somente os destinos de evidência.

`first.xml/log`: teste tentou reutilizar um envio para conteúdo diferente e foi recusado. `second`, `concurrent` e `integration` registram as etapas posteriores. Todos os dados/provedores são controlados; zero chamadas LLM.

## Ambiente disponível

```powershell
.\validation\human-recovery\Start-Central.ps1
.\validation\human-recovery\Stop-Central.ps1
```

Inicializado em segundo plano/Hidden, PID 28576; URL http://127.0.0.1:58788 . Instalação `business-flow-3281702220`. Dois casos preparados com quedas reais dos processos de controle (saídas 80 e 82), sem revisões automáticas no ambiente deixado ao usuário.

Esse primeiro perfil foi encerrado pelo script próprio e substituído para carregar os metadados finais de inspeção. Novo PID 24284, URL http://127.0.0.1:61621 , instalação `business-flow-03278e9765`. O apontador e log anteriores ficaram em arquivos privados. Nenhuma sessão Aurora de análise foi reiniciada e nenhum modelo foi chamado.

Arquivo privado `.state/active.json` guarda o apontador e o caminho das credenciais de desenvolvimento. Não exportar esse arquivo nem `recovery-reviewers.json`, chaves, tokens ou a configuração privada da ponte. Cleanup verifica rótulos de instalação e não utiliza prune.

## Conferência offline final

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe validation/human-recovery/verify.py
```

Resultado: 1.851 assinaturas verificadas, 33 testes Node e 16 testes Python da suíte principal confirmados pelos registros, zero chamadas de modelo; perfil ao vivo com dois casos e zero votos. A primeira execução do verificador falhou ao ler acentos na codificação padrão do Windows. Com leitura UTF-8 explícita, todas as assinaturas conferidas passaram; não houve troca de chave nesses casos. `verification.json` e `manifest.json` registram a conferência e os hashes públicos.

A raiz atual não contém um repositório Git (`git status --short`: fatal, not a git repository). Esta entrega não criou commit; hashes de arquivos identificam o estado entregue.
