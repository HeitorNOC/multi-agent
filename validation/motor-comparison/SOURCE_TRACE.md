# Fontes e contratos verificados

Os SHAs estão em manifest.json. Caminhos da raiz do workspace; linhas verificadas nesta rodada.

| Contrato | Fonte |
|---|---|
| Identidade, aprovação, reserva, efeito e fences da fixture | validation/motor-comparison/service.py:90,114,127,155,169,178,208 |
| Ledger e contabilização comum | validation/motor-comparison/service.py:19 |
| LangGraph checkpoint/interrupt no experimento | validation/motor-comparison/worker.py:14 |
| AgentScope SDK/TeamPipeline no experimento | validation/motor-comparison/worker.py:53 |
| Conferência de conclusão empresarial, independente do texto do modelo | validation/motor-comparison/worker.py:95 |
| Contrato HTTP comum | validation/motor-comparison/protocol.py:17 |
| Command/interrupt oficiais | vendor/langgraph/libs/langgraph/langgraph/types.py:833,903 |
| Saver SQLite assíncrono | vendor/langgraph/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/aio.py |
| Time de agentes/delegação/park/HITL | vendor/agentscope-audit/src/agentscope/pipeline/_team_pipeline.py:111,162 |
| Fast path read-only antes de check_permissions | vendor/agentscope-audit/src/agentscope/permission/_engine.py:170 |
| Persistência de sessão existente no AgentScope (não qualificada no comparativo) | vendor/agentscope-audit/src/agentscope/app/storage/_sql/_storage.py:1288 |
| Checkpoint de estado/eventos do Agent Service (não qualificado no comparativo) | vendor/agentscope-audit/src/agentscope/app/_service/_chat.py:1671 |
| Estado de sessão persistível | vendor/agentscope-audit/src/agentscope/app/storage/_model/_session.py:479 |
| Retrieval estruturado LightRAG sem geração de resposta | vendor/lightrag/lightrag/lightrag.py:4901 |
| Publicação e polling reais OpenAgents | vendor/openagents-audit/workspace/backend/app/routers/events.py:349,792 |
| Fixture Knowledge reutilizada, vetores e ingestão | poc/runtime.py:17,29 |

A documentação [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) foi consultada como apoio; os testes usam o código fixado. O arquivo de referências não declara que o AgentScope carece de persistência: os contratos de serviço encontrados estão listados explicitamente.
