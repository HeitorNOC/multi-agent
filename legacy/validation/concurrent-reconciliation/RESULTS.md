# Conciliação e concorrência — 04/11/2026

**E2E: PASS**, 202.22 s antes da limpeza; console pytest 205,23 s incluindo limpeza. Oito checkpoints passaram. Dois unitários de autoridade e typecheck strict passaram. Correção adicional de replay editorial depois do E2E: três regressões isoladas passaram; não se repetiu o E2E completo após essa mudança de ordem da checagem de grant. **Continuar o protótipo; produção permanece NO-GO.**

## Evidências observadas

- two_api_processes_and_editorial_grant_revocation_enforced
- eight_identical_requests_across_two_processes_one_admission_and_result
- distinct_requests_from_both_api_processes_complete_without_call_id_collision
- governance_reconciles_after_fresh_receipt_without_model_or_changed_response
- governance_reconciles_after_receipt_without_model_or_changed_response
- two_governance_identities_close_unknown_intent_without_success_or_reexecution
- two_process_reservation_race_twenty_requests_exactly_seven_admitted
- authority_and_both_clients_restart_preserve_limits_tombstone_and_original_results

**Duas APIs reais.** Oito pedidos iguais foram enviados alternadamente a dois processos com PIDs distintos. Retornaram envelopes idênticos, com uma única admission e decisão. Pedidos diferentes também concluíram pelas duas APIs; logs de inferência mostram 3 IDs de instância ao longo do ensaio/reinícios. Todos os 13 IDs globais de chamada foram únicos e contínuos. O mecanismo é exclusão PG por instalação: não é demonstração de throughput empresarial nem inferências de negócio paralelas.

**Conciliação com recibo.** As falhas reais depois do recibo empresarial e depois do recibo de atualidade foram recuperadas por governança, com grants atuais do operador e proprietário. A réplica sobrevivente reconheceu a pendência e bloqueou a repetição. A recuperação reutilizou bytes/hash do recibo original, recompôs o registro quando necessário e confirmou a mesma operação na autoridade. Não houve inferência adicional para conciliar ou reler; replay da conciliação permaneceu seguro.

**Sem recibo.** Queda depois da intenção, antes da admission, manteve resultado desconhecido. Reconciliação automática recusada. Houve proposta com evidência/motivo e confirmação por segunda identidade board autorizada; autor da proposta, analista e board com grant revogado foram recusados nos caminhos inadequados. O resultado ficou explicitamente closed_unknown, sem resposta final inventada nem mudança para sucesso. Tombstone bloqueou o ID original e o mesmo fingerprint com outro ID. Serviço reabriu após confirmação consistente. Retry exato do encerramento retornou o mesmo resultado. Não existe ainda substituição autorizada automática para esse tipo de intenção sem admission; reformulações semânticas não são deduplicadas por fingerprint.

**Reservas atômicas.** Dois processos OS independentes disputaram 20 reservas sem executar modelos no escopo stress. Foram admitidas 7 (distribuição [4, 3]), numeradas 1–7, e 13 foram recusadas. Retry com ID já reservado retornou o mesmo número sem consumir outra vaga. A autoridade e ambas as APIs reiniciaram, mantendo stress=7 e model=13; respostas antigas e tombstone permaneceram. Os limites foram definidos no servidor, não pelo caller. SQLite/serviço central único não equivalem a autoridade em HA.

**ACL editorial.** Revogação anterior à primeira review/publicação foi respeitada no E2E; não criou intenção de aprovação negada. Uma revisão final encontrou que o replay de publicação já concluída retornava antes de allowed(). Teste isolado executando o corpo real da rota demonstrou dois failures/um pass; foi movida a checagem para antes do retorno idempotente e os três testes passaram. Source pré-correção, falhas e resultados verdes estão preservados. A mudança não altera as rotas de conciliação/budget ensaiadas. Não se repetiu o E2E completo depois desse ajuste; isso não homologa revogação em todas as janelas de commit.

## Uso e interpretação

Foram 13 execuções reais Codex Terra, cap 40 de reservas no escopo model. Tokens reportados: {"input_tokens": 165540, "cached_input_tokens": 84224, "output_tokens": 1359, "reasoning_output_tokens": 0}. Eventos de ferramentas: 0. Provas Ed25519 verificadas offline: 132. Nenhum gasto monetário atribuível foi medido. Reserva conta tentativa CLI; pode haver consumo incerto se o cliente morrer antes/depois do spawn. Não há refund automático, exactly-once de inferência ou equivalência entre chamada CLI, request HTTP interno, tokens e custo.

As respostas de assessoramento são sintéticas e estão preservadas em decisions.json. Este não foi novo benchmark semântico, de modelos ou de citações; o foco é protocolo operacional, concorrência e orçamento. Não se requalifica a acurácia geral por preservar uma saída. O resultado anterior do grader temporal e sua revisão offline continuam preservados no diretório anterior.

## Limites que ainda bloqueiam produção

- PG serializa o trabalho de negócio de toda a instalação. Não houve carga/corpus empresarial, fairness, cancelamento durante inferência, queda do banco com sessão perdida, partição de rede ou lock mantido por sessão travada. Não foi testado um modelo de leases/fencing com execução concorrente de múltiplas tarefas.
- Conciliação qualificada apenas para decisões nas três janelas testadas. Intenções editoriais/closure/substituição e todas as combinações de revogação, commit e ACK ainda exigem teste. Reabertura não pode ignorar joint_restore; essa combinação precisa ser novamente exercitada.
- Esta versão acrescenta contexto/outcome na autoridade, tabelas de proposta/tombstone/auditoria e orçamento retido. Restore conjunto desta versão não foi refeito. Inventário, migração e recuperação precisam cobrir os novos estados e impedir ressuscitar IDs fechados ou zerar reservas. Resultados de restore anteriores não se transferem automaticamente.
- Autoridade no mesmo host, chave privada retida em memória do harness para o restart, sem KMS/DR externo, HA ou proteção contra rollback da própria autoridade/DBA comprometido. Journal de revogação em arquivo não foi substituído por serviço distribuído; caminhos que não participam dos locks não têm a mesma garantia.
- Controles Python são bancada; camada empresarial final TypeScript e integração a LangGraph permanecem gates. Editorial e proveniência TypeScript são reais. Instalação dedicada, cérebro central, LangGraph único owner, equipes por capacidades, Chief of Staff e A0–A4 são requisitos mantidos, não homologação do produto completo. Sandbox/gateway, SSO/TLS/cofre, conectores e JARVIS continuam pendentes; Obsidian opcional sem UI ensaiada. Graphiti não é autoridade histórica exclusiva.

**Próximo gate:** consolidar restauração/atualização desta versão com dois processos, incluindo reservas e tombstones retidos, e depois medir carga representativa com limites de custo reais. Completar a camada empresarial TypeScript e o controlador, sem introduzir segundo motor de workflow. Nenhuma ferramenta está aprovada por antecipação.
