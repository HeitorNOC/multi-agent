# Fontes

- Código fixado Graphiti: graphiti_core/graphiti.py (add_episode/search), llm_client/client.py (contratos JSON/modelos), search/search_filters.py (filtros), utils/maintenance/edge_operations.py (_apply_temporal_invalidation e resolve_edge_contradictions). O diagnóstico se baseia nesses registros e na execução; não em uma promessa de marketing de “memória temporal”.
- [Obsidian: propriedades](https://obsidian.md/help/properties): propriedades YAML nas notas. O importador usa um subconjunto escalar explícito, não todo o YAML suportado pelo aplicativo.
- [Obsidian: vaults](https://obsidian.md/help/Files%2Band%2Bfolders/Manage%2Bvaults): pasta existente pode ser aberta como vault. Aplicativo e UI não foram testados aqui.
- [Modelos Codex](https://learn.chatgpt.com/docs/models) e [modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode): flags de modelo, eventos JSONL e saída estruturada. Acesso efetivo confirmado por inferência real; consumo em moeda não retornado.
- [XTDB: tempo](https://docs.xtdb.com/about/time-in-xtdb.html) e [SQL temporal](https://docs.xtdb.com/reference/main/sql/queries.html): alternativa documental para uma prova futura, não componente instalado ou aprovado nesta rodada.

A licença/versão dos pesos ONNX permanece no registro anterior decision-qualification/evidence/pretrained-embedding.json; os arquivos foram verificados pelo serviço local antes da inferência. Nenhum novo peso foi selecionado nesta rodada.
