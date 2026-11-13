# Decisão técnica — qualificação de 04/11/2026

**Continuar a arquitetura e a construção do protótipo com os componentes atuais. Não liberar esta instalação/harness para produção.** Não foi demonstrado impedimento estrutural que justifique trocar todo o motor. O impedimento atual é a cobertura incompleta dos contratos de produto e operação, com fixtures ainda presentes no caminho integrado. Trocar bibliotecas não resolve automaticamente essas lacunas.

Esta é uma decisão sobre as evidências desta rodada, não promessa de homologação futura. Os números finais e eventuais falhas estão em `evidence/integration.json`, `decision.log`, `model-evaluation.json`, `pretrained-embedding.json` e `sandbox-gateway.json`. O manifesto consolida estados sem converter ensaios parciais em aprovação global.

| Componente | Decisão | Evidência/condição |
|---|---|---|
| LangGraph | Manter como único owner de workflow | Checkpoint PostgreSQL real; interrupção/aprovação e retomada em novo processo. Alterar geração invalida execução histórica; não acrescentar outro motor concorrente. |
| LightRAG | Manter para próxima integração semântica; aprovação de produção pendente | Storage PostgreSQL/pgvector e Neo4j reais; permissões e versões funcionam na camada própria. Extração e embeddings da integração continuam determinísticos; teste de modelo real e teste de embeddings são complementares, não homologação desse caminho inteiro. |
| PostgreSQL/pgvector + Neo4j | Manter como backend candidato | Restore frio em volumes vazios demonstrado; sem prova de PITR/failover, upgrade ou capacidade empresarial. Não contornar bloqueio AGE do SHA auditado. |
| Keycloak | Manter como IdP candidato | Tokens assinados, ACL da aplicação e teste local de authorization code/PKCE. Federação/MFA, TLS, revogação no IdP e rotação JWKS continuam gates de implantação. |
| GPT-6.1 Terra pelo Codex | Usar neste ensaio delimitado, autorizado pelo usuário | Inferência real e uso em tokens. Não confundir CLI da conta com serviço empresarial multiusuário, custo em moeda ou adaptador definitivo de produção. Modelo não foi comparado economicamente com Sol. |
| Graphiti | Pendente de qualificação temporal E2E | Provas anteriores de helpers não qualificam fontes contraditórias/tempo com banco e modelo reais. Não substituído por timestamps do harness. |
| Paperclip | Adaptação externa tecnicamente viável; produção pendente | A impossibilidade foi refutada na reavaliação anterior. Este ensaio não o integra e não o aprova para governança organizacional. |
| OpenAgents / AgentScope | Componentes opcionais, sem novo owner de execução | Ensaios anteriores não demonstram necessidade de substituir LangGraph neste recorte. Não presumir que já estão no produto. |

## Mudança comprovável da recuperação

Um backup íntegro não autoriza novas decisões por si só. A camada própria consulta um inventário externo de laboratório, assinado e vinculado à instalação, nonce, instante, sequência, completude e cabeçalho do diário de segurança. A geração restaurada precisa coincidir integralmente com os IDs, versões, domínios, hashes e autoridade declarados nesse inventário. Resposta ausente, adulterada, expirada, repetida ou incompleta mantém bloqueio 503. Após republicar as fontes atuais, revalida o inventário antes de abrir acesso. Uma mudança posterior de sequência fecha o gate novamente.

O inventário externo é **simulador de conector confiável**, não consulta a ERP/DMS real nem prova de completude das fontes de uma empresa. Um fornecedor comprometido que assine informação falsa não é detectado por HMAC. Não há transação distribuída entre autoridade, ACL, grafo e efeito externo: a janela entre verificação e uso exige fencing/versionamento do provedor ou política explícita na implantação. A disponibilidade também passa a depender do conector; falha fecha o acesso deliberadamente.

Runs de geração histórica não podem receber nova aprovação nem enviar efeito. Um caminho separado de governança faz apenas lookup do recibo antigo e concilia obrigação já executada. Ausência de recibo mantém execução bloqueada. Para uma nova decisão, cria-se novo run na geração atual e passa-se por aprovação novamente. O custo de reconciliação e a unicidade do resultado são unidades sintéticas.

## Critérios para liberar uma instalação real

1. Caminho integrado com extração e embeddings reais, corpus representativo e métricas de relevância, citações, abstenção, sigilo e temporalidade; não somente sete perguntas de smoke test. Caso LightRAG não atinja esses critérios sem reconstruirmos o motor, trocar esse componente de conhecimento preservando a API e o workflow.
2. Conectores reais com versão, watermark, revogações e exclusões; fonte canônica autenticada. Restore e reconciliação devem funcionar com perda de chaves/diário/provedor nos cenários explicitamente contratados. Se não houver evidência de atualidade, bloquear decisões novas.
3. Federação humana/MFA conforme cliente, TLS, recuperação e rotação de segredos e chaves, política de revogação/JWKS, isolamento entre instalações e princípio de menor privilégio no deployment. O bootstrap por password do admin é automação local de fixture, não fluxo humano de produto.
4. Broker real de ferramentas integrado à identidade e ao runtime, escopo de destinatário/payload/tempo/orçamento, cancelamento e isolamento conforme classe de execução. O teste Docker separado não é gateway MCP completo; segredos não podem chegar ao código não confiável. Volumes/DB/IdP deste laboratório são serviços confiáveis, com bridge/localhost; não têm o mesmo perfil sem rede do executor.
5. Uso e cobrança atribuíveis a cada execução, incluindo ingestão, ferramentas, retries, falhas e conciliação. O CLI retorna tokens; não fornece fatura monetária atribuída. Custos de assinatura, infraestrutura e operação não foram medidos como custo real por tarefa.
6. Carga crescente com perfil empresarial, filas/backpressure, quotas de provedor, SLO e RPO/RTO definidos; PITR/failover/upgrade e incidentes. Quarenta consultas locais, com cache e embeddings sintéticos, não demonstram suporte a 100 workflows ativos ou um milhão de documentos.
7. Implementação dos contratos organizacionais completos: Chief of Staff, Adaptive Controller A0–A4, equipes dinâmicas por capacidade, permanentes mediante aprovação, temporários dentro de política, observabilidade de decisões e interface JARVIS funcional. Não trocar isso por dois agentes fixos da fixture nem reimplementar control planes inteiros.

## Efeito prático da decisão

**GO para implementação de um piloto de produto restrito, com dados sintéticos e ações simuladas; NO-GO para dados empresariais confidenciais ou efeitos reais nesta versão.** O próximo trabalho é implementar/qualificar os itens acima na instalação alvo. As evidências atuais permitem investir na arquitetura sem uma troca geral de ferramentas; não permitem declarar que o produto empresarial já existe ou está pronto.

Mantidos: instalação dedicada por cliente, um cérebro persistente, camada empresarial preferencialmente TypeScript, IA/motores Python reutilizados, React/TypeScript/Three.js para JARVIS, sem NestJS obrigatório, sem Kafka/Redis/Temporal/microserviços adicionais por estética. Este diretório Python é uma bancada de qualificação isolada. Não houve publicação, deployment de produção, mensagem real ou compra de infraestrutura.

## Adendo — integração semântica nativa em 04/11/2026

A rodada posterior [semantic-integration](../semantic-integration/RESULTS.md) passou um E2E com oito checkpoints em 402,01 s, quatro documentos por geração, extração/keywords/respostas reais GPT-6.1 Terra e embeddings ONNX reais persistidos em PostgreSQL/Neo4j. Versões, citações, abstenção, incerteza causal e ACL pós-restore passaram no recorte pequeno. Isso supera a ausência de prova semântica integrada apontada acima para a bancada anterior; não transforma o benchmark pequeno em qualificação de corpus representativo ou temporalidade Graphiti. Manter LightRAG como candidato, com produção ainda NO-GO pelos demais gates. O código e os resultados anteriores permanecem históricos.

## Adendo — Graphiti e editorial

[temporal-editorial](../temporal-editorial/RESULTS.md): ensaio nativo real passou 3/7 critérios com Terra e 6/7 com Sol; ambos falharam ao reconstruir o conhecimento anterior a uma retificação. Não aprovar Graphiti como autoridade exclusiva dessa história. A camada editorial TypeScript passou dez testes/strict e a prova E2E de falha entre grafo e commit passou com conciliação sem reingestão. Vault Obsidian compatível entregue; UI do aplicativo não testada. A seleção do snapshot canônico por vigência/publicação é contrato de fontes, não homologação de fatos bitemporais do Graphiti. A arquitetura principal permanece e a produção continua NO-GO.
