# Comandos, escopo e reprodução

PowerShell em `C:\Users\PC\multi-agent`, 04/11/2026. Baseline copiado explicitamente de `validation/integrated-pilot` para preservar evidências e implementação anteriores. Sem alterações vendor. Virtualenv principal reaproveitado somente para execução; embeddings e auditoria usam ambientes separados.

## Integração

```powershell
$env:PYTHONIOENCODING='utf-8'
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/decision-qualification/test_decision.py -s -q --junitxml=validation/decision-qualification/evidence/decision.xml *> validation/decision-qualification/evidence/decision.log
```

Primeira execução: PASS em 272,92 s, 10 checkpoints (`evidence/attempt-1`). A repetição justificada acrescenta login humano sintético com PKCE, captura de contexto autorizado para modelo e tratamento explícito de timeout do inventário. O cenário cria/restaura/remove somente recursos com prefixo `decision-pilot-<id>`. Dumps privados, chaves e recibos locais ficam em `.state`, excluídos da entrega. Arquive os resultados antes de repetir: nomes de evidência são sobrescritos.

Segunda execução: FAIL em 302,90 s no cliente de login humano, HTTP 400/cookie_not_found, preservada em `attempt-2`. A terceira usa uma política de cookies explicitamente permissiva só para o endereço 127.0.0.1 da fixture HTTP. Isso não flexibiliza a validação de JWT/PKCE do backend nem demonstra transporte HTTPS seguro. O resultado final precisa ser lido em decision.log/integration.json.

## Modelo real

Foi usada a skill OpenAI Docs (`C:/Users/PC/.codex/skills/.system/openai-docs/SKILL.md`) para verificar a chamada CLI. O usuário autorizou Codex com Sol/Terra; escolhemos Terra, sem escalada de modelo nesta rodada. CLI `--help` consultado; não lemos/exibimos auth.json ou segredos. O probe mínimo e o benchmark usam:

```powershell
codex exec --ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only --model gpt-6.1-terra -c 'features.shell_tool=false' -c 'web_search="disabled"' --cd <model-io> --output-schema <schema.json> --json <prompt>
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/decision-qualification/model_eval.py
```

`model_eval.py` envia o prompt por stdin, limita tempo e valida eventos, esquema, IDs, citações autorizadas, respostas esperadas e ausência de canários. Critérios definidos antes da inferência. São sete casos no mesmo lote/contexto, não sete amostras independentes. Contexto público vem de queries reais LightRAG do teste, mas a extração/vetorização desse índice ainda é fixture. A resposta do modelo é texto, não autorização. Tokens e respostas ficam em `evidence/model-*`; nenhum arquivo de autenticação integra o pacote.

`model-input-context.json` preserva o contexto da execução usada no benchmark, inclusive se uma repetição posterior da integração sobrescrever model-context.json. Para um novo benchmark, arquive o conjunto inteiro e crie outra captura; não misture hashes ou resultados de instalações diferentes. Não houve chamada de Sol nem comparação monetária entre modelos.

## Embeddings pré-treinados locais

```powershell
$env:UV_CACHE_DIR="$PWD/validation/uv-cache"
& validation/.tools/Scripts/uv.exe venv --python validation/integrated-pilot/.venv/Scripts/python.exe validation/decision-qualification/.embedding-venv
& validation/.tools/Scripts/uv.exe pip install --python validation/decision-qualification/.embedding-venv/Scripts/python.exe fastembed
& validation/decision-qualification/.embedding-venv/Scripts/python.exe -X utf8 validation/decision-qualification/embedding_probe.py
```

FastEmbed/ONNX local, modelo multilingual MiniLM quantizado Qdrant, revisão `faf4aa4225822f3bc6376869cb1164e8e3feedd0`, hashes dos sete arquivos em `pretrained-embedding.json`. Não se baixa pickle/código remoto de modelo; `token=False` e telemetria HF desabilitada. Dados são sintéticos. O modelo e caches não integram o ZIP. Outro modelo E5 foi consultado como referência, mas não executado.

## Segurança e avisos

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/decision-qualification/sandbox_gateway.py
& validation/.tools/Scripts/uv.exe venv --python validation/integrated-pilot/.venv/Scripts/python.exe validation/decision-qualification/.security-venv
& validation/.tools/Scripts/uv.exe pip install --python validation/decision-qualification/.security-venv/Scripts/python.exe pip-audit
& validation/decision-qualification/.security-venv/Scripts/python.exe -X utf8 -m pip_audit --path validation/integrated-pilot/.venv/Lib/site-packages --progress-spinner off --format json --output validation/decision-qualification/evidence/python-advisories.json --cache-dir validation/uv-cache/pip-audit
```

Primeiro comando pip-audit falhou por argumentos incompatíveis (`--no-deps` exige requirements). Preservado em `python-advisories-attempt-1.log`; corrigido sem ignorar vulnerabilidades. Resultado: 91 entradas, LightRAG não auditável no catálogo para essa versão, zero avisos conhecidos nas demais entradas. Isso não cobre código próprio, zero-days, imagens OS, frontend ou todos os vendor. Não equivale a SBOM/CVE completo ou pentest.

Gateway executa somente código sintético autorizado em dois contêineres de prefixo próprio, sem rede, mounts ou credenciais. Capabilities de uso único e assinatura só foram qualificadas nesse processo; antirreplay durável/distribuído, limite de disco de stdout e integração MCP continuam pendentes.
