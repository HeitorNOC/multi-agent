# Conciliação e dois processos — 04/11/2026

Ensaio isolado que continua freshness-and-provenance. Dados sintéticos, serviços reais e chamadas Codex Terra autorizadas, com máximo de 40 reservas de tentativa no escopo model. Não executa ações empresariais externas nem aprova produção.

## Contratos exercitados

- Dois processos da API compartilham instalação, source ledger, PostgreSQL, Neo4j e autoridade retida. Uma conexão dedicada adquire advisory lock de sessão por instalação; a conexão fecha em erro e o PostgreSQL libera o lock se o processo morrer. Há exclusão global, não paralelismo empresarial. O lock não é um novo motor de workflow.
- Antes de servir trabalho depois de obter o lock, a API confere o head retido e o gate persistente. Uma réplica que já estava viva precisa reconhecer a intenção deixada pela outra, sem depender do restart dessa réplica.
- Recibo empresarial durável permite recompor o registro final e o recibo de atualidade sem chamar o modelo. Se ambos já existem, basta confirmar o mesmo hash na autoridade. Conciliação exige governança, grant atual da fonte e proprietário original ainda autorizado. Replay da conciliação não cria outro resultado.
- Sem recibo, o encerramento é explicitamente unknown. Há proposta com motivo/hash de evidência e confirmação por outra identidade board autorizada, distinta do proprietário. Tombstone local e resultado fechado na autoridade bloqueiam o ID e a repetição do mesmo fingerprint. Não se converte unknown em sucesso nem se cria automaticamente outro pedido.
- Não há nesta rodada fluxo de substituição autorizado para uma intenção sem admission local. O mecanismo anterior de substituição de admission continua separado e precisa de teste combinado. Comparação por fingerprint não detecta reformulações semânticas arbitrárias.

## Orçamento de tentativas

O provider deixou de incrementar arquivo JSON. Antes de cada execução CLI, solicita reserva atômica à autoridade SQLite retida. A autoridade mantém o limite no servidor, numera as reservas e as vincula ao ID; retry exato não incrementa. A reserva persiste mesmo se o cliente morrer antes de iniciar/finalizar inferência. Não há refund automático e não se afirma exatamente uma inferência nem gasto em dinheiro.

O teste de corrida usa dois processos de sistema operacional, 20 pedidos de reserva no escopo stress, cap 7. Não executa modelos nesse escopo. O escopo model tem cap 40 e é usado pelas APIs reais. Assim, são evidências separadas: concorrência das reservas e utilização real do provider com IDs globais únicos. A exclusão global serializa as inferências de negócio no cenário atual.

A autoridade é reiniciada sobre o mesmo SQLite, com a chave retida na memória privada do harness. As duas APIs também reiniciam. Não é KMS, DR externo ou HA; não se testou perda do host nem autoridade ativa em múltiplos processos. Cap configurado é de tentativas CLI, não valor financeiro, tokens, número de requests HTTP internos ou dimensionamento empresarial.

## Segurança e arquitetura

O teste revoga o grant de uma identidade board antes da primeira aprovação/publicação e exige recusa sem nova intenção. Outra identidade autorizada faz o trabalho. A mesma identidade revogada é recusada para conciliação/encerramento; duas outras identidades autorizadas concluem o encerramento. Não é necessário reintroduzir grants por SQL privilegiado na fixture.

Revogação usa um lock PG separado para não esperar toda a inferência; o registro continua rechecando grants. Revogação em todas as janelas de commit e replay integrado sob revogação concorrente precisam de cobertura específica. O journal retido em arquivo não foi convertido em serviço distribuído, e caminhos que não usam o lock não são protegidos por ele. Rotas de status podem ler enquanto outra operação está ativa.

Depois do E2E foi encontrada e corrigida a checagem ausente no replay de publicação já concluída: três testes isolados da rota real passaram após dois failures de regressão preservados. O E2E completo não foi repetido após essa pequena mudança. O teste isolado não substitui prova de revogação concorrente em todas as janelas.

Mantidos instalação dedicada, cérebro central lógico, TypeScript empresarial, motores Python e LangGraph único owner. O editorial/proveniência TypeScript são reais; estes controles Python são bancada de qualificação, não redefinição da camada empresarial final. Chief of Staff, controlador A0–A4, equipes por capacidades, sandbox/gateway integrado, SSO/TLS/cofre, conectores, corpus/carga empresarial e JARVIS seguem gates próprios. Obsidian opcional sem UI ensaiada; Graphiti não é autoridade histórica exclusiva.

O novo schema e o inventário têm alterações não qualificadas em restauração nesta rodada. O backup antigo não deve ser presumido compatível automaticamente: propostas, tombstones, auditoria, contexto/outcome de autoridade e contadores precisam de cobertura de recovery conjunta. Os ensaios anteriores permanecem como evidência delimitada, não aprovação transferível.
