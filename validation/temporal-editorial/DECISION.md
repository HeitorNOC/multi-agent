# Decisão desta rodada

**Continuar a plataforma por componentes, manter LightRAG/LangGraph e avançar com a camada editorial própria. Não aprovar Graphiti como autoridade para reconstruir tudo que era conhecido antes de uma retificação. Produção desta versão continua NO-GO.**

O teste native Graphiti com Terra passou 3/7 critérios; com Sol, 6/7. Esses números são sete verificações sobre o mesmo corpus pequeno, não taxas estatísticas de acurácia geral. A troca de modelo corrigiu neste ensaio a inconsistência entre fato textual e atributo numérico; não resolveu a consulta de conhecimento anterior à correção. Os resultados negativos foram preservados, sem editar fatos/datas do grafo ou afrouxar critérios.

## O que adotar e com quais limites

| Componente | Decisão | Limite |
|---|---|---|
| Obsidian/Markdown | Manter como edição opcional; vault preparado | Sem instalação/UI Obsidian homologada; perfil de propriedades limitado e explícito |
| Editorial TypeScript | Continuar o protótipo | Revisão, conteúdo imutável e autorização testados; não é todo o control plane empresarial |
| LightRAG | Manter a decisão anterior | Prova semântica integrada anterior permanece válida; corpus representativo ainda pendente |
| LangGraph | Manter como único owner de execução | Esta rodada não introduz outro runtime ou revalida todos os workflows anteriores |
| Graphiti + Sol | Candidato a projeção de apoio de fatos com vigência | Seis critérios de vigência passaram neste recorte; não homologado para história de conhecimento arbitrária nem produção |
| Graphiti + Terra | Não aprovar o recorte temporal estruturado testado | Observada uma aresta textual de dois dias com atributo dias_remotos=3; não generalizar incapacidade do modelo fora deste ensaio |
| Snapshots canônicos | Usar como contrato da camada empresarial para auditoria de fontes | Escolher versão aprovada por vigência/publicação não reconstrói automaticamente entidades/fatos/decisões antigas |

## Por que não aprovar o histórico nativo

Após inserir uma retificação retroativa, as arestas atuais passaram a carregar os limites corrigidos de vigência. A consulta que combinou valid_at/invalid_at com created_at/expired_at não recuperou a regra que era conhecida antes da retificação. A inspeção dos registros capturados mostra que simplesmente retirar o filtro expired_at tampouco recupera a antiga fronteira de invalid_at.

Isso demonstra uma falha do **contrato e configuração testados**, não uma prova de impossibilidade de qualquer uso ou extensão de Graphiti. O campo expired_at também é usado pelo código nativo para marcar arestas já históricas; não se pode presumir que esses quatro campos, isoladamente, implementem qualquer pergunta bitemporal do produto. Fonte primária: `graphiti_core/utils/maintenance/edge_operations.py`, `_apply_temporal_invalidation` e `resolve_edge_contradictions`, no SHA fixado.

Nossa decisão é não usar essa projeção como única autoridade para auditoria histórica. Semântica de passado deve declarar se consulta fontes aprovadas, fatos extraídos ou decisões efetivamente tomadas, e qual é o instante de conhecimento. Nenhuma decisão antiga deve ser reescrita por uma retificação posterior.

## Adaptação implementada

O módulo editorial preserva a fonte e o hash aprovados, a vigência proposta e a data do commit canônico. A seleção as-of devolve **o snapshot de Markdown**, não um fato fabricado a partir do grafo. Publicações legadas sem instante registrado são recusadas; não se inventa um horário para completar histórico. Essa lógica pertence à governança/versionamento da plataforma e não reimplementa extração, deduplicação, busca ou invalidação do Graphiti.

Também há um gate de publicação: grafo gravado ainda não significa fonte publicada. O recibo da projeção fica persistido em estado graph_ready; até o commit editorial e a confirmação final, consultas são bloqueadas. A conciliação usa o snapshot previamente aprovado e não precisa reingerir a fonte. Perda de resposta durante a própria ingestão nativa permanece incerta e exige conciliação/rebuild específico; não foi declarada idempotência nativa do Graphiti.

## Alternativa para avaliar, sem adicioná-la agora ao stack

Se o produto precisar consultar arbitrariamente versões históricas de fatos estruturados e correções, além das fontes aprovadas, um banco temporal dedicado é candidato a uma prova separada. O XTDB documenta e distingue tempo de sistema e de vigência e oferece filtros temporais SQL. **Não foi executado ou aprovado aqui**, nem substitui extração/RAG. Sua inclusão exigiria justificar operação, escala, licença e custo adicional. [Modelo temporal XTDB](https://docs.xtdb.com/about/time-in-xtdb.html), [consultas SQL temporais](https://docs.xtdb.com/reference/main/sql/queries.html).

Prioridade imediata: integrar a fonte canônica selecionada ao caminho LightRAG e preservar evidências das decisões. Só acrescentar outro banco se o contrato de histórico de fatos justificar essa complexidade.

## Arquitetura preservada e trabalho restante

Continuam instalação dedicada por cliente, um cérebro lógico central com fontes canônicas e projeções reutilizáveis, camada empresarial preferencialmente TypeScript, motores Python e um único dono de workflow. Chief of Staff, Adaptive Controller A0–A4, equipes dinâmicas por capacidades, contratação permanente mediante aprovação e interface JARVIS funcional continuam requisitos. Duas classificações de fonte e as contas de serviço deste experimento são fixtures, não um organograma rígido do produto.

Ainda faltam corpus/avaliação representativos, coabitação/reconciliação LightRAG+Graphiti, conectores reais, SSO humano/federação/MFA/TLS, gestão e recuperação de segredos, gateway de ferramentas/MCP, custo financeiro atribuível, carga empresarial, PITR/failover e implementação do produto completo. Esta rodada testou restart e uma falha de publicação; não homologou backup conjunto do novo ledger editorial nem operação com múltiplos writers/instâncias.

## Continuidade — fonte e registro original

[canonical-decisions](../canonical-decisions/RESULTS.md) integrou a seleção de snapshot aprovado ao LightRAG nativo e a registros de assessoramento no PostgreSQL. Um E2E passou em 214,39 s com cinco casos temporais, preservação exata do registro antigo após retificação/restart, ausência de inferência na leitura histórica e aplicação dos grants atuais. Isso avança o contrato de fontes e registros no corpus pequeno; não corrige nem aprova retrospectivamente a consulta nativa de fatos Graphiti que falhou. Modelo e arquitetura seguem sujeitos a avaliação representativa e aos gates restantes.
