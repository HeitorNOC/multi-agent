# Fontes primárias — consulta em 2026-11-03

As afirmações de execução dependem dos arquivos em evidence/. Documentação e código inspecionado não são apresentados como testes executados. Valores e disponibilidade de modelos devem ser reconferidos antes de contratação.

| Tema | Fonte consultada | Uso neste parecer |
|---|---|---|
| LightRAG | vendor/lightrag, SHA aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a | QueryParam, journal, grafo, storages, isolamento e gate Apache AGE |
| Graphiti | vendor/graphiti-audit, SHA 7e0342a49ce5a04f6415ac2f64ce150bb81b0689 | SDK 0.31.2, SECURITY.md, campos/filtros temporais e testes existentes |
| LangGraph | vendor/langgraph, SHA 3c916d750575b22c464790e9774494d810ccd322 | SDK 1.2.19, checkpoint 4.3.1, checkpoint-postgres 3.2.0 |
| Caching OpenAI | https://developers.openai.com/api/docs/guides/prompt-caching | Normalização de cached_tokens e cache_write_tokens por TTL |
| Preços OpenAI | https://developers.openai.com/api/docs/pricing | Rate cards padrão/global/contexto curto, USD por milhão de tokens |
| Embedding | https://developers.openai.com/api/docs/models/text-embedding-3-small | Exemplo de preço de embedding e dimensão, sem escolher modelo por preço apenas |
| Conciliação OpenAI | https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs | Endpoint de custos agregados e filtros, consultado sem chamar API administrativa |
| Preços Anthropic | https://platform.claude.com/docs/en/about-claude/pricing | Rate card Sonnet 5.5 |
| Caching Anthropic | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | input_tokens não inclui cache; categorias/TTLs separados |
| Preços Google | https://aistudio.google.com/docs/pricing | Gemini 3.5 Flash-Lite e armazenamento de cache; redirecionamento da página ai.google.dev |
| RLS PostgreSQL | https://www.postgresql.org/docs/current/ddl-rowsecurity.html | Política, bypass por owner/superuser e FORCE RLS |
| Backup lógico | https://www.postgresql.org/docs/current/backup-dump.html | Dump consistente e necessidade de roles no destino |
| PITR | https://www.postgresql.org/docs/current/continuous-archiving.html | Backup base + sequência WAL, distinto de pg_dump |
| Docker | https://docs.docker.com/engine/security/ | Capabilities e limites de isolamento |
| Seccomp | https://docs.docker.com/engine/security/seccomp/ | Perfil padrão como camada de contenção |
| Rootless | https://docs.docker.com/engine/security/rootless/ | Opção de hardening; o daemon rootless não foi demonstrado neste ambiente |
| gVisor | https://gvisor.dev/docs/ | Alternativa pronta para maior isolamento; não instalada ou homologada |
| MCP | https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices | Controles de rede/credenciais e fronteiras de confiança |
| IdP pronto | https://www.keycloak.org/server/configuration-production | Alternativa ao SSO existente; TLS, exposição administrativa e limites de filas |
| Persistência LangGraph | https://docs.langchain.com/oss/python/langgraph/persistence | Checkpoints e stores; não substituem cérebro com ACL/proveniência |

A consulta oficial antiga de organização/usage retornou 404; a rota de documentação atual de costs acima foi encontrada e aberta. Isso é falha de descoberta documental, não teste da API. A skill OpenAI Docs foi usada apenas para preços e contratos oficiais OpenAI. Nenhuma chave administrativa ou de modelo foi lida.
