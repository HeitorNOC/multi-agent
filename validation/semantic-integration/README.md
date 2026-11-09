# Integração semântica nativa — 04/11/2026

Continuação da decisão registrada em `validation/decision-qualification`. Esta rodada substitui as fixtures de extração e embeddings no caminho LightRAG por inferência real, mantendo a camada de autorização e versionamento da bancada.

Leia `REPORT.md` para contratos/limites, `RESULTS.md` para resultados efetivos e `COMMANDS.md` para reprodução/falhas. `manifest.json` e o ZIP são gerados somente após validar o resultado do teste. Código vendor permanece fixado e sem alterações.

`application.py`: acesso autenticado, ACL, geração e LightRAG. `codex_provider.py`: adaptação delimitada da inferência CLI, sem extrator próprio. `embedding_server.py`: ONNX pré-treinado local autenticado por HMAC, com hashes dos pesos verificados. `harness.py`: infraestrutura descartável e restore frio. `test_semantic.py`: corpus sintético e aceitação.

Não há agentes terceirizados, mensagens reais, compra de infraestrutura ou deployment de produto. A interface JARVIS, o controlador adaptativo e a camada empresarial TypeScript continuam requisitos; este diretório é uma bancada Python, não uma mudança da arquitetura de produto.
