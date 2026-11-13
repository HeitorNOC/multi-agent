# Resultado — encerramento governado e recuperação conjunta

Data: 04/11/2026. **PASS** no recorte executado; 328.84 s antes da limpeza. Decisão: continuar o protótipo; produção permanece NO-GO. Não há homologação de operação empresarial ou garantia universal de recuperação.

## Checkpoints observados

- real_native_public_and_private_advice_before_disaster
- unknown_closed_without_reexecution_and_separately_authorized_replacement
- corrupt_bundle_rejected_before_live_containers_touched
- cold_restore_new_volumes_and_canonical_keys_stays_fenced_across_restart
- joint_inventory_matches_old_records_exact_and_postbackup_revocation_survives
- restored_native_index_answers_new_question
- restored_editorial_can_review_and_publish_new_version_without_mutating_old_advice

## Pedidos sem recibo

O modelo foi realmente chamado antes da terminação do processo, mas a camada própria ainda não tinha gravado recibo. Reiniciar não repetiu a inferência. Governança encerrou o pedido como resultado desconhecido com motivo/hash da evidência; replay exato do encerramento foi idempotente. Encerramento por analista, hash incorreto, repetição do ID encerrado e repetição exata por novo ID sem autorização foram recusados.

Uma segunda identidade de governança autorizou novo ID, com proprietário e entrada exatos. Outro proprietário e entrada alterada foram recusados. O novo registro preservou retry_of; o pedido anterior continuou sem resposta final. Isso permite encerrar a pendência de forma governada, sem afirmar que o pedido original não consumiu tokens. Cache nativo pode reduzir chamadas do novo pedido; não é recibo de execução do pedido original.

## Recuperação conjunta

Foi produzido bundle frio coordenado com três dumps PG/roles, dump Neo4j offline, SQLite editorial, Vault, estado da aplicação e chaves editorial/journal cifradas. Conteúdo canônico adulterado e manifest adulterado foram recusados antes de tocar os containers ativos. O cenário planejado de arquivo canônico ausente não foi executado separadamente; a verificação de inventário de arquivos existe, mas não se declara essa cobertura negativa.

O restore usou volumes PG/Neo4j novos e novos caminhos para SQLite/Vault. As chaves corretas foram recuperadas do envelope AES-GCM depois de os valores em memória terem sido substituídos por valores errados. API permaneceu bloqueada até conferência explícita por governança; reiniciar não removeu o gate. Truncamento do journal retido e adulteração de uma linha de fonte restaurada impediram a abertura. Após devolver os bytes/dados corretos da fixture, os inventários coincidiram e a abertura foi permitida.

A leitura/repetição dos registros originais e do substituto retornou os mesmos envelopes/hashes sem novas chamadas de modelo; ID encerrado continuou encerrado. Revogação financeira posterior ao backup foi reaplicada e impediu leitura pelo antigo autorizado; governança com grant atual leu o registro original. Consulta inédita respondeu Horizonte com a fonte v1 pelo índice nativo restaurado. Nova revisão/publicação editorial funcionou com a chave e Vault restaurados, mantendo o assessoramento antigo intacto.

**Achado negativo na inspeção da resposta:** o texto acertou Horizonte, porém acrescentou que a fonte não informa vigência e não seria possível confirmar aplicação em 1º de fevereiro. O snapshot editorial canônico tem valid_at=2026-01-01, enquanto o corpo da nota não repete essa data; a API passa a data consultada, mas não explicita todo o metadado canônico no contexto de geração. Essa ressalva evidencia integração insuficiente entre a proveniência estruturada e a resposta natural. O assert da consulta inédita verifica nome e arquivo, portanto o PASS operacional não cobre esse problema semântico. Resposta integral preservada em decisions.json; não houve ajuste do grader ou nova tentativa para ocultá-la. É necessário um ensaio específico com vigência somente no metadado, sem inferência de datas pelo modelo.

O inventário compara registros da camada própria, todas as linhas das tabelas públicas de conhecimento PG, SQLite e nós/arestas/propriedades Neo4j. Grants restaurados são conferidos contra grants do backup menos revogações posteriores. Isso cobre o conjunto e sequência da fixture, não alteração concorrente por múltiplos writers.

## Uso e limites que mantêm produção bloqueada

Foram 10 invocações reais Terra nesta execução, cap 40 por instalação, com uso reportado pelo CLI: {"input_tokens": 129920, "cached_input_tokens": 86528, "output_tokens": 1157, "reasoning_output_tokens": 27}. Eventos de ferramentas: 0. Custo monetário atribuível continua sem medição. Logs integrais, prompts e respostas estão no pacote; chaves/dumps privados estão fora dele.

- KEK e credenciais de infraestrutura retidas no harness; não se simulou perda total do host/KMS. Journal/anchor são arquivos separados no mesmo host, não autoridade inviolável ou DR independente. Falha entre append e anchor bloqueia e precisa de procedimento próprio.
- Sem PITR/HA ou múltiplas instâncias concorrentes. Contador em arquivo, locks locais e admissão ainda não são distribuídos/transacionais entre processos. Não se demonstrou exatamente uma inferência em todo ponto de falha.
- O backup é internamente coerente no cenário testado. Não houve novos documentos, decisões, closures ou autorizações depois dele e antes do restore; só revogação. O contrato ainda precisa incorporar high-watermarks externos que impeçam servir um conjunto coerente porém antigo, preservar efeitos posteriores perdidos e respeitar os gates de frescor anteriores. Uma autorização de recuperação local não substitui essa autoridade de atualidade.
- Testes não executaram pagamentos/mensagens, conectores reais ou controlador completo. Chief of Staff, A0–A4, equipes dinâmicas, LangGraph integrado ao produto, sandbox/gateway, SSO humano/TLS/cofre, escala/corpus empresarial e JARVIS continuam gates próprios. Obsidian é editor opcional, UI ainda não testada.
- Controls/API Python são bancada de qualificação, não mudança da arquitetura empresarial TypeScript. Sua implementação TypeScript e integração ao único owner LangGraph ainda precisam ser qualificadas. O editorial TypeScript real foi preservado; não se aprovou outro motor de workflow.
- Sol e outros modos não foram comparados de novo; a rodada anterior continua a evidência delimitada. Graphiti continua sem aprovação como autoridade histórica exclusiva.

## Próximo gate recomendado

Qualificar primeiro a apresentação da vigência canônica quando ela só existe em metadados, preservando a seleção de fonte feita pelo backend. Integrar também a autoridade de atualidade e o histórico pós-backup à recuperação: um restore de geração antiga deve ficar bloqueado se houver publicação, decisão ou aprovação posterior não recuperada. Depois, qualificar admissão e orçamento entre dois processos, incluindo falhas durante leases/commit. Preservar os requisitos do dossiê e LangGraph como único owner; não adicionar um segundo motor de workflow para resolver o gate.
