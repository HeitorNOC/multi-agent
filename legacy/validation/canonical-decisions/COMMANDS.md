# Comandos e reprodução

PowerShell em C:\Users\PC\multi-agent, 04/11/2026. Fontes de bancada copiadas explicitamente das rodadas semantic-integration e temporal-editorial; nenhum vendor alterado. Dependências do venv principal e pesos ONNX anteriores reutilizados, com freeze observado em evidence/environment-freeze.txt. Mesmos digests de PostgreSQL/pgvector, Neo4j e Keycloak.

```powershell
$env:PYTHONIOENCODING='utf-8'
$env:AUDIT_MODEL='gpt-6.1-terra'
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/canonical-decisions/test_decisions.py -s -q --tb=short --junitxml=validation/canonical-decisions/evidence/canonical.xml *> validation/canonical-decisions/evidence/canonical.log
```

Resultado: um teste E2E PASS em 214,39 s no console, sete checkpoints de contrato e cinco casos de resposta temporal. Não são sete testes independentes. Esta execução não falhou nem foi repetida para escolher uma resposta melhor.

```powershell
node vendor/paperclip/node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module nodenext --target es2023 --types node --typeRoots vendor/paperclip/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types validation/canonical-decisions/editorial.ts
```

Typecheck strict passou. O módulo editorial já tinha dez testes na rodada anterior; não somamos esse número como novos testes desta integração. O compilador existente não implica adoção do control plane Paperclip.

O adaptador executa Codex read-only, sem shell/web, JSONL e output-schema, com timeout de 150 s e limite de 28 chamadas por instalação. Propaga somente ambiente básico, não senhas de storages/provedores ou tokens de outros apps. Os prompts são nativos LightRAG; não se fabricam entidades, vetores ou respostas. Registros indicam IDs das chamadas de provider; as evidências guardam seus prompts/hashes/uso. Sem fatura monetária atribuível.

## Sequência executada

1. Infraestrutura/identidade reais; roles SQL de aplicação e gravação de registros distintos.
2. Markdown v1/v2 submetido por editor, aprovado por identidade distinta e publicado canonicamente.
3. Seleção de snapshot por corte de vigência/conhecimento; ingestão nativa e respostas de fevereiro/março.
4. Retificação retroativa v3; novas respostas para fevereiro/março/janeiro, sem misturar versões na recuperação.
5. Consulta e repetição do pedido original retornam exatamente o registro original; mesmo ID com outra pergunta é negado.
6. Corte anterior à publicação produz abstenção sem inferência; controles de permissão e dado privado realmente indexado.
7. Revogação impede leitura privada pelo antigo autorizado; governança ainda pode consultar seu registro conforme grants atuais.
8. UPDATE/DELETE com decision_writer são negados pelo PostgreSQL; reinício preserva registros e revogação sem modelo.

As falhas esperadas são HTTP 401/403/409 e SQL permission denied, verificadas por assert, não ignoradas. O warning de escopo pytest-asyncio ficou visível. O estado da aplicação é criado explicitamente antes de usar o working_dir. Não houve correção de upstream.

A criação da projeção é lazy: fonte canônica publicada não significa que todos os índices já estão prontos. Consulta só continua após doc-status nativo processed e marcação ready. Projeção/admissão interrompida permanece bloqueada para conciliação, sem retry cego; o cenário de crash nesse ponto não foi ensaiado nesta rodada.

O harness mantém algumas rotinas herdadas de ensaios anteriores; backup/restore não foi invocado e não qualifica o novo conjunto SQLite+PostgreSQL+grafo. Serviços de provider/authority herdados são auxiliares de bancada, sem papel de conector real nesta prova. Somente recursos canonical-audit-<id> foram removidos; sem prune global. .state contém materiais privados de laboratório e não integra a entrega.

## Geração da entrega

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/canonical-decisions/finalize.py
```

O script seleciona fontes, vault e evidências, exclui ambientes/pesos/estado privado, verifica CRC e hashes das entradas e procura padrões comuns de credenciais. Antes de repetir o experimento, arquive a evidence atual: nomes fixos são sobrescritos.
