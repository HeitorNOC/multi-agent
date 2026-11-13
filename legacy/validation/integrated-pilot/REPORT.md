# Piloto integrado — 03/11/2026

## Decisão

**GO para continuar a qualificação da arquitetura por componentes; NO-GO para produção.** A integração LangGraph + LightRAG + PostgreSQL/pgvector + Neo4j + Keycloak passou no cenário pequeno. Não há evidência de impossibilidade do Paperclip: a reavaliação anterior demonstrou adaptação externa viável. Este piloto qualifica outro recorte e não reabre essa conclusão como reprovação absoluta.

Resultado final: **1 teste E2E, 13 checkpoints de aceitação, PASS em 277,38 segundos**. Não são 13 testes independentes nem uma medição de RTO. Evidências: `evidence/integration.log`, `integration.xml`, `integration.json`; implementação verificável em `test_installation.py`. Uma execução anterior passou em 328,74 segundos, com 12 checkpoints (`evidence/attempt-2`). A execução final acrescentou cache comprovadamente aquecido, nova versão após revogação e comparação explícita do recibo pré/pós-restore.

## Instalação efetivamente exercitada

Instalação sintética `3131b4220e`, serviços reais descartáveis, portas vinculadas a 127.0.0.1. PostgreSQL 16.15, pgvector 0.8.7, Neo4j Community 5.26.32, Keycloak 26.8.1. Imagens fixadas por digest em `harness.py` e no JSON de evidência. LangGraph 1.2.19, checkpoint 4.3.1, saver PostgreSQL 3.2.0, LightRAG 1.5.8; fontes e dependências registradas no manifesto e freeze.

O LightRAG usa PGKVStorage, PGVectorStorage, PGDocStatusStorage e Neo4JStorage reais. Ingestão pelo journal `ainsert`, publicação somente após processamento, grafos/índices separados por instalação, geração e domínio de acesso. O LangGraph é o único dono da execução e usa AsyncPostgresSaver real, em schema e identidade SQL próprios. O corpus contém oito fontes portuguesas sintéticas, seis públicas e duas financeiras, política versionada e instrução maliciosa marcada como fonte não confiável.

**Extração de entidades e embeddings são fixtures determinísticas; não houve chamadas a modelos nem cobrança de API.** Os valores financeiros são unidades sintéticas. Keycloak emite e valida tokens reais, mas os papéis de analista, financeiro, aprovador e executor são contas de serviço client_credentials. Não houve autenticação humana interativa, federação empresarial ou teste de qualidade semântica.

## Evidências e implicações

| Contrato | Resultado observado | Limite |
|---|---|---|
| Identidade e autoridade | JWT inválido rejeitado; analista sem administração; executor não autoaprova; proprietário/resultado de outro run protegidos | Papéis humanos simulados por identidades de serviço; sem TLS no laboratório |
| Conhecimento e sigilo | Contexto público sem canários financeiros; financeiro consulta entidades/relações privadas; autorização antes de grafo, vetor e cache | Se um documento financeiro perde acesso, bloqueia-se todo o domínio misto; custo de disponibilidade |
| Revogação | Cache privado comprovadamente aquecido deixa de responder após revogação; versão/reindexação posterior não concede novamente o acesso | Não prova política distribuída sob concorrência/carga |
| Proveniência e publicação | Objetos SHA-256, versões imutáveis pela API, g1 histórica e g2 atual distintas; g3 reindexada após revogação | Hash não prova veracidade/autenticidade da fonte; administrador SQL privilegiado não foi neutralizado |
| Aprovação e orçamento | Plano/hash/epoch e fontes vinculados; aprovação antiga recusada; reserva e conciliação mantidas | Controller e agentes são capacidades mínimas; valores não são custos reais |
| Restore conjunto | 13 artefatos: três bancos, roles, grafo e oito objetos; corrupção rejeitada antes de restaurar; novos volumes vazios | Backup frio sem tráfego; não é PITR, HA, failover ou upgrade |
| Revogação após backup | Diário externo HMAC preserva revogação posterior ao snapshot; replay antes de abrir consultas | Chave retida pelo operador, sem WORM/KMS e sem prova de desastre do próprio diário |
| Efeito externo incerto | Provedor confirmou entrega antes do restore apesar de conexão interrompida; aplicação permaneceu effect_pending | Provedor HTTP/SQLite é simulador de contrato, sem integração com e-mail real |
| Retomada nativa | Novo processo retoma checkpoint restaurado, encontra exatamente o recibo original; uma entrega, um outbox, duas leituras, custo sintético 3, reserva 0 | Garantia depende de identidade estável da intenção e de consulta/idempotência do provedor |

O erro 503 e o exit code 1 na segunda chamada do worker são **falha injetada esperada**, não um teste aprovado ignorando erro. O teste exige estado pendente e confirma a entrega externa antes da recuperação. Somente após conciliação o novo processo conclui. O recibo externo e o diário de segurança ficam fora do rollback deliberadamente.

## Limite crítico do restore

O restore é coerente no ponto **g1**, anterior às alterações g2/g3. Essas atualizações de conteúdo não são recuperadas automaticamente. A prova demonstra preservação de revogação e conciliação de uma ação histórica com nova aprovação; **não demonstra que o cérebro restaurado conhece a versão mais recente das políticas da empresa**. Para produção, o modo de recuperação deve impedir novas decisões operacionais até reconciliar conectores, fontes, políticas e versões atuais. A abertura deste laboratório verifica integridade e consulta da g1, não essa atualidade externa.

Temporalidade bitemporal Graphiti, contradições, causalidade, verdade das fontes e qualidade de respostas com citações continuam pendentes. A lista de fontes autorizadas retornada pelo harness não significa que todas sustentem uma resposta. O material hostil não ultrapassa a autorização do backend, mas isso não é homologação de resistência de um LLM a prompt injection.

## Preservação arquitetural

Mantêm-se instalação dedicada por cliente, cérebro persistente único com fontes canônicas/versionadas, equipes por capacidades, Chief of Staff como interlocutor, Adaptive Controller para estratégia/risco/orçamento e um único owner de workflow. Aprovação, delegação, memória e contratação permanente/temporária seguem os requisitos do dossiê. Este ensaio não implementa toda essa organização; comprova contratos de um recorte e registra o restante como pendência.

A preferência continua por camada empresarial TypeScript e motores/IA Python reutilizados. `application.py` é harness de validação, não decisão de reescrever produto em Python. Não foram acrescentados NestJS, Kafka, Redis, Temporal nem outro dono de execução. A interface JARVIS funcional React/TypeScript/Three.js continua prevista para depois dos contratos. Paperclip/OpenAgents não foram integrados neste cenário; não se infere homologação dos respectivos control planes. Não substituímos LightRAG/Graphiti por implementações próprias de motores.

## Falhas, adaptações e operação

1. Primeira tentativa interrompida no provisionamento: rede Docker `--internal` apresentava serviços saudáveis, mas porta publicada vazia (`attempt-1/ports.json`). Nenhuma asserção funcional foi executada. Rede bridge com bindings localhost permitiu o ensaio. **Egress continua não qualificado**; não se apresenta essa mudança como isolamento de rede aprovado.
2. Cache padrão do uv sem acesso de escrita: usado cache no workspace. Nenhuma alteração de upstream para contornar comportamento do motor.
3. Antes da primeira execução completa foram corrigidos contratos do próprio harness: evitar regrants ao versionar fontes; ajustar limiar de sumarização para não chamar modelo na fixture; preservar portas entre restarts. Telemetria de uso Neo4j explicitamente desativada no perfil final.
4. O teste final registrou remoção de quatro volumes e da rede. Uma verificação independente de inventário após o teste não pôde consultar o daemon, que estava **manualmente pausado**. O estado foi respeitado; não se afirma uma segunda confirmação de limpeza. Recursos externos ao prefixo não foram modificados.

Os dumps privados permanecem localmente em `.state`, fora da entrega. Contêm chaves/credenciais de teste e não são material para publicação. O manifesto de backup detecta alteração de bytes; não tem assinatura contra atacante que também substitua o manifesto. Segredos do operador permaneceram disponíveis durante o ensaio: não houve prova de recuperação de vault perdido. O grafo de usuário foi restaurado; credenciais administrativas Neo4j foram recriadas pelo operador.

## Próxima qualificação

Antes de produção: freshness pós-restore com bloqueio de novas decisões; modelos/embeddings reais e avaliação portuguesa com citações/abstenção; custos reais conciliados com provedor; SSO humano/TLS/rotação/revogação de identidades; secrets manager e recuperação de chaves; gateway de ferramentas/MCP, egress e sandbox de código não confiável; Graphiti temporal; concorrência/carga/backpressure; PITR/failover e RPO/RTO; SBOM/CVE/licenças/retencão. Os gates anteriores não foram convertidos em aprovação global por este PASS.

O próximo recorte técnico recomendado é **recuperação com verificação de atualidade e bloqueio de novas decisões**, seguido da avaliação semântica com modelos autorizados. A instalação pequena mostrou viabilidade de integração; a meta permanece uma empresa grande, sem extrapolar capacidade a partir de oito documentos.

## Continuidade — 04/11/2026

A rodada seguinte está documentada em [DECISION.md](../decision-qualification/DECISION.md) e [RESULTS.md](../decision-qualification/RESULTS.md), com implementação isolada em decision-qualification. Esse adendo não altera retrospectivamente os resultados de 03/11, nem transforma os gates históricos em aprovação de produção.
