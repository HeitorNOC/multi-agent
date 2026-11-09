# Fontes e rastreabilidade

A decisão se apoia sobretudo na execução local registrada, com código vendor fixado por SHA no manifesto. Documentação primária consultada para montagem do laboratório:

- [Keycloak Docker quickstart](https://www.keycloak.org/getting-started/getting-started-docker) e [containers](https://www.keycloak.org/server/containers): distribuição/execução. O teste usa configuração própria com PostgreSQL; credenciais dos exemplos públicos não foram adotadas.
- [Neo4j Docker](https://neo4j.com/docs/operations-manual/current/docker/introduction/) e [configuração Docker](https://neo4j.com/docs/operations-manual/current/docker/configuration/): imagem e tradução de configuração para variáveis de ambiente.
- [Configuração dbms.usage_report.enabled](https://neo4j.com/docs/operations-manual/current/configuration/configuration-settings/#config_dbms.usage_report.enabled): telemetria explicitamente desativada no ensaio final.
- [pgvector oficial, Docker](https://github.com/pgvector/pgvector#docker): distribuição da extensão. Versões efetivas foram consultadas no banco em execução, não inferidas da página.

As páginas atuais não substituem os digests/SHA da execução. Dump/load Neo4j foi validado pelo CLI da imagem fixada. Não houve consulta externa de dados empresariais.

| Evidência | Implementação |
|---|---|
| JWT, grants e autoridade | application.py:57,68,197 |
| Instância LightRAG e fixture explícita | application.py:79; embeddings:22; no_model:31 |
| Ingestão versionada/publicação | application.py:101 |
| Consulta autorizada/cache | application.py:134 |
| Diário não revertido/replay | application.py:152,160 |
| Plano e recibo | application.py:180,191; provider.py |
| Um dono de execução/checkpoint | engine.py:9 |
| Identidades de serviço | harness.py:92,105 |
| Backup/hash/restore | harness.py:164,178,182 |
| Prova conjunta e asserts | test_installation.py |

Os contratos e gates completos continuam no dossiê `poc/DOSSIER.md` e na investigação anterior `validation/production-readiness`; os arquivos de origem não foram incorporados ao ZIP como se fossem novos resultados.
