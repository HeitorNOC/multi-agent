# Piloto integrado reproduzível

Leia `REPORT.md` para decisão e limites, `RUNBOOK.md` para ciclo operacional e `COMMANDS.md` para comandos. O teste provisiona serviços Docker reais e depois os remove; não deixa uma instalação de demonstração em execução. Dados, e-mails e custos são sintéticos. O corpus é português.

`application.py`: autorização, versões, integração LightRAG e contratos empresariais mínimos. `engine.py`: LangGraph/checkpoint PostgreSQL. `provider.py`: provedor externo simulado com recibos. `harness.py`: infraestrutura, identidade e restore. `test_installation.py`: um cenário E2E com 13 checkpoints.

Dependências e fontes precisam estar disponíveis nos caminhos do workspace descritos em `COMMANDS.md`. `.venv`, `.state`, caches e repositórios vendor não integram o ZIP. Evidências incluem falha injetada esperada e tentativa de provisionamento interrompida. Não usar o harness como deployment de produção.
