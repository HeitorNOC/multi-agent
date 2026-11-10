# Restore coordenado do novo estado — 04/11/2026

Continua concurrent-reconciliation em instalação própria descartável. Duas APIs reais, PG/pgvector/Neo4j/Keycloak, LightRAG nativo, embeddings reais e provider Codex Terra. Dados sintéticos, sem ações empresariais externas. Cap 40 reservas de tentativa model e cap 7 no escopo de reserva stress; não representam orçamento monetário.

## Mudanças necessárias após inspeção

O backup herdado parava apenas a API principal e capturava inventário antes de drenar escritores. Não incluía propostas, tombstones e auditoria na comparação lógica. Por isso, resultados anteriores não eram suficientes para esta versão.

Agora `/recovery/freeze` usa a exclusão PG da instalação, espera trabalho admitido e drena também o lock separado de revogação. Persiste um bloqueio de backup. Ambas as APIs consultam esse bloqueio antes de novas operações, inclusive revogações. Rotas de status continuam disponíveis. O harness para todas as APIs, IdP e Neo4j antes dos dumps; SQLite editorial usa backup transacional, PG usa dumps/roles, Neo4j dump offline, arquivos/Vault são copiados e chaves editoriais/journal cifradas. Todas as APIs reiniciam antes do thaw. Não existe snapshot online ou consistência com writers privilegiados fora desse protocolo.

Inventário inclui propostas, tombstones, auditoria e revisão lógica, além dos recibos/admissões/decisões/projeções, dados PG de conhecimento, grants, editorial e grafo. Manifest assinado declara formato e fingerprints dos fontes críticos. Formato incompatível exige migração explícita; não foi implementada/testada uma migração real entre versões antigas.

## Atualidade, quotas e manutenção

Três condições independentes para abrir o restore: inventário conjunto coincidente; head de operações retido atualizado e sem pendência; contadores retidos não inferiores aos pisos assinados do backup, com caps compatíveis. O contador pode ser maior que o do backup, pois reservas posteriores devem continuar consumidas. Uma vaga reservada sem iniciar o CLI não é reembolsada automaticamente.

A autoridade, o journal e as reservas ficam fora do bundle restaurado do cliente. A simulação negativa apaga contadores na autoridade retida mantendo operações, depois reabre as APIs em joint_restore: o gate deve recusar mesmo que o head coincida. O harness repara os bytes da fixture a partir de uma cópia privada feita antes da adulteração; isso não é procedimento de recuperação empresarial ou rollback autorizado de quota em produção.

`thaw` retoma um backup normal, mas não abre joint_restore nem ignora estado recovering. No restore válido, só a abertura por governança após todas as checagens remove os dois bloqueios. O estado frozen/token do snapshot é operacional e não é comparado como dado de negócio.

## Protocolo

1. Fonte pública aprovada e respostas originais de dois usuários.
2. Pausa privada após inferência: backup espera pedido; depois congela ambas as APIs e recusa novas escritas/revogação. Captura g1 inclui o pedido concluído.
3. Depois de g1, intenção sem admission é fechada unknown por duas identidades; outra decisão interrompida é conciliada. G2 inclui propostas, tombstone e auditoria.
4. Consome-se uma reserva model sem invocar o CLI e revoga-se o grant de um usuário depois de g2.
5. Restore g1 em volumes/caminhos novos deve permanecer bloqueado; thaw não é override.
6. Restore g2: adulteração de cada tabela nova e reset isolado de contadores impedem abertura.
7. Repostos os dados corretos da fixture, ambas as APIs abrem com respostas originais, tombstone e revogação preservados; quota stress continua esgotada e a vaga model abandonada continua consumida.
8. Oito pedidos iguais alternados entre as duas APIs restauradas geram um único novo registro e usam o índice nativo, sem reutilizar IDs de chamadas.

## Limites preservados

Não se qualifica KMS, perda total do host, HA/PITR, autoridade externa real, rollback da própria autoridade acima dos pisos conhecidos, conectores ou writers que ignorem o gate. KEKs, credenciais e chave privada ficam retidas na memória do harness; nenhum segredo é entregue no ZIP. A autoridade é processo/SQLite separado no mesmo host, não solução de produção aprovada.

São testes de bancada, com controle Python e editorial/proveniência TypeScript reais. Permanecem camada empresarial final TypeScript, LangGraph único owner, cérebro central lógico, instalação dedicada, equipes por capacidades, Chief of Staff, A0–A4 e JARVIS como requisitos; não se homologou o produto completo. Obsidian é editor opcional, sem UI ensaiada; Graphiti não se torna autoridade histórica exclusiva. Corpus/carga e custo monetário permanecem gates.

Não se extrapola o PASS de um procedimento frio com duas APIs para backup sob carga empresarial, cancelamento durante modelo, rede particionada ou banco indisponível. Calls CLI e reservas têm contagens separadas: o ensaio inclui deliberadamente uma reserva sem execução.
