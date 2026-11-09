# Comandos e rastreabilidade desta rodada

Workspace: `C:\Users\PC\multi-agent`. Apenas dados fictícios; nenhum efeito externo. Ações de navegador foram somente leitura/navegação de fontes; não houve aprovação das propostas Aurora.

## Recuperação e contratos locais

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/observability-recovery/test_recovery_contracts.py -q --tb=short --junitxml=validation/observability-recovery/recovery-final.xml *> validation/observability-recovery/recovery-final.log
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/observability-recovery/test_regressions.py validation/governed-recovery/test_votes.py validation/brain-recovery/test_witness.py validation/concurrent-reconciliation/test_authority.py -q --tb=short --basetemp=validation/observability-recovery/.temp-regressions --junitxml=validation/observability-recovery/regressions.xml *> validation/observability-recovery/regressions.log
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/observability-recovery/test_telemetry.py demo-enterprise/test_embedding_pooling.py -q --basetemp=validation/observability-recovery/.temp-telemetry-v1 --tb=short --junitxml=validation/observability-recovery/telemetry-final.xml *> validation/observability-recovery/telemetry-final.log
node --test demo/telemetry.test.ts demo/policy.test.ts demo/server.test.ts demo-enterprise/policy.test.ts validation/observability-recovery/api_effect.test.ts validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts *> validation/observability-recovery/node-final.log
```

Resultados finais: 10, 7 e 5 testes Python PASS; 30 Node PASS. Os scripts de regressão usam destinos próprios para não substituir exports históricos. Os launchers de teste fazem cleanup somente de processos/containers/volumes que criaram e cujo rótulo confere.

```powershell
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/langgraph-business-flow/business.ts validation/langgraph-retained-flow/retained.ts validation/langgraph-retained-flow/inference_recovery.ts validation/brain-recovery/inference.ts *> validation/observability-recovery/typecheck-final.log
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json *> validation/observability-recovery/ui-typecheck-final.log
node demo-enterprise/build.cjs
```

O uso de ferramentas já instaladas no clone Paperclip continua dependência de desenvolvimento, não reintrodução da plataforma. Não foram instalados pacotes, imagens ou um backend novo de telemetria.

## Sessão nativa instrumentada

```powershell
& validation/observability-recovery/Start-Ensaio.ps1
```

Processo oculto 3528, perfil `observability-v1`, sessão privada `demo-enterprise/.state/session-772d0679a7`; URL http://127.0.0.1:60937 . O perfil possui teto novo de 40 reservas e o bootstrap preservou o apontador anterior em arquivo privado. As aplicações anteriores não foram encerradas. O corpus e seu gabarito não foram alterados.

Primeira execução:

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/test_scenarios.py --evidence-dir validation/observability-recovery/native-evidence *> validation/observability-recovery/native.log
```

Campanha `bf0f9ac8-2220-4b58-86de-c4829d488c73`: plano de dez agentes recusado, sem time executado. Incidente `97edcde8-beea-4ef7-a699-2d1cdcb66eb8`: quatro agentes, aceito. Roteiro inicial teve TypeError ao comparar plano nulo; arquivo preservado como `native-evidence/first-scenarios-failed.json`.

Após explicitar a contagem de diretores+especialistas, nova campanha e adoção do incidente existente:

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/test_scenarios.py --incident-job 97edcde8-beea-4ef7-a699-2d1cdcb66eb8 --evidence-dir validation/observability-recovery/native-evidence *> validation/observability-recovery/native-second.log
```

Campanha `9aecccd2-d1f3-49c0-9424-cd5ade5e772a`: oito agentes, dez slots, parecer aceito. Dois fluxos PASS; retomadas não aumentaram inferências. Ambos continuam aguardando aprovação.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe validation/observability-recovery/record_native.py
& validation/integrated-pilot/.venv/Scripts/python.exe validation/observability-recovery/verify.py
```

`record_native.py` confere as entradas reais e compara handoffs por hash, sem exportar os prompts. `verify.py` é offline: confere JUnit/logs, assinaturas dos ensaios, consumo e hashes; preserva originais privados de diagnósticos e redige credenciais efêmeras nas cópias públicas.

## Falhas intermediárias

- `initial.log/xml`: identidade configurada após bootstrap invalidou o inventário; corrigido antes do primeiro start.
- `second.log/xml`: seis casos read_commit passaram; unknown encontrou bypass do tombstone no cache de create. Corrigido e testado novamente.
- `unknown-third.log/xml`: dois unknown passaram.
- `provider-boundary.log/xml`: uma janela adicional após fechamento do provedor passou; incorporada aos dez casos finais.
- `telemetry.log/xml`: três PASS e dois erros de criação de temp no sandbox; `telemetry-final` usa diretório explícito e passou cinco.
- `native.log`: plano excessivo recusado e erro do roteiro; ambos preservados e descritos acima.

## Verificação da interface

Navegador in-app na URL nova: conferidos os números 11.000/8.000, as oito leituras canônicas/dez resultados da campanha e as fontes clicáveis `aurora-inventory`, `aurora-sales` e `aurora-procurement`. Estilo dos botões de fonte corrigido e bundle recompilado; nova inspeção visual confirmou legibilidade.

O pedido de salvar screenshot final foi rejeitado pela revisão automática por limite de uso. A ação não foi executada; não se contornou o bloqueio. Nenhuma captura final é anunciada como arquivo entregue.
