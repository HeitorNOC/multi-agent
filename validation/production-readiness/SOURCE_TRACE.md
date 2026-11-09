# Trace de código e evidência

SHAs e hashes completos no manifesto. Linhas referem-se aos arquivos inspecionados, não à branch futura do upstream.

| Contrato/risco | Fonte |
|---|---|
| Warning de inserção direta fora da garantia por documento | vendor/lightrag/lightrag/lightrag.py:4340 |
| Retrieval estruturado | vendor/lightrag/lightrag/lightrag.py:4901 |
| Exclusão por documento | vendor/lightrag/lightrag/lightrag.py:6727 |
| Parâmetros de consulta sem ACL documental nativa equivalente | vendor/lightrag/lightrag/base.py:90 |
| Gate AGE >=1.8.0 no SHA avaliado | vendor/lightrag/lightrag/kg/postgres_impl.py:124 |
| Locks/Manager por processo/workspace | vendor/lightrag/lightrag/kg/shared_storage.py |
| Graphiti ausência de auth e confiança por group_id | vendor/graphiti-audit/SECURITY.md:14 |
| Campos temporais de aresta | vendor/graphiti-audit/graphiti_core/edges.py:263 |
| Filtros temporais | vendor/graphiti-audit/graphiti_core/search/search_filters.py |
| Normalização temporal | vendor/graphiti-audit/graphiti_core/utils/maintenance/temporal_edge_utils.py |
| Saver PostgreSQL e setup/migrations | vendor/langgraph/libs/checkpoint-postgres/langgraph/checkpoint/postgres/aio.py:45 |
| Ingestão journaled da fixture | validation/production-readiness/test_brain.py:25 |
| Contaminação do grafo/filtragem insuficiente | validation/production-readiness/test_brain.py:54 |
| Partições e revogação antes de cache | validation/production-readiness/test_brain.py:69 |
| Exclusão e anchors | validation/production-readiness/test_brain.py:96 |
| Verificação de identidade e política | validation/production-readiness/identity_probe.mjs |
| Sandbox real | validation/production-readiness/sandbox_probe.py |
| Catálogo/proveniência/RLS/crash/restore | validation/production-readiness/postgres_probe.py; catalog_probe.sql |
| Saver em processo novo | validation/production-readiness/pg_saver_worker.py; pg_saver_probe.py |
| Normalização/cálculo de tarifas | validation/production-readiness/costs.py:19,30,37 |
| Projeções de cenários | validation/production-readiness/costs.py:54 |

A busca de QueryParam é uma revisão estática, não prova de que não exista qualquer extensão futura de ACL em outro backend. O vazamento relevante foi reproduzido no modo híbrido real; a mitigação é explicitamente nossa. O aviso AGE é do código fixado e não uma declaração de que toda versão futura do projeto será incompatível.
