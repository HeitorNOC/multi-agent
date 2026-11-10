# LangGraph + camada empresarial TypeScript — 04/11/2026

**Decisão: continuar o protótipo com LangGraph. Produção não aprovada.** Passou um recorte operacional com seleção de capacidades, aprovação, efeitos sintéticos e retomada entre processos. Planejamento cognitivo, controlador adaptativo completo e escala empresarial não foram homologados.

## O que foi construído e reaproveitado

- `business.ts`: camada própria TypeScript com catálogo de capacidades, identidade/autorização de bancada, plano estruturado, aprovação por hash exato, reservas por trabalho, recibos e leases com epoch persistido. Duas APIs podem usar o mesmo ledger SQLite; não há mutex global em memória.
- `worker.py`: LangGraph é o único responsável pelo workflow. Usa `Send` para especialistas selecionados, `interrupt` para aprovação e `AsyncPostgresSaver` para checkpoints. O conteúdo de `Command(resume=...)` não concede autorização.
- Reutilizados o editorial TypeScript de fontes aprovadas e o provedor sintético independente da rodada integrada anterior. Não se implementou outro motor RAG ou de grafos.
- Uma capacidade em assessoramento seleciona A1; uma capacidade com execução, A2; duas capacidades, A3. Trata-se de política determinística com capacidades declaradas e limite de dois especialistas. Não comprova compreensão de linguagem natural, A0 ou escalonamento A4 por incerteza/risco.
- Fontes, resultado do assessoramento e efeitos têm registros distintos. O resultado é estruturado e determinístico, identificado como tal; não é parecer gerado por modelo. O conhecimento desta rodada veio de snapshots canônicos aprovados, sem ingestão/busca semântica LightRAG nova.

## Versões observadas

LangGraph `1.2.19`, checkpoint `4.3.1`, checkpoint-postgres `3.2.0`, psycopg `3.3.7`, Python `3.12.14`, Node `24.20.0`. LangGraph importado do checkout `3c916d750575b22c464790e9774494d810ccd322`, sem diff vendor. PostgreSQL: `postgres@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`. Ambiente já existente, sem instalação de pacotes nesta rodada.

## Resultado final

**1 ensaio integrado PASS, 9 checkpoints, 27,31 s reportados pelo pytest.** São checkpoints do mesmo ensaio, não nove testes independentes nem estimativa de confiabilidade. Tempo interno do roteiro: 26,12 s. [JUnit](final-run.xml), [log](final-run.log), [evidência estruturada](evidence/results.json).

| Critério | Evidência executada |
|---|---|
| Composição por capacidades | A1 com um especialista, A2 com uma capacidade e escrita, A3 com dois especialistas via dispatch real LangGraph. Referências incluem fonte, versão, hashes, vigência e publicação. |
| Autorização e escopo | Token falso, identidade de outra instalação, capacidade desconhecida, domínio privado sem grant e tentativa de injetar owner foram recusados. Isso testa o contrato com identidades sintéticas; não requalifica SSO. |
| Aprovação | Chamador sem papel de governança e hash adulterado foram recusados. Retomar o grafo sem aprovação persistida falhou sem admitir o efeito. |
| Queda do worker | `os._exit(73)` após confirmação do efeito e antes do checkpoint do nó. Novo processo retomou o checkpoint e reutilizou o recibo. |
| Queda da API | `process.exit(74)` após sucesso do provedor e antes de persistir seu recibo na API. API e worker novos conciliam pelo provedor, sem novo envio. |
| Executor antigo | Lease exclusivo por trabalho; outra API recusou segundo claim ativo. Incremento do epoch bloqueou leitura e efeito do executor antigo. Fencing nesta prova foi autorizado manualmente pela governança. |
| ACL atual | Revogação depois da aprovação impediu nova execução; também bloqueou leitura de resultado histórico anteriormente permitido. Resultado original persistiu sem regeneração. |
| Orçamento | 24 admissões concorrentes por duas APIs: **15 aceitas e 9 recusadas com 429**, respeitando o saldo. Pedido com teto individual insuficiente foi recusado antes de admissão. |
| Efeitos e contabilização | Três recibos únicos e **um send por intenção**, inclusive nas duas janelas de queda. Cobranças por etapa únicas; tarefas concluídas mantiveram gasto igual à reserva do plano. |

O provedor sintético oferece chave idempotente e consulta consistente de recibo. O resultado depende desse contrato; não garante exatamente uma execução em qualquer API externa. Operação admitida pode terminar depois de revogação ou perda de lease; seu recibo é conservado e a entrega continua sujeita à autorização atual. Não testamos todas as intercalações entre revogação e commit.

As unidades de orçamento são **unidades sintéticas por etapa**: leitura custa 1 e efeito custa 2. Reserva integral só funciona para o plano finito desta prova. Não são tokens, dinheiro ou previsão de custo variável de modelos.

## Falha descoberta, preservada e corrigida

Primeiro ensaio com uma API passou em 37,07 s. Na ampliação para duas APIs, o teto não foi ultrapassado, mas surgiram recusas 503 em vez de 429: [FAIL original](two-api-failed.xml), [log](two-api-failed.log), [estado](evidence/two-api-failed.json).

Diagnóstico em cópias consistentes dos bancos identificou `database is locked` em `temporal-editorial/editorial.ts:execute`, na inicialização executada até para leitura. Uma prova com escritor aberto não reproduziu o erro; a regressão com **dois leitores concorrentes, 400 leituras** reproduziu. O negativo permanece em [editorial-read-red.log](editorial-read-red.log).

Correção: consultas canônicas abrem SQLite somente para leitura e não criam/migram schema; configure-se timeout antes das demais operações. Escritas mantêm inicialização e migração. Schema legado sem publicação verificável continua recusado. O fechamento da conexão também cobre falhas de inicialização.

Depois da correção, **12 testes Node passaram**: dez existentes do editorial e duas regressões de leitura; TypeScript strict passou. O diagnóstico passou a retornar 48 respostas 429 e nenhum erro interno. O **ensaio integrado completo foi repetido** e passou com duas APIs, não apenas revisado offline. [Regressões](editorial-read-green.log), [diagnóstico antes](evidence/quota-diagnostic-stack.json), [depois](evidence/quota-diagnostic-after.json).

A alteração no editorial compartilhado vale para o arquivo importado nesta rodada. Cópias antigas em outras bancadas não foram silenciosamente migradas, e resultados anteriores continuam vinculados às suas versões.

## Limites e gates restantes

- Autenticação usa tokens locais aleatórios mapeados a identidades, sem OIDC, rotação, TLS ou cofre nesta API. Não é autenticação empresarial aprovada.
- Controlador A4, Chief of Staff cognitivo, ferramentas reais, inferência, sandbox e qualidade semântica não foram exercitados. A falha anterior de compatibilidade do sandbox Dify permanece independente.
- Ledger/ACL TypeScript são locais e persistentes no restart, mas não contam com autoridade externa contra rollback neste recorte. As provas assinadas das rodadas anteriores não foram integradas nem substituídas. Próximo gate é unir essas fronteiras.
- Lease tem TTL fixo de 60 s e não houve qualificação de renovação, detecção automática de worker morto ou fencing coordenado em múltiplos hosts.
- Não houve cold restore conjunto, PITR, failover, migração SQLite→PostgreSQL, carga empresarial ou homologação de múltiplas instalações reais. A identidade estrangeira recusada não substitui teste de isolamento de infraestrutura entre empresas.
- Reservas de tarefas interrompidas permanecem retidas; encerramento governado e devolução segura de saldo ainda precisam ser integrados. Sem recibo externo verificável, a intenção pendente bloqueia reenvio automático.
- Não se executaram modelos: **zero chamadas nesta rodada**, sem custo monetário atribuível medido. Recursos locais foram consumidos.

Mantidos instalação dedicada por cliente, cérebro lógico central, camadas TypeScript/Python, equipes por capacidades, UI JARVIS e Obsidian opcional. Nenhuma plataforma comercial foi contratada, nenhum dado real foi usado e nenhum ambiente de produção foi alterado. Contêiner e volume do ensaio foram removidos com verificação de rótulos de propriedade; fontes, bancos sintéticos privados e evidências permanecem locais.

**Próximo bloco recomendado:** integrar o fluxo TypeScript/LangGraph à autoridade assinada de orçamento/atualidade e à publicação/recuperação existentes; depois qualificar planejamento real e custo com modelo no mesmo contrato de execução. Não começar uma interface de produto antes desses gates operacionais.
