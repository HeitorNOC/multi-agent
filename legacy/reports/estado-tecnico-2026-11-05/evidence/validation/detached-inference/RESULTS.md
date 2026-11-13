# Inferência fora da trava retida — 04/11/2026

**Decisão: continuar com TypeScript + LangGraph + LightRAG; produção permanece NO-GO.** O caminho novo separa admissão, inferência e confirmação e passou testes de falhas controladas e uma requalificação semântica com restauração fria. Isso remove a espera da inferência da trava retida no perfil habilitado; não homologa toda a concorrência empresarial.

## Resultado executado

| Ensaio | Resultado |
|---|---|
| Provedor lento controlado, duas APIs reais | **1 E2E PASS em 14,36 s**, oito checkpoints; nenhum modelo invocado. [JUnit](final.xml), [log](final.log), [evidência](evidence/results.json) |
| LightRAG/ONNX/pgvector/Neo4j + Terra reais | **1 E2E PASS em 251,42 s**, quatro checkpoints, nove CLI; tempo interno 246,49 s. [JUnit](native-2.xml), [log](native-2.log), [evidência](native-evidence/results.json) |
| Recuperação governada anterior | **1 E2E PASS em 33,73 s**, sem modelo, export próprio. [JUnit](governed-regression.xml), [evidência](governed-regression-evidence/results.json) |
| Regressões dirigidas | Seis testes Python de autoridade, 16 Node e TypeScript strict PASS. [Python](units.xml), [Node](node-tests.log), [strict](typecheck.log) |

São três E2Es independentes; checkpoints são marcos internos, não testes independentes. A conferência posterior de assinaturas, reservas e recibos está em [verification.json](verification.json). [Ambiente fixado](environment.json), [comandos e negativos](COMMANDS.md), [manifesto](manifest.json).

Conferidas **188 provas assinadas** do ensaio controlado, **117** do nativo e **198** da regressão governada. Três recibos nativos foram vinculados por ID/hash aos três inputs e commits restaurados do ledger TypeScript.

## Comportamento observado

- Durante uma inferência controlada bloqueada, a outra API admitiu trabalho e consultou status em **46,8 ms**; uma revogação durante outra inferência levou **27,1 ms**. São duas amostras locais, não p95/p99 ou capacidade empresarial.
- Cinco renovações com IDs distintos mantiveram o lease de dois segundos além do prazo original. Outro trabalho expirou sem renovação: sua resposta tardia recebeu 409 e nenhum snapshot foi confirmado. Um worker com epoch atual recuperou o mesmo recibo, sem nova execução.
- Fencing durante a inferência impediu confirmação pelo epoch antigo. Seis chamadas duplicadas enquanto o provedor estava pendente receberam 409, sem repetir a execução; a repetição após o recibo reutilizou o resultado. Não se retorna uma resposta provisória como sucesso.
- Revogação durante a inferência retornou 403, sem linha em `reads`, sem entrega de resposta, e a leitura histórica do owner continuou negada. O recibo do provedor não concede acesso ao usuário.
- Reinício das APIs após admissão e queda do provedor após persistir seu recibo foram recuperados sem reexecutar. ID com outro conteúdo foi recusado; tentativa de injetar resposta no RPC de confirmação recebeu 400.
- Queda depois da admissão do provedor, sem recibo, continuou `pending_or_unknown` após restart. Três tentativas posteriores deram 409 e não geraram execução adicional. Outro trabalho prosseguiu, com a admissão anterior ainda rastreada.
- Oito IDs do provedor controlado tiveram **uma execução cada**; sete receberam recibos, um permaneceu admitido sem recibo. A autoridade empresarial terminou sem intenção de commit pendente e com nove unidades de negócio retidas de um teto de 32. Isso não significa ausência de inferência desconhecida: existe uma, explicitamente registrada.
- Um worker LangGraph real percorreu o caminho novo até concluir. As verificações de renovação/expiração/revogação usaram chamadas controladas de worker à API; não se implementou heartbeat automático no worker LangGraph nesta rodada.

No ensaio nativo, os especialistas consultaram duas fontes v1 e responderam dois dias remotos e limite de 1000, com citações corretas. A publicação v2 com queda retomou sem reingestão. Bundles antigo e adulterado foram recusados; o restore em novos volumes preservou histórico original e acesso revogado. A nova consulta respondeu três dias e citou `politica-remoto:v2.md`. **Três recibos nativos completos** foram conferidos após o restore. O snapshot completo inclui o registro dos recibos; não só os vetores e o grafo.

## Como funciona

`read_prepare` verifica identidade, grants e lease atuais, vincula plano/capacidade/fonte/versão/hashes/snapshot a um ID estável e persiste admissão sob confirmação assinada curta. O processo libera a trava retida e consulta o provedor autenticado. Antes de despachar uma execução ausente, volta a conferir o lease/ACL.

O provedor vincula o ID ao hash exato do input e persiste admissão antes de executar. Depois guarda um recibo durável. O adaptador primeiro faz lookup: recibo existente é reutilizado; admissão sem recibo após perda do processo não autoriza gerar outra resposta. No nativo, consultas ativas não mantêm a trava geral do serviço durante a inferência, e freeze/staging recusam avançar enquanto precisam drenar essas consultas.

`read_commit` obtém o recibo por lookup autenticado, sem aceitar texto do chamador; confirma ID/hash e volta à seção curta de commit. Confere novamente lease/epoch e grants, cobra uma única etapa e persiste snapshot e recibo. Tentativas de commit incluem worker/epoch no vínculo da operação, para que a rejeição de um epoch antigo não impeça a recuperação pelo atual.

O perfil é explícito (`detachedInference`); o ensaio nativo o habilitou. A configuração precisa existir antes do bootstrap da instalação. Habilitar novas tabelas sobre um ledger já assinado sem migração produziu recusa de inventário, preservada como negativo. Não há migração geral aprovada.

## Consumo real observado

Na rodada nativa: **9 chamadas / 9 reservas Terra**, 117.719 tokens de entrada, 78.464 de entrada em cache reportado e 1.059 de saída. Cache não é somado novamente à entrada. Nenhuma reserva ficou sem usage capturado e não houve evento inesperado de ferramenta. A tentativa nativa anterior falhou no startup, sem modelos.

Embeddings locais: 12 batches, 27 vetores, nenhum input truncado registrado. Corpus fechado: três releases fictícias ACME, guard de conteúdo exato/credenciais ativo. Não foram enviados documentos de cliente ou do dossiê. Custo monetário atribuível continua **não observado**. O provedor lento é simulação de protocolo/falhas, não evidência de qualidade de um modelo.

## Limites para produção

- A autoridade ainda serializa commits curtos. O adaptador Codex nativo ainda serializa suas chamadas; não se demonstrou execução paralela dos modelos ou throughput de grande empresa. Leituras de inventário completo também podem crescer com o corpus.
- Renovação é um contrato de API testado, sem laço automático e política de falha do heartbeat no worker. Cancelar a entrega após revogação não desfaz inferência já admitida, tokens consumidos ou dados previamente acessados pelo provedor. Uma checagem antes do despacho não cria atomicidade distribuída entre ACL e provedor.
- Sem recibo, a inferência permanece bloqueada. Falta encerramento governado específico para essa nova categoria, sem reutilizar indevidamente a política de efeitos externos ou devolver orçamento por inferência. Não foi qualificada toda queda entre intenção de `read_commit`, commit local e confirmação na autoridade; essa janela continua gate de produção.
- Cold restore passou com recibos completos; não se testou cold restore de uma inferência em andamento/unknown, nem perda total do host. Autoridade, KEK, serviço ONNX e autenticação Codex continuaram disponíveis no host. Sem DR externo/KMS/HA/PITR/RPO/RTO contratual.
- Sem SSO/MFA/TLS empresarial, sandbox de execução arbitrária homologada, conectores reais, corpus/carga grande, custo faturável ou controlador/Chief of Staff/equipes A0–A4 completos. Essas exigências permanecem; nenhum componente foi considerado aprovado por preferência de stack.

Mantidos instalação dedicada por empresa, cérebro lógico central, TypeScript empresarial e motores Python, um owner de workflow LangGraph, fontes/fatos/resultados com histórias distintas, orçamento, ACL atual e Obsidian opcional. Os processos da bancada não impõem uma topologia de microserviços ao produto.

**Próximo gate:** fechar e testar as janelas de recuperação do novo `read_commit` e da inferência unknown, com governança e evidência vinculada; acrescentar heartbeat automático com tratamento de falhas. Depois ampliar corpus/concorrência e qualificar provedor contratável e recuperação externa. A direção técnica segue viável neste recorte; produção ainda não tem evidência suficiente.
