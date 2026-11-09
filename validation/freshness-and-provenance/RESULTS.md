# Atualidade e proveniência temporal — resultado de 04/11/2026

**E2E original: FAIL_SEMANTIC**, 473.42 s antes da limpeza. Os cinco checkpoints operacionais: **PASS**. O grader original marcou 1/4; a revisão do critério de início/fim, aplicada offline às mesmas saídas, marcou **4/4**, sem nova inferência. O E2E completo não foi repetido após corrigir o grader. Produção continua NO-GO; a evidência permite continuar a qualificação do protótipo.

Passaram dois unitários de segurança Python, oito regressões do grader, quatro checks de saídas já gravadas, dois testes TypeScript e typecheck strict.

## Checkpoints

- metadata_only_validity_and_caller_cannot_override_backend
- source_approval_publication_and_decisions_advance_retained_authority
- coherent_old_backup_denied_for_missing_postbackup_operations
- latest_complete_bundle_opens_and_exact_old_advice_needs_no_model
- unconfirmed_authority_intent_stays_fenced_after_restart_without_inference

## Respostas preservadas

**v1_validity_only_metadata** — checks originais: {"project": true, "valid_from": true, "no_missing_date_claim": false, "source_version": true, "basis_dates": true, "citation": true, "hash": true}; no_missing_date_claim revisado: True

O projeto de expansão se chama **Horizonte**. [1]

A versão selecionada da fonte está vigente desde **1º de janeiro de 2026**. Ela foi publicada em 4 de novembro de 2026; não há informação sobre o fim de sua vigência.

### References

* [1] politica-remoto@v1.md

**v2_validity_only_metadata** — checks originais: {"project": true, "valid_from": true, "no_missing_date_claim": true, "source_version": true, "basis_dates": true, "citation": true, "hash": true}; no_missing_date_claim revisado: True

O projeto de expansão da equipe Aurora chama-se **Solstício**. [1]

A versão selecionada está vigente desde **1º de março de 2026**. Ela foi publicada em 4 de novembro de 2026; não foi informada uma data de fim de vigência. [1]

### References

* [1] politica-remoto@v2.md

**historical_knowledge_cutoff** — checks originais: {"project": true, "valid_from": true, "no_missing_date_claim": false, "source_version": true, "basis_dates": true, "citation": true, "hash": true}; no_missing_date_claim revisado: True

O projeto de expansão chama-se **Horizonte**. [1]

A versão selecionada está vigente desde **1º de janeiro de 2026**. Ela foi publicada em 4 de novembro de 2026; não há data de fim de vigência informada. [1]

### References

* [1] politica-remoto@v1.md

**new_after_latest_restore** — checks originais: {"project": true, "valid_from": true, "no_missing_date_claim": false, "source_version": true, "basis_dates": true, "citation": true, "hash": true}; no_missing_date_claim revisado: True

O projeto de expansão da equipe Aurora chama-se **Solstício**. [1]

A versão selecionada está vigente desde **1º de março de 2026**, conforme os metadados canônicos. Sua publicação ocorreu em 4 de novembro de 2026. Não há informação sobre o fim da vigência.

### References

* [1] politica-remoto@v2.md

## O que mudou e o que o ensaio cobre

O backend continua selecionando a fonte aprovada por vigência/conhecimento. O contrato TypeScript valida conteúdo e cortes, separa vigência inicial de publicação e fornece os metadados explicitamente à geração. Não há datas no corpo das duas notas da fixture. A API registra canonical_basis junto com a resposta original e não aceita valid_from escolhido pelo caller. Isso trata o problema observado na rodada anterior sem editar suas respostas/evidências nem pedir ao modelo que determine validade ou permissões.

Um atributo não informado (tamanho da equipe) continuou sem valor factual. O grader verifica projeto, data, seleção/versão, citação e ausência da ressalva de data canônica ausente; não é uma medida estatística, entailment por todas as afirmações ou garantia geral de qualidade. Os quatro casos e prompts são públicos nesta fixture e podem não representar dados empresariais.

**Falha do avaliador preservada:** o regex original confundiu “não há informação sobre o fim da vigência” com ausência de início. Três respostas explicitavam o início correto e a publicação, mas receberam falso negativo. O arquivo acceptance.json, o JUnit, console e o teste original em evidence/test-integrated-original.py.txt continuam intactos. O novo grader foi testado contra oito exemplos positivos/negativos, incluindo a frase problemática da rodada anterior e ausência de início/fim juntos; a revisão pós-hoc das quatro saídas está em acceptance-revised.json com hashes das respostas. Não se trata de benchmark independente nem de repetição do E2E; a correção foi aplicada ao teste para execuções futuras.

A autoridade retida registra intenção antes da mutação e confirmação após recibo local. Provas Ed25519 vinculam nonce, tempo, instalação e inventário completo de operações. A API tem chave pública, não a privada de assinatura. Os unitários recusaram prova repetida com nonce errado, instalação errada, prova expirada/adulterada e reuso de ID com outra entrada/resultado. Dois erros de preparação de tmp_path foram preservados e resolvidos com diretório próprio; não foram falhas do contrato nem consumiram inferência.

No restore antigo g1, o bundle ainda era coerente internamente, porém não continha as aprovações/publicação/decisões posteriores confirmadas pela autoridade. O gate recusou a abertura e a leitura de respostas, inclusive após restart, sem novas chamadas de modelo. Não houve override para aceitar perda de dados. O restore g2, atual naquele checkpoint e com inventário conjunto coincidente, pôde ser aberto por governança; leituras/replays antigos retornaram os mesmos registros sem modelo. Consulta inédita depois do restore exerceu novamente o índice/geração.

A falha final ocorreu depois de a autoridade gravar intenção e antes de haver admissão/recibo local. Reiniciar deixou a aplicação bloqueada e nenhum modelo foi chamado para tentar resolver a incerteza. Isso demonstra fence conservador, não recuperação/alta disponibilidade desse caso. Não foi implementada conciliação/encerramento da intenção abandonada. A autoridade retém testemunho/digests, não cópia dos dados perdida capaz de restaurá-los.

## Limites e decisão

- Autoridade em processo/SQLite separado no mesmo host, fora dos bundles. Não prova DR externo, KMS, inviolabilidade ou resistência ao rollback da própria autoridade. Canal loopback/HMAC, relógio local; não SSO/TLS empresarial.
- Não há transação distribuída. Hooks para closure, autorização de substituto e conciliação existem, mas não foram exercitados neste E2E; a cobertura anterior dessas funções não se transfere automaticamente à combinação nova.
- Nenhum conector externo real forneceu inventário de documentos. A atualidade testada é a dos eventos próprios instrumentados. Caminhos não instrumentados ou edições diretas privilegiadas não são cobertos. Drafts não aprovados não têm recuperação de alta prioridade comprovada.
- Locks, contador de chamadas e API são de um processo. Admissão, orçamento, leases/limites concorrentes, crash durante inferência, PITR/HA, corpus e carga empresariais continuam gates.
- Controles Python são bancada. Mantêm-se camada empresarial TypeScript, motores Python, cérebro central, instalação dedicada, LangGraph como único owner, Chief of Staff, A0–A4, equipes por capacidades e JARVIS como requisitos ainda não homologados integralmente. Editorial e novo contrato de proveniência são TypeScript reais. Obsidian continua opcional sem UI testada; Graphiti não é aprovado como autoridade histórica exclusiva.

**Decisão:** continuar o protótipo; não liberar produção. O próximo gate é conciliar intenções e commits interrompidos sem duplicação, e qualificar admissão/orçamento entre dois processos. A implantação real da autoridade e a recuperação de dados posteriores perdidos exigem desenho/teste próprios. Não houve troca antecipada do motor nem aprovação geral de modelo/arquitetura.

Uso desta execução: 12 chamadas Terra, cap 40; {"input_tokens": 153536, "cached_input_tokens": 81920, "output_tokens": 1274, "reasoning_output_tokens": 0}. Provas offline verificadas: 39; eventos de ferramentas do modelo: 0. Custo monetário atribuível continua sem medição.

Falha preservada: ver acceptance e console
