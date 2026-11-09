# LangGraph + TypeScript + autoridade assinada — 04/11/2026

**Decisão: continuar a qualificação desta arquitetura. Produção permanece NO-GO.** Agora há um ensaio integrado entre workflow LangGraph, regras empresariais TypeScript, fontes aprovadas, orçamento retido e restauração. É uma prova pequena e determinística, anterior a um piloto empresarial.

## O que foi integrado

- LangGraph continua sendo a única autoridade de workflow. A API TypeScript aplica identidade/ACL, aprovação, orçamento e recibos; a autoridade externa de bancada registra intenções e emite provas, sem planejar nem agendar agentes.
- Reaproveitada `concurrent-reconciliation/freshness_authority.py`, ampliada para reservar integralmente unidades de um trabalho com vínculo ao input e idempotência. O armazenamento e a chave Ed25519 ficam fora do conjunto de backup do cliente.
- TypeScript verifica assinatura, instalação, nonce, prazo e completude do histórico. Recibos associam cada operação ao inventário local posterior. Histórico antigo, recibo divergente ou conteúdo local adulterado impedem abertura.
- Publicação editorial existente passou pela fronteira assinada: submissão de versão 2, revisão por outra identidade e commit canônico. Snapshots originais e resultado anterior foram preservados.
- Backup controlado inclui ledger empresarial, editorial, Vault e schema `runtime` do PostgreSQL. A restauração final usou outro contêiner e outro volume PostgreSQL e retomou um checkpoint real de aprovação em processo novo.

O conhecimento desta prova é **canônico, sem nova projeção LightRAG/Graphiti**. Não se afirmou restauração conjunta do cérebro semântico, nem se transferiram os PASS anteriores desses índices para a nova integração.

## Resultados executados

| Prova | Resultado e alcance |
|---|---|
| Integração assinada | **1 E2E PASS, 10 checkpoints, 21,43 s pelo pytest**. Tempo interno: 18,85 s. Não são dez testes independentes. |
| Orçamento Python | **3 testes PASS**: reserva de trabalho atômica por thread, vínculo ao input, teto retido após restart; regressões existentes de reserva por chamada e encerramento unknown preservadas. |
| Testes Node | **16 PASS**: quatro de assinatura/interoperabilidade e doze do editorial/leitura concorrente. |
| TypeScript strict | PASS nos módulos alterados e teste da prova assinada. |
| Fluxo anterior sem autoridade opcional | **1 E2E PASS, 25,60 s**: regressão das duas janelas de queda, ACL, fencing e concorrência anteriores. Essa rodada precedeu apenas o acréscimo dirigido de vínculo de `request_id`, coberto pela integração assinada final. |

[JUnit assinado](signed-final.xml), [log](signed-final.log), [resultado estruturado](evidence/results.json), [regressão anterior](baseline-regression.xml), [orçamento](budget-final.xml), [Node](node-final.log).

## Critérios demonstrados

1. **Prova real entre linguagens:** Python assina; TypeScript aceita a prova válida e recusa adulteração, nonce incorreto, outra instalação e expiração. O transporte preserva os bytes canônicos assinados e da lista de operações, cobrindo também Unicode e número `1.0` que JSON em JavaScript normaliza para `1`.
2. **Retry vinculado ao pedido:** mesmo `request_id` e conteúdo devolvem o resultado original sem nova reserva; conteúdo diferente com o mesmo ID é recusado antes de reservar. Isso evita transformar colisão de ID em intenção externa pendente.
3. **Execução aprovada:** dois especialistas, pausa LangGraph, aprovação exata e efeito externo sintético com recibo durável.
4. **Atualização e revogação:** versão 2 publicada por duas identidades e revogação retida. Resposta antiga não é regenerada; leitura continua submetida à ACL atual.
5. **Backup antigo:** g1 anterior à aprovação/publicação/revogação foi recusado contra a autoridade mais adiantada. Não foi feita liberação por override.
6. **Adulteração:** zerar `spent/reserved` localmente e editar o texto de uma fonte publicada foram recusados pelo inventário vinculado ao recibo retido.
7. **Restauração nova:** g2 abriu em PostgreSQL/volume novos; resultado original permaneceu igual, revogação permaneceu ativa, checkpoint público de aprovação retomou e uma consulta nova selecionou a fonte v2.
8. **Indisponibilidade:** autoridade parada bloqueou operações; restart preservou o orçamento. Não há fallback para orçamento local desprotegido.
9. **Concorrência:** oito admissões por duas APIs com orçamento externo de 12 unidades; após oito unidades já reservadas, **uma admissão de três unidades e sete recusas 429**, total retido 11/12. Dois recibos externos únicos, um `send` por intenção.
10. **Intenção incompleta:** queda deliberada após reserva/intenção externa, antes do commit local, reteve a última unidade (**12/12**) e bloqueou reabertura. O estado final tem uma intenção pendente, não um resultado bem-sucedido ou gasto zero.

O provedor sintético oferece idempotência e consulta consistente por intenção. Isso não demonstra exatamente uma execução em qualquer serviço externo. O teto é de **unidades sintéticas por etapa**, não tokens ou moeda; custo monetário continua sem medição.

## Versões e recuperação do ambiente

LangGraph `1.2.19` no SHA `3c916d750575b22c464790e9774494d810ccd322`, checkpoint `4.3.1`, checkpoint-postgres `3.2.0`, Python `3.12.14`, Node `24.20.0`. PostgreSQL por digest `sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`. Nenhum diff no vendor LangGraph.

Primeiros testes da autoridade falharam ao criar temporários no diretório de sandbox; repetição com `--basetemp` no workspace passou. A primeira tentativa integrada parou antes de provisionar porque Docker estava desligado. Docker Desktop foi iniciado no perfil do usuário e o ensaio foi repetido. Esses negativos de ambiente continuam em `budget.log/xml` e `signed-attempt-1.log/xml`; não foram falhas funcionais atribuídas à arquitetura.

Rodadas intermediárias PASS foram preservadas antes das ampliações de checkpoint/idempotência. Credenciais efêmeras não foram exportadas. As chaves públicas e provas finais foram exportadas para verificação; a chave privada da autoridade não integra o backup nem os artefatos públicos.

## O que impede consolidar para produção

- **Intenções pendentes:** o bloqueio foi comprovado; resolução governada por duas identidades, conciliação completa e devolução segura de saldo ainda precisam entrar nesta camada TypeScript. Sem isso, uma falha pode parar a instalação.
- **Disponibilidade e desempenho:** esta implementação serializa commits retidos entre APIs e verifica inventários/histórico completos. É uma escolha de bancada para consistência, não uma solução dimensionada para grande empresa. TTLs de locks/leases, renovação e pausas longas precisam de testes próprios. Não se mediu throughput nem SLO empresarial.
- **Autoridade e confiança:** serviço separado, mas no mesmo host, sem KMS, TLS, HA, DR ou durabilidade de chave após perda do host. A autoridade usa um processo/lock de bancada; não houve homologação de réplicas. Nonces mitigam replay de provas e não substituem autenticação empresarial.
- **Backups:** parada controlada, cópia SQLite e dump lógico do schema de checkpoints; sem PITR, failover, backup online consistente ou medição de RPO/RTO. Manifest de backup é registro de captura, não assinatura independente do backup. O gate assinado verifica o conjunto local coberto; não certifica todo conteúdo interno do dump PostgreSQL contra adulteração.
- **Cérebro completo:** falta unir a mesma recuperação aos índices semânticos, embeddings, conectores e todas as propostas/editorias anteriores. Vault é editor opcional; não se tornou autoridade de publicação.
- **Cognição e produto:** Chief of Staff real, controlador A4, qualidade com corpus empresarial, ferramentas reais, sandbox, SSO/cofre, atualização e custo real seguem abertos. Não houve inferência: **zero chamadas a modelos nesta rodada**.

Portanto, a **direção arquitetural está mais sustentada**, especialmente nas fronteiras operacionais, mas a arquitetura de produção não está congelada nem aprovada. Próximo gate: conciliação das intenções retidas e recuperação do cérebro completo; depois qualidade/custo do planejamento real sobre o mesmo contrato.
