# Revisão do NO-GO e da decisão de investimento

**Estudo comparativo mais recente:** [parecer de composição](../research/langgraph-study-2026-11-05/REPORT.md). Documentação/cursos/código e relatos de operação sustentam a reutilização do motor, com contrapontos específicos de limites em prompt, dedup fail-open, licença e runtime. Não há impossibilidade universal demonstrada; a implementação empresarial mantém quatro falhas de recuperação. Proposta para decisão conjunta: core LangGraph e harness opcional/substituível, sem fork completo de aplicação. Nenhuma suíte empresarial nova executada nesta pesquisa.

**Pesquisa dirigida posterior:** a pedido do usuário, [soluções existentes de LangGraph](../research/langgraph-reuse-2026-11-05/REPORT.md) foram pesquisadas em documentação, repositórios e YouTube, com uma prova nativa executada. Existem mecanismos reutilizáveis para grande parte da orquestração/recuperação. Priorizar adaptação desses padrões e de harness pronto; não interpretar falhas da bancada como problema geral ainda sem solução. O ledger e a autoridade assinada continuam exigindo integração específica; a pesquisa não transforma os negativos de V1 em PASS.

**Resultado posterior, 05/11/2026:** os quatro pontos foram executados no [gate de investimento](../validation/investment-gate/RESULTS.md). V1 reprovou continuidade em quatro critérios, V2 passou no envelope pequeno, V3 manteve inconsistência de contrato sem bypass e sem vantagem de qualidade demonstrada, V4 ficou condicionado a operação/faturamento externos. Recomendação: NO-GO para investimento amplo agora; somente engenharia delimitada dos bloqueios. O protocolo abaixo permanece como registro dos critérios anteriores à execução.

Data: 05/11/2026. Motivo: o usuário condicionou o desenvolvimento à confirmação de que a arquitetura pode alcançar produção e justifica o investimento. Esta revisão substitui a recomendação de iniciar imediatamente o desenvolvimento amplo em M1; preserva a investigação e todos os requisitos.

## Parecer atual

**Não foi comprovada uma impossibilidade estrutural da arquitetura escolhida. A viabilidade empresarial completa também não foi demonstrada.** O NO-GO vigente é da liberação da implementação atual em produção. Não equivale a concluir que LangGraph/LightRAG ou a arquitetura própria sejam incapazes de atender ao produto.

Há evidência para continuar um investimento técnico delimitado nos riscos restantes. Ainda não há base para prometer capacidade de grande empresa, custo economicamente aceitável ou robustez de todos os fluxos do produto. A recomendação anterior de começar o produto era válida somente como construção incremental com risco; foi ampla demais para o nível de comprovação de investimento que o usuário agora exige.

Nenhum teste novo foi executado nesta revisão. As conclusões abaixo vêm da releitura dos resultados e pendências existentes. Não se promete garantia absoluta antes do desenvolvimento ou para toda situação futura; a decisão deve se apoiar em um escopo mensurável e critérios de aprovação/rejeição.

## O que o NO-GO abrange

| Camada da decisão | Evidência e conclusão |
|---|---|
| Integração básica da arquitetura | Demonstrada no recorte pequeno: TypeScript, LangGraph, LightRAG, vetores/grafo reais, aprovação, histórico, ACL e cold restore funcionaram em ensaios integrados |
| Recuperação completa da implementação | Não demonstrada: `read_commit` tem janelas ainda sem qualificação; inferência sem recibo permanece bloqueada sem encerramento governado específico; heartbeat automático não foi implementado |
| Adequação ao produto completo | Em aberto: Chief of Staff/controlador A0–A4/equipes dinâmicas completos ainda não foram demonstrados. Roteamento determinístico da fixture não prova esse requisito |
| Escala e economia | Em aberto: corpus pequeno, serializações persistentes e custo monetário não observado. Tokens medidos não provam custo por entrega ou capacidade empresarial |
| Operação segura empresarial | Em aberto: identidade, sandbox/gateway real, conectores, chaves/autoridade fora do host, DR/upgrade e distribuição/licenças não homologados |
| Impossibilidade da stack | Nenhum impedimento universal comprovado. Isso é ausência de evidência de impossibilidade, não uma prova de sucesso futuro |

Fonte principal: [última rodada e seus limites](../validation/detached-inference/RESULTS.md), [verificação](../validation/detached-inference/verification.json), [pendências](PENDENCIAS_PRODUCAO.md). O ensaio nativo passou em 251,42 s, com três releases fictícias e nove chamadas Terra; esse tamanho não permite extrapolar para uma empresa grande.

## Gate final de viabilidade antes do desenvolvimento amplo

A comparação geral de ferramentas permanece encerrada. O próximo trabalho passa a ser uma validação dirigida do núcleo de maior risco, sem construir toda a UI ou o produto para só depois descobrir inviabilidade. Reutilizar o código já existente e repetir somente as verificações afetadas.

| Gate | Evidência necessária para decidir | Reprovação ou limite explícito |
|---|---|---|
| V1 — Integridade e continuidade | Quedas antes/depois de commit e confirmação; unknown com encerramento governado; heartbeat automático, expiração, cancelamento e revogação; restart e restore de trabalhos pendentes no caminho integrado | Efeito/resposta duplicados, perda silenciosa, acesso indevido ou reexecução de unknown impedem aprovação. Bloqueio seguro sem recuperação operacional não é PASS completo |
| V2 — Cérebro e carga | Mais fontes, versões contraditórias, exclusões/revogações e tarefas simultâneas; medir qualidade/citações/abstenção, erros, fila, throughput e latência, com recursos do host registrados | Envelope de capacidade deve ser declarado. Não extrapolar pequeno para grande; se o mecanismo exige reconstrução do motor ou não atende ao envelope, reconsiderar o componente |
| V3 — Conceito multiagente | Um caso transversal realista com CoS, decisão auditável de estratégia e equipe por capacidades, comparado a execução simples; política de risco/orçamento e aprovação | Sem cumprir o objetivo multiagente/adaptativo, não declarar que só um chat com RAG valida o produto. Desempenho/qualidade precisam justificar a complexidade no caso testado |
| V4 — Viabilidade operacional e econômica | Provar caminho de implantação com identidade e limites de ferramentas; recuperar chaves/autoridade fora do domínio de falha principal; demonstrar opção de provedor comercial e consumo atribuível | Conta pessoal Codex não basta como provedor de produção. Sem dados verificáveis de preço/contrato/uso, a conclusão econômica fica pendente, sem custo estimado tratado como medido |

Antes de executar V2/V3, registrar cenários pequeno/crescente e envelope-alvo da decisão, recursos disponíveis, metas de correção/latência e modo de comparação. Metas provisórias são de engenharia, não SLO prometido ao cliente. A intenção de atender empresas grandes permanece, mas tamanho concreto e custo aceitável precisam ser delimitados; não significam capacidade ilimitada.

V4 não autoriza compras, contratação, acesso a segredos ou sistemas reais. Executar a parte local já autorizada; registrar precisamente o que depende de acesso/condição externa. Uma pendência comercial pode impedir a conclusão econômica mesmo que o restante passe.

## Resultados possíveis e regra de parada

- **GO para investimento no desenvolvimento:** os riscos estruturais avaliados têm resultados satisfatórios no envelope declarado, caminho operacional/comercial viável e limites/resíduos explícitos. Prosseguir incrementalmente; ainda exigir homologação da versão efetivamente implantada.
- **GO condicionado:** núcleo atende, mas uma dependência delimitada permanece. Explicar qual investimento é justificável e qual ainda deve aguardar. Não apresentar como garantia do produto inteiro.
- **NO-GO da implementação:** falha localizada impede uso seguro; corrigir e repetir a bateria afetada, sem presumir troca de motor.
- **NO-GO do componente/arquitetura no requisito testado:** impedimento reproduzível, custo de adaptação incompatível ou envelope não atendido justificam substituir a parte responsável. Preservar os requisitos e reavaliar a menor fronteira possível.

Ao concluir essa rodada, emitir um parecer de investimento com resultados e pendências, inclusive se a conclusão for negativa ou condicionada. Não prolongar indefinidamente a investigação nem iniciar o produto completo por conveniência para contornar a decisão. Nenhum novo GO decorre apenas deste documento.

## Efeito nos documentos anteriores

[Encerramento](ENCERRAMENTO_INVESTIGACAO.md) e [plano M1](PLANO_DESENVOLVIMENTO.md) permanecem como histórico e plano posterior. A comparação ampla terminou, mas o início de desenvolvimento amplo fica condicionado a este gate por orientação mais recente do usuário. O [BASELINE original](BASELINE.json) registra os hashes anteriores a esta revisão; alterações documentais intencionais não modificam os artefatos de ensaio.
