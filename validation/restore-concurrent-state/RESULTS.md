# Restore coordenado do estado concorrente — 04/11/2026

**Resultado E2E: PASS**, 478.98 s antes da limpeza. Quatro testes unitários de pisos de quota passaram. Decisão: continuar qualificação do protótipo; **produção permanece NO-GO**.

## Checkpoints executados

- freeze_drains_accepted_work_and_blocks_both_api_writers_and_revocation
- latest_bundle_covers_proposal_tombstone_reconciliation_and_rejects_implicit_legacy_upgrade
- old_bundle_cannot_resurrect_unknown_intent_or_override_joint_restore_with_thaw
- tampering_tombstone_proposal_or_reconciliation_audit_prevents_opening
- counter_rollback_is_denied_even_when_operation_head_matches
- both_restored_apis_preserve_exact_records_closed_id_postbackup_revocation_and_full_quota
- eight_requests_on_restored_native_index_make_one_new_record_without_call_id_reuse

## O que este ensaio acrescentou

**Backup de todas as APIs.** O código herdado só parava a API principal e não cobria as tabelas novas no inventário. O procedimento novo esperou o pedido admitido finalizar, persistiu um gate de backup e recusou novas operações/revogação em ambas as APIs. Só depois parou todos os processos e serviços para a captura fria. Após reinício/thaw normal, a resposta que estava em andamento foi relida exatamente. A pausa é privada da bancada, depois da geração e antes do recibo; não simula cancelamento do modelo em execução.

**Estados novos realmente presentes.** Depois de g1, uma intenção sem admission foi encerrada unknown por duas identidades; outra decisão com recibo foi conciliada. G2 contém proposta, tombstone e auditoria, além dos registros e metadados anteriores. O formato/fingerprint dos fontes críticos é verificado antes de tocar containers. Um manifest de formato antigo, corretamente assinado pela fixture, foi recusado: isso é rejeição de compatibilidade implícita, não migração real qualificada.

**Restore antigo.** G1 foi carregado em volumes/caminhos novos e ficou bloqueado nas duas APIs por faltar estado posterior atestado pela autoridade. O pedido encerrado não pôde ser reexecutado nesse ambiente, e thaw com token antigo não abriu joint_restore. Não houve nova inferência nessas tentativas.

**Restore completo.** G2 restaurou editorial/Vault/estado, três bancos PG/roles, grafo e chaves da camada. Alterações isoladas no tombstone, proposta e auditoria impediram a abertura; a reposição exata das linhas da fixture permitiu seguir. Essas tabelas agora participam da comparação lógica, não apenas do dump.

**Quotas independentes da atualidade dos dados.** A autoridade teve apenas seus contadores apagados na simulação, preservando operações. As APIs verificaram head coincidente, mas recusaram abrir porque os números ficaram abaixo dos pisos assinados do backup. A autoridade foi parada e reparada pela cópia privada anterior da fixture. Não se afirma recuperação empresarial de uma autoridade comprometida ou host perdido.

Com os dados corretos, ambas as APIs abriram e devolveram os mesmos envelopes/hashes de respostas originais e conciliadas. O ID unknown continuou bloqueado; revogação posterior ao backup continuou impedindo o usuário financeiro de ler seu registro, enquanto governança autorizada leu o mesmo original. Quota stress permaneceu esgotada. A reserva model sem CLI permaneceu consumida. Oito solicitações iguais alternadas entre as APIs restauradas geraram uma única decisão nova e consultaram o índice nativo, respondendo Horizonte e dois dias remotos.

## Uso observado

9 execuções CLI Codex Terra reais e 10 reservas model retidas, das quais 1 foi deliberadamente consumida sem iniciar modelo. IDs de vaga sem CLI: [8]. Isso é consumo conservador de tentativa, sem refund automático, não dinheiro gasto. A quota stress=7 refere-se só a reservas sintéticas, sem modelos. Cap model=40 por instalação.

Tokens reportados pelo CLI: {"input_tokens": 115841, "cached_input_tokens": 70528, "output_tokens": 959, "reasoning_output_tokens": 0}. Eventos de ferramenta: 0. Provas assinadas verificadas offline: 136. O custo monetário atribuível continua sem medição. Não há nova comparação de modelos nem avaliação estatística de semântica/enterprise throughput.

## Limites e decisão

- Este é um backup frio com todos os writers conhecidos participando do protocolo. Não prova snapshots online, transação distribuída, escritores privilegiados que ignorem o gate, edição externa de Vault durante captura ou carga empresarial. Exclusão global serializa trabalho de negócio; não é arquitetura paralela/fairness já homologada.
- Formato/fingerprint recusam combinações não qualificadas. Não houve upgrade/migração de produção real, teste de rollback de versão, crash em cada etapa de DDL ou compatibilidade com toda versão anterior. Esquema e políticas completas de integridade ainda precisam de revisão.
- A proteção de quota detecta perda abaixo do piso conhecido. Não protege contra rollback da autoridade acima desse piso, perda de consumo posterior sem testemunho, administradores comprometidos, KMS/DR real ou mudança de relógio. Autoridade e journal continuam no mesmo host; KEKs/credenciais/chave privada retidas no harness. Não houve perda total do host/HA/PITR.
- A reconstituição de dados posteriores foi feita por g2 completo existente. A autoridade guarda testemunho/digests, não conteúdo suficiente para recuperar dados perdidos quando não houver backup/log válido. Outras intenções, substitutos sem admission e combinações de grants/commits ainda exigem testes.
- Camada empresarial TypeScript e LangGraph único owner continuam requisitos, não substituídos pelo controle Python da bancada. Editorial/proveniência TypeScript reais foram preservados. Chief of Staff, A0–A4, equipes por capacidades, sandbox/gateway, SSO/TLS/cofre, conectores e JARVIS completos continuam gates; instalação dedicada e cérebro central lógico mantidos. Obsidian é editor opcional, UI não ensaiada; Graphiti não é autoridade histórica exclusiva.

**Próxima etapa recomendada:** medir carga/corpus representativos com critérios e orçamento explícitos, incluindo latência, filas, erro e custo observado; consolidar o caminho empresarial TypeScript e owner LangGraph. Até lá, o resultado justifica continuar o protótipo e não liberar produção. Não trocar nem aprovar ferramentas por antecipação.
