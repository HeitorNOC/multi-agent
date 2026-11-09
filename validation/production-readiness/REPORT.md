# Investigação de requisitos de produção — 2026-11-03

**Decisão: continuar a qualificação com LangGraph e componentes prontos; produção permanece NO-GO.** A arquitetura é viável como composição, mas as provas atuais não homologam um cérebro empresarial completo, isolamento de todas as fontes, segurança operacional ou escala de uma empresa grande.

O usuário definiu empresa grande como referência, iniciando testes menores. Isso orienta capacidade, contratos e governança; não é promessa de suportar qualquer carga. Permanecem instalação dedicada por cliente, cérebro central persistente, equipes dinâmicas, Chief of Staff, controlador adaptativo, camada própria, UI JARVIS funcional e preferência por TypeScript com IA em Python.

## Achados que mudam a preparação para produção

1. **ACL precisa abranger o grafo.** O LightRAG híbrido real fundiu fonte pública e confidencial nas mesmas entidades/relações. Filtrar apenas chunks/citações deixou o segredo no contexto. A configuração compartilhada sem controle por fonte/partição é rejeitada. A mitigação testada autorizou partições e política vigente antes de consultar grafo/vetores/cache.
2. **Ingestão anterior não homologava recuperação.** ainsert_custom_kg fica fora da garantia de recuperação por documento, conforme seu código/documentação. A nova prova usou ingestão journaled, encontrou anchors e excluiu a fonte do retrieval. Produção deve usar caminhos recuperáveis e publicar índices completos por geração.
3. **Graphiti agrega temporalidade, não identidade.** O SDK e seus campos/filtros temporais foram inspecionados, com 16 testes unitários selecionados aprovados. Os servidores REST/MCP de referência declaram ausência de autenticação/autorização. Seu group_id não é ACL; novos episódios têm capacidade de alterar fatos anteriores. A integração exige controle de ingestão e confiança pela nossa Knowledge API.
4. **Durabilidade precisa cobrir o conjunto.** RLS, catálogo/proveniência, reserva concorrente, crash WAL e restauração lógica passaram em PostgreSQL real. O saver PostgreSQL nativo LangGraph também retomou em processo novo após SIGKILL do banco, sem repetir a etapa concluída. Falta restaurar e reconciliar a instalação inteira, incluindo objetos, índices, secrets e efeitos externos.
5. **Sandbox é parte da execução, não do prompt.** Seis contêineres descartáveis comprovaram limites de privilégios, filesystem, rede, memória, processos e encerramento no ambiente local. Isso não é certificação contra escape, browser hostil, egress autorizado ou infraestrutura de produção.
6. **Preço real não é gasto medido.** Foram consultados preços oficiais e produzidas projeções explícitas. A normalização recusa usage ambíguo e distingue cache/TTLs/raciocínio. Nenhuma chamada paga ou fatura foi medida; esse gate continua aberto.

## Evidência executada

| Bateria | Resultado | Evidência | Conclusão permitida |
|---|---|---|---|
| LightRAG upstream selecionado | 62 PASS | evidence/lightrag-upstream.xml | Isolamento, recuperação, exclusão fail-closed, validação/cache nos cenários existentes selecionados |
| Cérebro híbrido/ACL/exclusão próprio | 3 PASS | evidence/brain.xml e brain-*.json | Risco de contaminação reproduzido; mitigação por partição testada; ingestão/exclusão journaled real com modelos sintéticos |
| Graphiti temporal/query helpers | 16 PASS | evidence/graphiti-unit.xml | Contratos unitários; sem banco de grafo ou extração LLM real |
| Contabilização de rate cards | 8 PASS | evidence/costs.xml | Matemática e normalização por fornecedor; sem billing real |
| Identidade assinada/política | 13 checks | evidence/identity.json | Validação criptográfica e guards locais; sem IdP/JWKS/mTLS de produção |
| Sandbox | PASS, 6 contêineres | evidence/sandbox.json | Controles efetivamente observados nesta VM Docker |
| PostgreSQL canônico | PASS, 19 verificações | evidence/postgres.json | RLS/proveniência/integridade/crash/restore e orçamento concorrente na fixture |
| Saver PostgreSQL LangGraph | PASS | evidence/pg-saver.json | Checkpoint/interrupt retomado após novo processo e queda abrupta do banco; uma chamada da etapa inicial |

Não somar checks, contêineres e casos pytest como uma cobertura uniforme. Risco reproduzido é parte de uma suíte verde; não foi ocultado como feature aprovada. Não houve patch funcional em clones upstream.

## Reuso recomendado e limites

| Componente | Uso proposto | Estado de produção |
|---|---|---|
| LangGraph | Único dono do workflow, saver PostgreSQL e checkpoints | Preferido; integração parcial demonstrada; HA/migrações/segurança do deployment ainda abertas |
| LightRAG | Ingestão/retrieval/grafo atrás da Knowledge API | Reutilizar com autorização e geração de índices; não expor grafo compartilhado sem controle comprovado |
| Graphiti | Candidato pronto para memória temporal/episódica | SDK condicional; integração de banco/semântica temporal/confiança não homologada |
| Paperclip | Candidato de governança, por API/adaptador externo | Impossibilidade refutada anteriormente; produção não aprovada automaticamente |
| OpenAgents | Colaboração quando houver benefício concreto | API reutilizável; identidade granular e consumidor idempotente necessários |
| AgentScope | Alternativa/SDK de agentes se justificar | Continua viável; sem segundo coordenador de workflow adotado |
| SSO/secrets/backup/telemetria/sandbox | Reutilizar componentes disponíveis e suportados | Não construir equivalentes próprios; produto/serviço específico precisa de qualificação |

A nossa camada concentra contratos e política empresarial, seleção de capacidades A0–A4, delegação de autoridade, adaptação de APIs, governança de conhecimento e conciliação. Não deve reimplementar LightRAG, Graphiti, motores ou um control plane inteiro só por padronizar a linguagem.

## Limites técnicos encontrados no backend

O PostgreSQL testado é 16.15, com pgcrypto e sem pgvector/AGE. O código LightRAG bloqueia AGE a partir de 1.8.0 por incompatibilidade conhecida no SHA auditado. Não contornar o gate, presumir extensões disponíveis ou afirmar que o teste de catálogo/checkpoint homologou o storage completo de conhecimento.

A coordenação multiprocessing/Manager de workspace inspecionada não provou ingestão distribuída entre hosts independentes. Também não qualificamos a coabitação de schemas LightRAG/Graphiti num mesmo backend. A escolha de storage precisa considerar ACL, escrita, recuperação, escala, licença/edição e operação.

## O que permanece necessário para produção

- Integrar corpus canônico versionado, ACL/proveniência/tempo, índices e cache com publicação/revogação consistentes, inclusive nas relações e fatos derivados.
- Qualificar retrieval e explicações com corpus em português, documentos/tabelas contraditórios e modelos/embeddings reais autorizados; medir resposta correta, citações e abstenção.
- Integrar SSO/service identities, validade/rotação/revogação, gateway MCP/egress, secrets manager e sandbox por classe de ferramenta.
- Conciliar custos efetivos de todos os agentes, ingestão, ferramentas e retries com uso/fatura dos provedores, mantendo obrigações incertas após timeout.
- Demonstrar restore completo/PITR/failover, migração/upgrade, isolamento por instalação e retomada sem duplicar efeitos após restaurar backup antigo.
- Ensaiar carga, filas, backpressure, limites por provedor, SLO/RPO/RTO e resposta a incidentes; completar SBOM/CVE/licenças/ativos e retenção de dados/traces.
- Manter contratação permanente com aprovação, temporários dentro de policy e controlador adaptativo sem autoridade concorrente com governança/runtime.

Os gates, responsáveis, evidências e próximos ensaios estão em GATES.csv. Eles não são uma lista genérica independente do produto: derivam dos requisitos do dossiê e dos riscos observados nas provas.

## Falhas e adaptações

PostgreSQL: a primeira fixture de owner/FORCE RLS não tinha permissão para ler doc_acl; corrigimos o grant na fixture e repetimos. Isso não foi falha do PostgreSQL. O teste demonstrou o bypass do owner sem FORCE e o perigo de usar GUC arbitrário como identidade.

Saver: primeiro falhou por ProactorEventLoop no Windows; depois houve timeout após restart. Instrumentação confirmou conexão/setup inicial e falha na conexão seguinte. A prova corrigida redescobriu a porta efêmera, que passou de 54084 para 54094, e concluiu. Houve também uma interrupção temporária da revisão automática e Docker parado entre tentativas; essas condições foram resolvidas pelo fluxo normal, sem bypass de aprovação. Todas as falhas foram preservadas.

Sandbox e PostgreSQL só removeram recursos exclusivos da auditoria, com nomes próprios e digests fixados. O teste canônico usou trust apenas em contêiner sem rede/portas; o saver usou senha efêmera com porta vinculada a localhost. Nenhuma dessas configurações de teste foi oferecida como deployment de produção.

## Entregas e sequência proposta

[BRAIN.md](BRAIN.md): fontes, grafo, autorização, temporalidade e memória. [SECURITY.md](SECURITY.md): identidade, RLS, sandbox, rede/MCP e gaps. [COSTS.md](COSTS.md): rate cards e hipóteses reproduzíveis. [OPERATIONS.md](OPERATIONS.md): deployment dedicado, backup/recovery, capacidade e operação. [SOURCE_TRACE.md](SOURCE_TRACE.md) e [SOURCES.md](SOURCES.md): código e fontes primárias. [COMMANDS.md](COMMANDS.md): comandos, falhas e reprodução.

A próxima qualificação integrada deve ser pequena, mas exercitar os contratos de produção: uma instalação isolada, PostgreSQL e backend de conhecimento escolhidos/fixados, corpus representativo com ACL e versões, runtime LangGraph, identidade/gateway, aprovação e efeito idempotente. Testar atualização/revogação, falha e restore do conjunto antes de escalar. Não começar pela UI nem declarar homologação pela soma das provas parciais.

## Adendo — piloto integrado concluído em 03/11/2026

O ensaio proposto foi executado: [relatório do piloto](../integrated-pilot/REPORT.md). Um teste E2E com 13 checkpoints passou em 277,38 segundos usando PostgreSQL/pgvector, Neo4j, Keycloak, LightRAG e checkpoint nativo LangGraph. Restore conjunto em volumes novos preservou revogação posterior ao backup por replay de diário externo; retomada conciliou o recibo original sem duplicar efeito. Isso avança os gates de integração, ACL, publicação e restore no escopo pequeno. Não qualifica modelos reais, identidade humana, egress/sandbox integrado, custos efetivos, temporalidade Graphiti, carga, PITR ou atualidade de fontes pós-restore. A geração recuperada é histórica g1; atualizações g2/g3 não foram recuperadas. A decisão para produção permanece NO-GO, e a matriz histórica não foi reclassificada como aprovação global.

## Continuidade — decisão de 04/11/2026

Nova rodada: [decisão por componente](../decision-qualification/DECISION.md), [resultados e limitações](../decision-qualification/RESULTS.md), [gates atualizados do recorte](../decision-qualification/GATES.csv). Inclui verificação de inventário atual pós-restore, geração antiga impedida de emitir efeitos, avaliação real GPT-6.1 Terra autorizada pelo usuário, embeddings locais pré-treinados separados e gateway local de execução restrita. A matriz original continua histórica; o novo recorte não qualifica automaticamente toda a arquitetura de produto ou implantação empresarial.

### Integração semântica posterior

[Prova semântica nativa](../semantic-integration/RESULTS.md): PASS em 402,01 s, oito checkpoints, com extração/keywords/respostas reais e embeddings pré-treinados no próprio caminho LightRAG/PostgreSQL/Neo4j. A integração preservou versões, citações, abstenção, incerteza e revogação pós-restore no corpus sintético pequeno. B06 avança de fixture para prova integrada pequena; B07 temporal e os gates de corpus representativo/operação empresarial continuam pendentes. Não houve aprovação de produção.

### Graphiti temporal e publicação editorial

[Rodada temporal-editorial](../temporal-editorial/RESULTS.md): B07 foi exercitado com SDK/banco/modelos reais, com FAIL de aceitação completa (Terra 3/7, Sol 6/7). A reconstrução do que era conhecido antes da retificação falhou nos dois; não usar essa projeção como única autoridade histórica. Dez testes editoriais TypeScript/strict passaram, assim como uma prova adicional de falha entre grafo e commit, restart e conciliação do snapshot aprovado sem reingestão. O vault é compatível com Obsidian, mas a UI não foi testada. Fonte canônica as-of e história de fatos nativos são contratos distintos; nenhum desses resultados aprova produção.

### Fonte canônica e registros de assessoramento

[canonical-decisions](../canonical-decisions/RESULTS.md): pesquisa registrada, hipóteses distintas e E2E PASS em 214,39 s com seleção temporal da fonte, LightRAG real e registro original PostgreSQL. Cinco casos passaram; resposta anterior foi lida byte a byte sem regeneração após retificação e restart. Papel SQL de gravação não pôde atualizar/apagar registros; grants atuais protegeram registros privados após revogação. Isso é evidência limitada de integração, não avaliação geral de modelo/arquitetura, WORM, backup conjunto ou produção. O FAIL nativo Graphiti permanece histórico e não foi reclassificado.
