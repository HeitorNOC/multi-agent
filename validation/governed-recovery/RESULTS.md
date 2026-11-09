# Conciliação governada TypeScript + LangGraph — 04/11/2026

**Decisão: continuar o protótipo; produção segue NO-GO.** A camada TypeScript agora recupera dois estados específicos com duas identidades de governança e evidência vinculada à autoridade assinada. Não há liberação geral de uma instalação com histórico divergente.

Requalificação durante `brain-recovery`: [mesmo E2E passou em 30,22 s](brain-regression.xml), sem modelos. O export atual `evidence/results.json`, chave pública e 198 provas conferidas corresponde a essa nova instalação. JUnit/log da execução original de 39,55 s permanecem abaixo. A regressão inicialmente reutilizou o destino de exportação e substituiu o JSON/chave anteriores; manifesto e verificação anteriores foram preservados, mas o stream antigo não pode ser novamente verificado sem sua chave pública. Detalhes e correção do destino: [registro da rodada](../brain-recovery/COMMANDS.md).

## Resultado executado

**1 E2E PASS, nove checkpoints, 39,55 s pelo pytest**; tempo interno 35,61 s. Também passaram **cinco testes Python de autoridade**, **16 testes Node** e TypeScript strict. A regressão integrada anterior passou em 23,83 s. Os checkpoints são partes do mesmo ensaio, não nove testes independentes.

[JUnit](final.xml), [log](final.log), [evidência estruturada](evidence/results.json), [testes da autoridade](units-final.xml), [Node](node-final.log).

Verificação posterior conferiu **198 provas assinadas** e quatro votos de recuperação retidos, além de nonces, horários de requisição registrados e vínculos de evidência: [verification.json](verification.json). Estado final sem intenção pendente; produção não aprovada.

| Situação | Procedimento e resultado observado |
|---|---|
| Admissão retida sem alteração local | Reconstrói prefixo/inventário anterior; exige uma única intenção pendente final de tipo conhecido, owner explícito e ausência do job local. Duas identidades encerram como `closed_unknown`. Reserva permanece retida. |
| Efeito executado com recibo externo | Reconstitui exatamente as alterações locais permitidas da admissão; consulta o provedor pela API autenticada, valida intenção/recibo e vincula esse resultado à evidência. Duas identidades confirmam `reconciled_effect`, sem novo envio. |
| Provedor indisponível ou lookup sem recibo | Inspeção/recuperação recusadas; instalação permanece bloqueada. Uma store vazia do provedor recebeu só lookup, sem nenhum send. Não aceita recibo fornecido pelo chamador. |
| Queda durante a confirmação | Injeta saída 78 depois do commit local e antes da conclusão externa, tanto no encerramento da admissão quanto na conciliação do efeito. Novo processo verifica os dois votos retidos, o delta permitido e o inventário; o segundo revisor original conclui sem repetir o commit. |
| Retomada do LangGraph | Após conciliar o recibo e invalidar o lease antigo, novo worker retoma o nó e reutiliza o resultado confirmado. Dois efeitos únicos no ensaio, um `send` por intenção. |
| Restore posterior | Backup antigo é recusado. Backup atual restaura em PostgreSQL/volume novos; uma segunda restauração preserva a conciliação, encontra sete checkpoints reais e mantém o resultado sem reenvio. |

## Aprovações e controles

- Identidade solicitante, chamador sem papel de governança, evidência alterada, confirmação pela mesma identidade sem um segundo voto e tentativa de injetar recibo no corpo da requisição foram recusados.
- Primeiro voto e motivo ficam retidos na autoridade externa e não podem ser alterados. O segundo voto deve vincular a mesma evidência/motivo. Identidades precisam estar habilitadas, com papel de governança e grants atuais das fontes envolvidas.
- Encerramento unknown e conciliação de efeito são resultados distintos. A autoridade não permite converter posteriormente esse encerramento em sucesso comum, nem encerrar efeito como se fosse uma admissão não executada.
- Tombstone impede reutilizar o ID encerrado, inclusive com conteúdo diferente. Um pedido novo exige outra intenção explícita e os controles normais; não há reexecução automática do original.
- Ao conciliar efeito, o epoch do job aumenta e o lease antigo é limpo. A autorização da leitura histórica continua sendo verificada: a revogação prévia permaneceu efetiva depois da recuperação.
- Saldo final: **nove unidades retidas de um teto de 16**, incluindo uma unidade do pedido encerrado unknown. Nenhum reembolso foi inferido. As unidades são sintéticas; não representam tokens, gasto real ou preço.
- O ensaio usa tokens/identidades locais de bancada. Não comprova autenticação humana, SSO, MFA ou segregação organizacional de produção.

## Como a evidência é vinculada

O digest da revisão identifica a intenção assinada, o prefixo local já confirmado e o inventário pertinente. Para efeito, inclui o recibo consultado diretamente da ferramenta. Os votos constam da prova Ed25519 emitida pela autoridade. Nonce, instalação e prazo continuam sendo verificados.

Na recuperação de um commit local preparado, só são aceitas alterações conhecidas: tombstone de encerramento ou recibo confirmado/epoch/auditoria do efeito. O estado anterior reconstituído deve voltar ao hash do prefixo retido. Alterações não relacionadas, histórico concluído faltante, várias intenções pendentes ou operação sem procedimento qualificado continuam bloqueados.

O provedor sintético oferece lookup consistente e idempotência por intenção. Essas garantias precisam existir no contrato de cada ferramenta real. Não se demonstrou exatamente uma execução para APIs arbitrárias.

## Falha e adaptação preservadas

As primeiras provas passaram para admissão e depois para efeito. Ao ampliar para uma segunda restauração, o E2E terminou **FAIL**: o helper de backup ainda copiava o banco original, embora a API estivesse operando sobre um diretório restaurado. A verificação assinada recusou o conjunto antigo; não houve abertura indevida.

Diagnóstico: autoridade com **29 operações**, backup g2 com **18 recibos**, banco ativo com **29**. O FAIL permanece em [JUnit negativo](stale-bundle-failed.xml), [log](stale-bundle-failed.log) e [resultado](evidence/stale-bundle-failed.json).

O helper passou a copiar `config.db`, `config.editorial` e `config.vault` efetivamente ativos; também acompanha o PostgreSQL ativo e usa nomes únicos em restaurações sucessivas. Depois da correção, o **ensaio completo foi repetido** e passou. Não se alterou o critério de consistência.

Houve erro inicial de tipagem ao ampliar o retorno da inspeção para incluir recibo; corrigido antes da execução final. Logs iniciais foram preservados. Não foi falha do runtime LangGraph.

## Limites restantes

- Foram qualificados apenas admissão sem alteração local e efeito com delta local conhecido/recibo verificável. Sem recibo verificável, com alterações extras ou outras intenções, permanece o bloqueio. Não há recuperação geral por tentativa e erro.
- Não há devolução automática de reserva, cancelamento distribuído de efeito já admitido nem conciliação universal de tarefas parcialmente executadas.
- Votos são autenticados pela API de bancada e retidos por serviço que confia nesse backend. SSO/MFA, assinaturas de aprovação humanas independentes e administração de identidades durante recuperação não foram homologados.
- Linha de commits e autoridade continuam em um host, com serialização e histórico/inventários completos. Teste de lock acelerado usou **2 s**, mantendo recusa de commit expirado; o padrão permanece 30 s. Renovação, pausas longas, disputa intensa e HA não foram qualificados.
- Restauração é fria/controlada de SQLite/Vault/schema de checkpoints. Falta cérebro semântico completo, PITR, DR/KMS e verificação de toda adulteração possível do dump PostgreSQL. Não é homologação empresarial de backup.
- Controlador A4 cognitivo, modelos, ferramentas reais, sandbox, qualidade, carga e custo monetário continuam pendentes. **Zero chamadas a modelos nesta rodada.**

Reutilizados LangGraph/Python, governança TypeScript, editorial existente e autoridade/provedor sintéticos; nenhuma segunda autoridade de workflow foi introduzida. Obsidian continua opcional. Não houve dados reais, contratação ou mudança de produção. Recursos Docker do ensaio foram removidos após conferir seus rótulos.

**Próximo gate:** integrar esta recuperação ao ciclo completo de fontes/projeções do cérebro e testar seus estados intermediários, antes de qualificar planejamento real, custo e capacidade empresarial.
