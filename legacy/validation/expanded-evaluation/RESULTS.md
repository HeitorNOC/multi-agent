# Resultado — ensaio ampliado, 04/11/2026

Contratos: **PASS_CONTRACTS**; duração 352.34 s antes da limpeza. Resultado semântico: 12/12 no critério lexical de valor/abstenção. Citação/filename: 12/12, avaliados separadamente. Não é medida de acurácia empresarial ou suporte de todas as afirmações.

| Modelo / recuperação | Caso | Valor ou abstenção | Citação/arquivo |
|---|---|---|---|
| gpt-6.1-terra / mix | meal | PASS | PASS |
| gpt-6.1-terra / mix | deadline | PASS | PASS |
| gpt-6.1-terra / mix | review | PASS | PASS |
| gpt-6.1-terra / mix | unknown | PASS | PASS |
| gpt-6.1-terra / naive | meal | PASS | PASS |
| gpt-6.1-terra / naive | deadline | PASS | PASS |
| gpt-6.1-terra / naive | review | PASS | PASS |
| gpt-6.1-terra / naive | unknown | PASS | PASS |
| gpt-6.1-sol / mix_fixed_prompt | meal | PASS | PASS |
| gpt-6.1-sol / mix_fixed_prompt | deadline | PASS | PASS |
| gpt-6.1-sol / mix_fixed_prompt | review | PASS | PASS |
| gpt-6.1-sol / mix_fixed_prompt | unknown | PASS | PASS |

## Evidências operacionais

- approved_corpus_predeclared_oracles
- eight_identical_concurrent_requests_one_record
- retrieval_comparison_mix
- retrieval_comparison_naive
- sol_on_same_four_final_prompts
- crash_after_receipt_governance_reconciliation_no_regeneration
- revocation_prevents_receipt_promotion
- no_receipt_remains_fenced_without_blind_retry

Oito pedidos simultâneos iguais foram serializados por um único processo, com um registro e envelopes iguais. Isso comprova deduplicação no recorte, não oito inferências paralelas, escalabilidade empresarial ou concorrência entre réplicas. A chamada inicial também inclui ingestão; não confundir um pedido único com uma única chamada ao modelo.

Houve terminação real do processo da aplicação, não simulação de retorno HTTP. Após o recibo durável, o pedido continuou pendente até conciliação explícita por governança. A conciliação promoveu o texto original sem regenerar resposta; revogação atual impediu promover outro recibo. Verificação SQL independente durante a execução recusou UPDATE/DELETE nos recibos ao papel runtime (exit 3, permission denied; receipt-permissions.json). Sem recibo, o pedido continuou bloqueado após reinício e a conciliação recusou a retomada automática. Esse último cenário é um limite operacional observado, não recuperação concluída.

Ainda existe janela entre retorno do modelo e gravação do recibo. Não há confirmação durável do provedor que permita recompor uma saída perdida nessa janela sem nova inferência. A admissão interrompida antes do recibo permanece pendente para investigação; não foi implementado encerramento compensatório com novo ID/aprovação. Não foram testados desastre de banco, perda de disco, backup conjunto, PITR, failover ou múltiplos writers.

## Modelos, recuperação e uso

Mix e naive usaram a mesma projeção de fonte/embeddings/extração Terra; modo está no fingerprint e no registro, sem caller escolher workspace. Quatro prompts finais mix foram repetidos exatamente no Sol, com hashes iguais verificados em fixed-prompt-pairs.json. Sol não refez extração nem recuperação. Essa comparação controlada de geração não determina o melhor modelo em geral. Corpus único com distratores Aurora/Boreal, quatro perguntas, uma passagem, ordem fixa e sem testes estatísticos. As respostas completas e todos os prompts estão preservados em acceptance.json e llm-*.prompt.json; não houve reclassificação de falhas ou repetição silenciosa.

Foram 23 chamadas reais, cap 40 por instalação; tokens de uso: {"input_tokens": 308290, "cached_input_tokens": 136832, "output_tokens": 3426, "reasoning_output_tokens": 0}. Eventos de ferramentas no modelo: 0. Chamadas não equivalem a custo financeiro atribuível: esse custo continua sem medição. Latências incluem cache, ingestão inicial e ordem fixa; não servem como tabela de preço/performance entre modelos.

## Decisão

Continuar a qualificação do protótipo, **não aprovar produção**. O recibo durável fecha parte da lacuna de retomada, mas não oferece exactly-once de inferência nem recuperação para todo ponto de falha. Escolha de modelo e modo permanece condicionada a casos adicionais representativos e medição de custo. Nenhum resultado desta rodada torna Graphiti autoridade histórica ou substitui o ledger canônico.

Próximos gates: política de encerramento/revisão para admissões sem recibo; concorrência entre processos com admissão/budget transacionais; backup/restauração conjunta incluindo SQLite editorial, PostgreSQL, Neo4j, chaves e journal de revogação; corpus de múltiplas fontes com ACL, carga realista e avaliação de suporte por afirmação. LangGraph permanece único owner; Chief of Staff, A0–A4, equipes dinâmicas, SSO/TLS/cofre, sandbox integrada, conectores empresariais e JARVIS ainda exigem homologação própria. Obsidian continua editor opcional sem UI ensaiada.
