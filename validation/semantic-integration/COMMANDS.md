# Comandos e reprodução — PowerShell

Workspace `C:\Users\PC\multi-agent`, data do cliente 04/11/2026. Baseline de application/harness/schema/protocol/provider/authority/engine copiado explicitamente de decision-qualification; histórico anterior preservado. Imagens PostgreSQL/pgvector, Neo4j e Keycloak mantidas por digest no harness.

Pré-requisitos: virtualenv principal `validation/integrated-pilot/.venv` e ambiente FastEmbed `validation/decision-qualification/.embedding-venv`; pesos fixados em decision-qualification/.models; Docker Linux ativo; Codex CLI autenticado. Nenhum auth.json precisa ser aberto, copiado ou colocado no repositório.

```powershell
docker info --format '{{.ServerVersion}}'
codex --version
$env:PYTHONIOENCODING='utf-8'
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/semantic-integration/test_semantic.py -s -q --tb=short --junitxml=validation/semantic-integration/evidence/semantic.xml *> validation/semantic-integration/evidence/semantic.log
```

Nova tentativa: mover arquivos de topo de evidence para evidence/attempt-N antes de repetir; manter subdiretórios. Cada instalação tem prefixo `semantic-pilot-<id>`, volumes e diretórios próprios. A limpeza não usa prune nem exclusão recursiva de pastas. Dumps e configuração privados permanecem em `.state` e não integram o ZIP.

O harness lança o servidor ONNX pelo venv FastEmbed; aplicação pelo venv principal. O adaptador chama Codex com `--ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only --model gpt-6.1-terra`, shell desabilitado, web desabilitada, JSONL, output-schema e prompt por stdin. Propaga somente variáveis básicas de ambiente, não senhas de banco/provedor ou tokens de apps conectados. Qualquer evento inesperado de ferramenta invalida a chamada. Timeout 150 s por chamada; orçamento 24. Isso não suprime revisão de aprovação nem habilita sandbox irrestrito.

Usada a orientação OpenAI Docs já aplicada na conversa. Fontes primárias: [modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode), além dos contratos do código fixado LightRAG `docs/ProgramingWithCore.md` (embedding, tokenizer) e `AGENTS.md`. O artefato ONNX e sua licença/revisão já foram registrados em decision-qualification/SOURCES.md e pretrained-embedding.json; não houve troca de pesos nesta rodada.

## Falhas e adaptações preservadas

- attempt-1: FAIL em 3,53 s, antes de qualquer modelo. pg_isready reconheceu o servidor temporário da inicialização PostgreSQL, que então parou. A prontidão passou a exigir TCP 127.0.0.1; esse servidor temporário não ouve TCP. Sem mudança de imagem/banco para contornar o teste.
- O traceback inicial continha senha efêmera criada pela própria fixture, já descartada com o volume. Diagnósticos públicos foram redigidos por redact_evidence.py; próximas execuções usam `--tb=short`. Não entregar dumps ou credenciais.
- Primeira invocação inline de redação falhou por quoting PowerShell/Python. Substituída por script Python explícito, que concluiu; não foi falha do componente auditado.
- attempt-2: FAIL em 150,79 s na consulta auxiliar de inspeção. O atributo lógico da tabela era maiúsculo e o PostgreSQL havia criado o identificador não citado em minúsculas. Corrigida somente a consulta da fixture para o nome físico. Cinco chamadas reais, vetores e relações haviam sido produzidos e seus resultados foram preservados. A nova tentativa mantém evidências próprias, sem somar esse FAIL como PASS.
- Funções de injeção são closures simples, conforme contrato de deepcopy da dataclass LightRAG; não copiam o pool HTTP vivo para a configuração do motor. O extrator nativo permanece intacto.

## Verificação e pacote

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/semantic-integration/redact_evidence.py
& validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/semantic-integration/finalize.py
```

O pacote seleciona somente fontes de topo, corpus e evidence. Exclui .state, pesos, ambientes e caches. Confere CRC e SHA-256 de cada entrada. Resultado final e consumo devem ser lidos em RESULTS.md e evidências, sem extrapolar tokens para cobrança monetária.
