# Qualificação para decisão — 04/11/2026

Leia `DECISION.md` para manter/trocar componentes e gates de produção, `RESULTS.md` para números finais e limitações, `COMMANDS.md` para reprodução e falhas. Implementação de laboratório isolada; não é deployment de produto.

`test_decision.py` executa um cenário E2E com serviços reais, backup/restore, autoridade de fontes simulada, geração histórica bloqueada, conciliação sem novo envio, identidade humana sintética, carga e reserva concorrente. `model_eval.py` usa Codex/Terra real em contexto autorizado capturado. `embedding_probe.py` testa ONNX multilíngue real separadamente. `sandbox_gateway.py` testa um executor de ferramenta com restrições e capabilities locais.

Mantenha `.state`, `.models`, ambientes virtuais e arquivos de autenticação fora de qualquer publicação. Os dumps locais contêm segredos de teste. O ZIP contém somente fontes de teste, corpus e evidências selecionadas; não contém pesos, segredos ou vendor. Dependências e SHAs precisam estar presentes no workspace para reprodução.
