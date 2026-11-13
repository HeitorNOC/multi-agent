# Atualidade e proveniência temporal — 04/11/2026

Continua operational-recovery sem alterar seus resultados. Instalação dedicada de bancada, dados sintéticos, serviços reais e LightRAG nativo. Modelos não selecionam permissões, validade ou versão. A seleção canônica continua no editorial TypeScript; `provenance.ts` valida conteúdo/cortes e separa valid_from de published_at, fornecendo contexto estruturado à geração. Não se inserem fatos/arestas/respostas manualmente no motor.

## Contratos

Quatro casos temporais pré-definidos usam notas cujo corpo não repete datas: v1/Horizonte desde 01/01, v2/Solstício desde 01/03, consulta com corte de conhecimento anterior à v2 e consulta inédita após restore atual. O grader verifica projeto, início da versão, arquivo/citação, seleção/cortes e ausência de ressalva de vigência ausente. Um atributo de tamanho da equipe não informado deve permanecer sem resposta factual. Datas não autorizam inferir fim de vigência ou a data de cada fato extraído.

`freshness_authority.py` é uma autoridade de bancada em processo/SQLite próprios, fora dos bundles e não restaurada junto com os dados do cliente. Usa chave Ed25519 privada que não é enviada à API; API recebe só chave pública e credencial HMAC do canal local. Provas incluem nonce por consulta, timestamp, instalação, sequência completa e digest. Chave pública e provas reais são entregues nas evidências; nenhuma chave privada/credencial é incluída.

Operações rastreadas têm intenção durável anterior ao commit local e recibo local anterior à confirmação na autoridade. Callers não podem escolher a autoridade/head/recibo. Revisão editorial possui preflight TypeScript antes da intenção. Publicação, decisão, closure, autorização de substituto e conciliação têm hooks; o E2E desta rodada exercita aprovação editorial, publicação e decisão. Hooks adicionais não devem ser considerados homologados automaticamente. Reads/replays concluídos não criam nova operação nem inferência.

Não há transação distribuída. Queda antes do recibo ou confirmação deixa intenção pendente; restart bloqueia. Não existe nesta rodada endpoint para apagar intenção/forçar abertura ou reconciliar uma intenção abandonada. É um gate conservador, com limite de disponibilidade explícito. A prova de atualidade não contém o conteúdo suficiente para restaurar dados perdidos: é uma testemunha para recusar rollback silencioso.

O gate de restore exige simultaneamente: inventários coerentes do bundle frio, journal de revogações retido válido e correspondência exata dos recibos locais com operações confirmadas da autoridade ao vivo. Bundle g1 pode ser internamente coerente e ainda ser recusado por faltarem aprovação/publicação/decisões de g2. Bundle g2 só é atual no checkpoint em que a autoridade ainda coincide; operações posteriores exigem nova recuperação/backup.

## Limites arquiteturais e operacionais

Esta autoridade é independente do rollback da fixture, mas continua no mesmo host, com KEK/credenciais em memória do harness. Não prova armazenamento inviolável, KMS, DR entre hosts, proteção contra administrador comprometido, frescor de conectores externos ou resistência ao rollback da própria autoridade. Tempo depende do relógio local e janela de 30 s. Canal HTTP loopback com HMAC não é SSO/TLS empresarial.

Os controles Python são bancada para testar contratos. O requisito de camada empresarial TypeScript permanece; o novo contrato de proveniência é TypeScript real, o editorial também. A implementação completa de controle/orçamento e integração ao único owner LangGraph ainda exige qualificação. Não se acrescenta outro workflow owner ou um serviço obrigatório ao produto por estética; a autoridade representa o requisito de estado retido fora da unidade restaurada. Escolher seu armazenamento/implantação real segue aberto.

Preservados cérebro lógico central, instalação dedicada, equipes por capacidades, Chief of Staff e Adaptive Controller A0–A4. Esses componentes completos, sandbox integrada, conectores, carga/corpus empresarial, PITR/HA e JARVIS não são homologados aqui. Obsidian continua editor opcional sem UI ensaiada; Graphiti não vira autoridade histórica exclusiva. Não foram enviados pagamentos/mensagens nem expostos segredos.

## Execução

Python fixado: `validation/integrated-pilot/.venv/Scripts/python.exe`, com UTF-8. Unitários `test_contracts.py`; TypeScript `node --test provenance.test.ts` e typecheck strict. E2E `pytest test_integrated.py -q -s`, em instalação descartável. Cap 40 chamadas Terra por instalação, sem orçamento monetário inferido. `prepare.py` registra transformações da cópia, não deve ser reaplicado sobre o código final.

O E2E original concluiu os cinco checkpoints e falhou no grader, que confundia ausência de fim da vigência com ausência de início. Mantidos source original/console/JUnit/acceptance em evidence. O teste atual usa grader.py corrigido; oito regressões e quatro saídas gravadas passaram offline. Sem nova inferência e sem repetição completa do E2E após essa correção; ver RESULTS.md para os resultados separados.
