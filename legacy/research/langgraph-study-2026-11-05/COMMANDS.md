# Comandos, evidências e adaptações

05/11/2026, PowerShell, C:\Users\PC\multi-agent. Sem instalação de dependências e sem chamadas pagas.

1. Leitura de `docs/ARQUITETURA_BASE.md`, relatório anterior `research/langgraph-reuse-2026-11-05/REPORT.md`, gate e índices atuais. Busca de instruções locais com `rg --files -g AGENTS.md`; não encontrada instrução na raiz; `.agents` ausente. Arquivos AGENTS em snapshots de terceiros não governam este workspace.
2. Conector GitHub: consultas de repositórios e README não retornaram no tempo observado; orquestração somente leitura interrompida. Nenhum resultado desse conector foi usado como evidência.
3. Pesquisa web: documentação LangGraph (checkpointers, fault tolerance, interrupts, subgraphs), Academy, projetos e aulas CampusX. Relatos primários Elastic, LinkedIn Engineering e entrevista Replit. URLs no relatório. Metadados de vídeo CampusX consultados, sem alegar reprodução integral: https://www.youtube.com/watch?v=_UuUigoM9MA e https://www.youtube.com/watch?v=D5KhiCDM9XQ .
4. Criado `collect.py`, que consulta metadados/commit/árvore da API pública e captura arquivos raw por SHA, sem importar/executar código de terceiros. Primeira execução no sandbox falhou em DNS (`URLError`, `getaddrinfo failed`). Repetição com acesso de rede autorizado funcionou; nenhuma rejeição de aprovação automática.

```powershell
& 'validation/python/cpython-3.11.18-windows-x86_64-none/python.exe' research/langgraph-study-2026-11-05/collect.py
& 'validation/python/cpython-3.11.18-windows-x86_64-none/python.exe' research/langgraph-study-2026-11-05/collect.py capture
```

Inventário: seis repositórios e commits completos, armazenados em `inventory/*.json`. Seleção inicial 39 arquivos; ampliada para 44 com código de claims, lead agent, executor local e testes de PostgreSQL/retenção. Segunda captura sobrescreveu somente os mesmos arquivos públicos selecionados mais os adicionais; não removeu arquivos existentes. Manifesto final contém 44 entradas.

5. Notebooks: extraídas células markdown/código sem outputs, preservando índice da célula, em `.cells.txt`. Não executados `%pip`, imports ou chamadas dos notebooks. Uma consulta de trechos falhou ao imprimir Unicode no console cp1252; repetida com `$env:PYTHONIOENCODING='utf-8'`. Alguns outputs longos foram truncados; usados trechos delimitados posteriores e buscas para as afirmações, sem declarar leitura integral de arquivo truncado.
6. Inspeção: supervisor do curso, chamadas `gather`, limites/erros; MemorySaver/InMemorySaver vs SQLite em disco; HITL y/n; schemas de subgrafos; Store; requirements; runtime/gateway; dedup SQL/TTL/fail-open; testes de privacidade e entrada; executor subprocess; middleware/subagentes; retenção condicional por banco. `turn_checkpoint.py` constatado como diff Git, não persistência do workflow.
7. Conferência no core local com `rg -n` dos símbolos RetryPolicy, TimeoutPolicy, NodeInterrupt, EmptyInputError e pending_writes em `vendor/langgraph/libs/langgraph/langgraph/`. Prova funcional nativa anterior referenciada, não reexecutada. Nenhum FAIL empresarial foi alterado ou removido.
8. Verificação offline: `verify.py`, SHA-256 de todos os 44 arquivos, correspondência entre seleção e manifesto e consistência das extrações de células. Resultado em `verification.json`. Isso verifica captura, não comportamento do software analisado.
9. Conferência adicional: `agent/server.py` e `agent/graphs/agent.py`, referidos pela documentação gerada OpenWiki de Open SWE, ausentes da árvore atual não truncada. Registrada divergência no parecer, sem tomar esse material como prova do runtime atual. Todos os seis inventários retornaram `tree_truncated=false`.

Repetir `capture` conserva os commits dos inventários locais; repetir o modo inventário consulta novamente HEAD e pode mudar o snapshot. Para reproduzir esta pesquisa, conservar inventários e manifesto entregues. Nenhum segredo ou dado de cliente foi usado.
