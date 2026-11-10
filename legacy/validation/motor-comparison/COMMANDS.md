# Comandos e execução — Windows/PowerShell

Raiz: `C:\Users\PC\multi-agent`. Sem novo install: reutilizamos os ambientes isolados já registrados em `validation/manifest.json`, `poc/COMMANDS.md` e nos freezes desta rodada. Não usar Python da Microsoft Store: o caminho explícito do venv evita esse problema do ambiente.

## Inspeção executada

- Get-Content em poc/runtime.py, dossiê, prova AgentScope anterior e reavaliação Paperclip.
- rg/rg --files nos contratos StateGraph/checkpoints/interrupts, TeamPipeline, AgentState/SessionRecord, SQLStorage e Agent Service, LightRAG.aquery_data e API de eventos.
- git rev-parse HEAD, git diff --stat e git remote get-url origin por clone; LICENSE raiz lido para os quatro componentes. `git status` na raiz falhou porque o workspace não é um repositório; usamos os clones individualmente.
- Tentativas rg com glob em posição de caminho no Windows falharam; buscas refeitas com diretório e -g. Não afetaram os testes.

## Testes executados (três rodadas)

```powershell
$env:DO_NOT_TRACK='1'
$env:AUTH_MODE='workspace_token'
$env:ANALYTICS_ENABLED='false'
& validation/openagents/.venv/Scripts/python.exe -X utf8 -m pytest validation/motor-comparison/test_comparison.py -q --junitxml=validation/motor-comparison/evidence/comparison.xml *> validation/motor-comparison/evidence/comparison.log
```

1. 9 PASS / 4 FAIL, 47,72 s: faltava is_concurrency_safe em nossa EffectTool. Logs, XML, chamadas e cenários preservados em evidence/first-attempt.
2. 13 PASS, 53,93 s: correção apenas na extensão, sem patch upstream. Evidência preservada em evidence/second-attempt.
3. 17 PASS, 78,47 s: acrescentados falha de modelo e novo run para mesma intenção; orçamento de período segregado por empresa.

O pytest roda no venv OpenAgents; Host inicia o serviço de controle/conhecimento com poc/.venv e cada worker no seu respectivo venv. subprocess.Popen/comunicate reais; os._exit(71) simula término abrupto em fronteira definida; terminate/wait demonstram a saída do worker no cancelamento. Portas loopback atribuídas pelo sistema. A API OpenAgents é real, chamada por ASGI TestClient; não foi servido um OpenAgents TCP nesta rodada.

As chamadas exigiram execução fora do sandbox restrito para processos e sockets locais. Nenhuma despesa externa foi gerada. O harness usa TemporaryPath do pytest para bancos; não inclui esses bancos, hashes de credenciais de teste ou diretórios de ambiente no pacote de entrega.

## Preservação do clone

Importar OpenAgents regenerou três metadados de distribuição. Registramos o diff e restauramos somente os arquivos gerados, sem alterar código do projeto:

```powershell
git -C vendor/openagents-audit diff -- sdk/src/openagents.egg-info/dependency_links.txt sdk/src/openagents.egg-info/entry_points.txt sdk/src/openagents.egg-info/top_level.txt > validation/motor-comparison/evidence/generated-packaging.diff
git -C vendor/openagents-audit restore -- sdk/src/openagents.egg-info/dependency_links.txt sdk/src/openagents.egg-info/entry_points.txt sdk/src/openagents.egg-info/top_level.txt
```

## Encerramento e artefatos

Host encerra serviço e workers no teardown. A inspeção final com Get-CimInstance Win32_Process não encontrou processos Python/Node com motor-comparison na linha de comando. Manifesto inclui SHA dos clones e hashes do código/evidência. ZIP verificado por CRC e SHA de cada arquivo. Não inclui vendor, venvs, credenciais ou bancos temporários.

Este pacote é incremental à auditoria anterior. Para reconstruir do zero, recuperar os mesmos SHAs, instalar os ambientes conforme o registro anterior/freeze e executar o comando acima. Não alegamos reprodução em outro sistema operacional nem instalação sem rede/cache.
