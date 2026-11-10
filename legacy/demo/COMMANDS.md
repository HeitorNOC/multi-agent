# Registro de execução

05/11/2026, C:\Users\PC\multi-agent, PowerShell. Sem novas dependências, novas imagens, dados de cliente ou efeitos externos. Conta Codex autorizada para bancada, sem convertê-la em requisito comercial.

## Inspeção/reutilização

Lidos pontos de entrada, ambiente e testes de `validation/investment-gate`, `validation/brain-recovery`, `validation/langgraph-business-flow`, `validation/langgraph-retained-flow` e `research/langgraph-reuse-2026-11-05`. Reutilizados infraestrutura BrainLab, adaptador Codex com allowlist/guard, LightRAG, ONNX e bancos já disponíveis. Não foi reconstruído o motor. Nenhum componente de login foi iniciado.

Primeiro `docker ps` no sandbox recusou acesso ao named pipe. Execução autorizada com acesso local confirmou Docker e um container alheio `lucid_snyder`; ele não foi alterado. O runtime não tinha FastAPI: usada a biblioteca HTTP padrão já disponível, sem instalar framework. Verificados React 19.2.8 e esbuild 0.28.2 existentes.

## Construção e verificações

```powershell
node demo/build.cjs
node --test demo/policy.test.ts
& validation/integrated-pilot/.venv/Scripts/python.exe -m py_compile demo/start.py demo/worker.py
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo/tsconfig.json
node --test demo/policy.test.ts demo/server.test.ts
```

Primeiros três testes de política passaram. Strict inicial de API/política passou. Ao ampliar para UI, resolução de react/jsx-runtime, react-dom/client e CSS falhou; corrigidos paths explícitos de declarações e assets.d.ts, sem pacote novo. Strict completo passou em `typecheck.log`. Teste HTTP inicialmente falhou por `EACCES` em loopback no sandbox; repetido com acesso autorizado, quatro PASS em `unit-tests.log`. Backend desse teste é controlado e não chama modelo.

Foram acrescentadas proteção de admissão única no SQLite, marcação de falha de admissão para permitir retomada e rechecagem de rejeição depois de aguardar runtime. A sessão já aberta recebeu o mesmo índice SQL de admissão única por conexão local; as proteções finais de admissão foram verificadas no teste HTTP contra processo novo de `server.ts`.

## Aplicação e jornada nativa

Launcher iniciado em segundo plano com `Start-Process`, `-WindowStyle Hidden`, Python do ambiente existente e logs em `.state`. Endereço desta execução: http://127.0.0.1:59587 . Processo principal e recursos permanecem disponíveis para revisão do usuário. Credenciais e DSNs ficam em `.state`, não em links de entrega.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe demo/test_journey.py *> demo/evidence-run.log
& validation/integrated-pilot/.venv/Scripts/python.exe demo/record.py
```

Teste integrado autorizado para quatro chamadas reais de análise e falhas de processo somente sobre ação fictícia. PASS em 35,77 s; prova pública em `evidence/journey.json`. Os motores tinham feito três chamadas de extração para três fontes. O teste atravessou API TS real, worker Python real, checkpoint PostgreSQL, busca LightRAG e inferência Codex Terra real. Falha injetada 88 observada e recuperada; um único efeito local. Não foram executados testes que gastassem todo o teto de 16 chamadas para demonstrar exaustão nesta rodada.

Pela interface, iniciada segunda análise (quatro chamadas adicionais), chegando a aprovação pendente. Citação de janeiro abriu original, versão e hash corretos. Navegação/revisão visual realizada via browser da skill computer-use; não houve aprovação de ação externa ou real. Teste de chamada HTTP por PowerShell também encontrou restrição de socket no sandbox; leitura repetida com acesso autorizado. Não houve rejeição da revisão automática de aprovação.

Snapshot da sessão exporta somente versões, corpus fictício, traces de trabalho e usage. Exclui tokens, DSNs e prompts internos. Manifesto de código em `evidence/source-manifest.json`; logs de serviços e credenciais efêmeras ficam privados em `.state`. Ao encerrar, usar `Stop-Demo.ps1`, cujo launcher confere ownership dos recursos antes do cleanup; não usar prune.
