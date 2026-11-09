# Parecer comparativo: LangGraph e AgentScope

Data: 2026-11-03. Escopo autorizado: comparação local dos motores, usando nossa camada própria, LightRAG, aprovação humana, orçamento e falhas sintéticas. Sem instalação de produção, publicação, compras ou chamadas pagas.

## Decisão

**Recomendo LangGraph como único dono do workflow na arquitetura atualmente auditada.** Os dois motores completaram o mesmo contrato empresarial; LangGraph demonstrou checkpoint de execução e pausa/retomada por aprovação sem reconstruirmos esses mecanismos na camada empresarial. AgentScope continua viável e não recebeu um NO-GO de impossibilidade. O caminho SDK/TeamPipeline testado precisou reconstruir equipe e usar resultados duráveis da nossa camada para recuperar a etapa já concluída.

Classificação: **CONDITIONAL para avançar com o desenho baseado em LangGraph; NO-GO para produção enquanto os gates restantes estiverem abertos.** Não é uma decisão de compra, implantação ou substituição definitiva de dependências.

Não há evidência para adotar dois coordenadores de workflow simultaneamente. AgentScope pode ser reconsiderado como SDK de agentes dentro de uma etapa, se houver benefício demonstrável, sem receber outra autoridade concorrente. Não introduzimos essa composição agora.

OpenAgents permanece componente opcional de colaboração. Sua reentrega duplicada foi absorvida por inbox durável da camada própria, nos testes. Paperclip continua candidato de governança por API/adaptador, conforme a reavaliação anterior: sua impossibilidade sem fork foi refutada. Ele não participou desta comparação; não foi homologado automaticamente.

## Versões e fontes

| Componente | SHA | Versão/condição | Licença do arquivo raiz |
|---|---|---|---|
| LangGraph | 3c916d750575b22c464790e9774494d810ccd322 | 1.2.19; checkpoint 4.3.1; SQLite saver 3.1.3 | MIT |
| AgentScope | 9668b4c90c70cc214e1b7bb65dec2a6e70b90010 | 2.0.12.dev0, instalado do clone | Apache-2.0 |
| LightRAG | aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a | 1.5.8 | MIT |
| OpenAgents | 6a330c789c321bdce5856578b7c47c2539ea7fc6 | API workspace do clone | Apache-2.0 |

Python 3.12.14, Windows, ambientes isolados existentes. Nenhum core upstream recebeu patch. Importar o SDK OpenAgents pode regenerar três arquivos egg-info; diff preservado e somente esses metadados restaurados. Licenças acima são inventário de arquivos, não auditoria de toda a árvore de dependências, modelos ou ativos da UI. Releases futuros não foram automaticamente aprovados.

## O que é real e o que é fixture

**Real:** LangGraph StateGraph/AsyncSqliteSaver/interrupt/Command; AgentScope Agent/Toolkit/TeamPipeline e permission hooks; LightRAG aquery_data; servidor TCP HTTP loopback; processos/venvs separados; bancos SQLite persistentes; encerramento abrupto de worker; reinicialização real do serviço de controle/conhecimento; rotas FastAPI OpenAgents reais via TestClient ASGI.

**Sintético:** conteúdo, modelos e embeddings, escolha A3/capacidades, credenciais humanas/de execução, custos inteiros, período que representa o orçamento mensal, provedor de e-mail e suas garantias de idempotência/consulta. Aprovação humana é um ator de teste separado, não uma pessoa clicando numa UI. Não houve avaliação de qualidade de LLM, inferência comercial ou cobrança real. No caminho LangGraph, a análise estrutura evidências e plano, sem gerar resposta natural; causalidade e qualidade da explicação não foram homologadas.

A Knowledge API chama o LightRAG real com armazenamento separado A/B, autoriza empresa/escopo antes do retrieval e verifica o resultado. Modo **naive**, vetores constantes, um documento sintético por empresa contendo vendas/campanha. Os dois especialistas consultam esse corpus; isso NÃO são duas fontes independentes corroborando uma hipótese. chunk_id e file_path vêm do retrieval; versão 1 e proveniência de ingestão são metadados da fixture. Grafo semântico, busca híbrida, vigência temporal, ACL por documento e qualidade de ranking permanecem requisitos não homologados.

## Mesmo contrato, autoridades distintas

O serviço `service.py` é um harness de auditoria, não a plataforma comercial. As rotas próprias /create, /begin, /knowledge, /analysis, /approve, /effect, /cancel e /consume NÃO são APIs inventadas atribuídas ao Paperclip, AgentScope ou OpenAgents.

1. Ator humano sintético cria uma execução; o servidor emite token opaco aleatório, armazena seu hash e vincula run, empresa e escopos. O worker não recebe a credencial humana.
2. Camada própria fixa o plano A3 da fixture e capacidades sales/campaign, com motivo auditável. Reserva quatro unidades por tarefa em uma conta de período segregada por empresa; admissão usa transação.
3. Chief of Staff coordena a análise. LangGraph usa nós explícitos; AgentScope usa líder e dois membros com modelos determinísticos. Execução sequencial neste experimento, sem teste de qualidade de seleção dinâmica.
4. Cada leitura autorizada custa uma unidade sintética; o resultado é persistido. Charge idempotente por operação evita dupla cobrança pela mesma operação da fixture, não garante a mesma propriedade num provedor real.
5. O serviço produz hash do plano com empresa, run, intenção, operação e evidências. A execução fica waiting_approval. LangGraph também fica no interrupt persistido; no AgentScope o gate empresarial vive na camada própria.
6. Somente a credencial humana pode aprovar o hash atual. Booleano approved enviado pelo executor, hash antigo e tentativa de autoaprovação são rejeitados no servidor.
7. Efeito verifica novamente identidade, escopo, aprovação, estado e reserva. Provedor externo simulado usa banco separado, chave estável empresa+intenção+operação e lookup de recibo. Apenas depois de conciliar o recibo a execução se torna completed e cria outbox.
8. OpenAgents transporta o evento referenciado por run/hash/recibo. Evidências permanecem na camada autorizada de conhecimento/execução; o workspace não se torna outro cérebro empresarial. Inbox persistente aplica cada event_id uma vez e rejeita colisão com payload divergente.

Essa separação não substitui as bibliotecas: não reimplementamos grafo, executor de agentes ou retrieval. Identidade empresarial, autorização por efeito, conciliação, aprovação e integração de eventos continuam responsabilidades explícitas da nossa camada ou de componentes de governança que venham a ser selecionados.

## Resultados executados

**Rodada final: 17 PASS em 78,47 s.** XML/log em `evidence/comparison.*`; snapshots em `scenarios.jsonl`; invocações e falhas esperadas em `workers.json`. Existem 20 snapshots, porque alguns testes registram duas execuções; não são 20 testes independentes.

| Cenário | Resultado observado nos dois motores |
|---|---|
| Análise → aprovação → efeito → conciliação | Fontes retornadas pelo LightRAG; esperando aprovação com custo 2/reserva restante 2/nenhuma entrega; depois da aprovação, completed, custo total 3, reserva 0 e uma entrega |
| Aprovação indevida | Efeito com approved=true, autoaprovação pelo token executor e plano desatualizado rejeitados |
| Encerramento abrupto após vendas | Worker sai com os._exit(71); processo novo recupera e conclui sem efeito/custo duplicado |
| Cancelamento durante leitura em andamento | Host solicita parada, termina worker real e observa sua saída; servidor impede persistência tardia; depois da janela original: cancelled, custo parcial 1, reserva 0, nenhum efeito |
| Resposta perdida após envio externo | Primeira tentativa deixa effect_pending, não completed; cancelamento simples é bloqueado até conciliar; serviço reinicia e retry recupera recibo; uma única entrega e custo 3 |
| Identidade e autorização | Token falso/revogado e acesso sem escopo/empresa divergente negados pelo servidor; token revogado retorna 401 |
| Custo do provedor supera estimativa | Reserva 4; fixture reporta consumo 5; total real da fixture fica 5 e execução budget_exceeded, sem permitir efeito. O teste comprova detecção e interrupção posterior, NÃO prevenção absoluta de overspend |
| Orçamento agregado concorrente | Dois runs de motores diferentes disputam conta com limite 6 e reserva individual 4: um admitido e outro rejeitado; sem overbooking |
| Reentrega OpenAgents | API aceita duas mensagens com mesmo event_id; inbox aplica uma vez, inclusive após reiniciar o serviço |
| Falha de modelo | Exceção injetada antes da análise de campanha impede aprovação/completion/outbox; um retry explícito do host recupera. Não testamos política de retry de provedor comercial |
| Mesma intenção aprovada em novo run | Dois runs, uma entrega externa; custo 3 no primeiro e 2 no segundo, pois o provedor da fixture reconhece o efeito anterior |

Os checks de política compartilhada são testes da nossa camada e não vantagens exclusivas de um motor. O cancelamento foi por contenção do processo pelo host e fence no servidor; não é comparação de cancelamento cooperativo nativo dos SDKs.

## Diferença de recuperação que fundamenta a recomendação

LangGraph: após vendas, o checkpoint nativo preservou a próxima etapa. Retomada completou com **duas requisições de conhecimento no total, nenhum hit do cache de findings**. A aprovação usou interrupt/Command persistidos. Depois da falha no efeito, retomou o nó pendente; idempotência externa e conciliação continuaram necessárias.

AgentScope: o SDK executou os agentes, mas nesta integração o novo processo reconstruiu a equipe. Foram **três requisições de conhecimento, uma atendida pelo cache próprio**; sem repetir custo ou efeito. Aprovação e progresso empresarial foram restaurados pela camada própria. Isso funcionou, mas precisa ser mantido e explicado como responsabilidade adicional.

Importante: o AgentScope também possui AgentState/SessionRecord, SQLStorage.update_session_state e checkpoint de eventos no Agent Service, encontrados no código. **Não concluímos que o projeto seja incapaz de persistir ou retomar.** Não qualificamos o Agent Service completo e a recuperação de seus participantes pendentes neste mesmo contrato. A preferência compara os caminhos integrados e testados aqui, não todas as configurações possíveis dos frameworks.

Também não declaramos LangGraph mais rápido ou barato: seus nós usam stubs determinísticos, enquanto AgentScope executa um loop real de chamadas a MockModel. Tempos registrados incluem inicialização/importação/processos locais. Amostra e cargas não sustentam ranking de latência, p95 de produção, custo de inferência ou qualidade.

## Falhas e adaptações preservadas

- Primeira rodada: 9 PASS / 4 FAIL em 47,72 s. Nossa EffectTool não declarava is_concurrency_safe, exigido pelo executor AgentScope. Corrigimos somente a ferramenta externa, declarando false. Falhas e traces em `evidence/first-attempt/`; não atribuir esse erro à inviabilidade do motor.
- Segunda rodada: 13 PASS em 53,93 s, `evidence/second-attempt/`.
- Rodada final ampliou apenas lacunas relevantes: falha de modelo, mesma intenção em novo run e conta de orçamento segregada por empresa; 17 PASS.
- Falhas 503 e saídas não zero em `workers.json` fazem parte dos cenários de injeção. O teste exige estado effect_pending/running sem conclusão falsa antes de recuperar.
- Em particular, uma mensagem do modelo dizendo que terminou não é prova de conclusão: o worker confere o estado empresarial final no servidor. Aceitação HTTP, resultado do tool-call ou texto do agente não substituem recibo/estado conciliado.
- Warning pytest-asyncio sobre fixture_loop_scope foi preservado; não causou falha. Nenhum serviço da prova ficou ativo ao concluir.

## Reuso e manutenção

| Componente | Classificação | Limite/obrigação |
|---|---|---|
| LangGraph | Reutilizar SDK/checkpointer; preferido para workflow | Fixar versões; testes de migração/checkpoint; não presumir exactly-once de ferramentas |
| AgentScope | Reutilizável por SDK, alternativa viável | O caminho testado precisa de recuperação própria; Agent Service completo ainda não comparado; snapshot dev |
| LightRAG | Reutilizar por Knowledge API | Manter autorização fora do prompt; qualificar grafo/híbrido, ACL, fontes/versionamento e relevância reais |
| OpenAgents | Adotar API condicionalmente para colaboração | Token legado nesta fixture; consumidor idempotente obrigatório; justificar dependência pela necessidade do produto |
| Paperclip | Candidato de governança por API/plugin externo | Resultado anterior segue válido; não reauditar como impossível nem aprovar por associação |
| Camada própria | Adaptar externamente, sem fork | Contratos e políticas empresariais; não copiar todo um control plane para padronizar linguagem |

Não é obrigatório usar todos os candidatos. Não geramos fork, scheduler paralelo, Temporal, Kafka, Redis ou topologia de dezenas de serviços. Separar venv/processos nesta prova resolve dependências do experimento, não define o deployment comercial.

## Riscos e gates restantes

| Risco | Severidade / probabilidade nesta etapa | Mitigação e responsável |
|---|---|---|
| API externa sem idempotência/lookup duplica efeito após perda de resposta | Crítica / depende do provedor | Integração por operação deve comprovar garantias, inbox e conciliação; owner: camada de ferramentas |
| Estimativa menor que custo já incorrido | Alta / demonstrada por fixture | Limites de tokens/chamadas, margens de reserva, tarifas e conciliação real; owner: controlador/financeiro. Não prometer hard cap absoluto |
| Identidade/sandbox de produção ainda não testados | Crítica / não medida | Service identities, expiração/rotação, revogação em voo, auth de deployments e sandbox/MCP; owner: segurança |
| Cérebro testado apenas em naive e ACL grosseira | Alta / escopo conhecido | Corpus representativo, grafo/híbrido, permissões por fonte/tempo/proveniência; owner: Knowledge API |
| Recuperação só em pontos e falhas selecionados | Alta / não medida | Kill em fronteiras diferentes, SQLite/PostgreSQL, backup/restore e migrações; owner: runtime/operação |
| AgentScope Service ainda não qualificado no comparativo | Média / incerteza conhecida | Só reabrir se reduzir custo/complexidade sob o mesmo contrato; owner: arquitetura |
| OpenAgents entrega pelo menos uma vez | Alta / observada | Inbox durável por consumidor e identidade de evento/payload; owner: colaboração |
| Implantação por cliente e governança integral não provadas aqui | Crítica / não medida | Isolar dados, secrets, logs, políticas, orçamento e backup; owner: plataforma |

Permanece NO-GO para produção. Não implementamos token TTL, autenticação federada, sandbox de execução arbitrária, MCP real, limites de contratação, estratégia A4 nem recuperação automática de todas as execuções. A rota settle-cancel confia no host autorizado: o teste verifica a saída real do Popen, mas a API não é prova criptográfica de terminação de processo remoto. O provedor simulado garante chave/lookup; APIs reais podem não garantir. Esses limites não foram ocultados por uma suíte verde.

## Arquitetura preservada e próximo passo concreto

Continuam obrigatórios: instalação dedicada por cliente; um cérebro persistente por instalação; equipes por capacidade e colaboração transversal; contratação permanente com aprovação; temporários dentro de policy; Chief of Staff como comunicação/síntese; controlador adaptativo como seleção/risco/orçamento; um único dono do workflow; UI JARVIS funcional própria React/TS/Three.js; camada empresarial candidata TypeScript e runtime Python; sem NestJS imposto, sem infraestrutura injustificada e sem reimplementar LightRAG/Graphiti/motores.

O Python desta pasta é harness, não decisão de trocar a camada empresarial TypeScript. O teste A3 fixo não transforma o produto em equipe fixa. Graphiti e conhecimento temporal continuam em avaliação. Testar duas empresas num serviço de laboratório não muda o deployment dedicado por cliente.

**Próxima entrega recomendada:** desenho mínimo de integração baseado em LangGraph, com contratos de Knowledge, aprovação, orçamento, efeitos e eventos já exercitados aqui; decidir se Paperclip será o componente de governança e se OpenAgents agrega colaboração necessária. Depois qualificar esse desenho em PostgreSQL/deployment dedicado e corpus representativo, antes de construir a UI ou liberar efeitos reais. Isso preserva o reuso e evita começar o produto inteiro em cima de uma aprovação incompleta.

## Evidência primária e documentação

- Código e linhas em `SOURCE_TRACE.md`, no SHA registrado; ambientes e hashes em `manifest.json`.
- O uso de interrupt/Command e checkpoint foi confrontado com a [documentação oficial LangGraph](https://docs.langchain.com/oss/python/langgraph/interrupts), além do código fixado.
- O [repositório oficial AgentScope](https://github.com/agentscope-ai/agentscope) descreve SDK e Agent Service; nossa conclusão específica depende dos testes locais, não da apresentação do projeto.
- Consultas web não substituíram os clones. Uma abertura da página persistence falhou no navegador de pesquisa; o código local e a página interrupts foram usados para verificar o contrato.


## Investigação posterior de produção

A rodada seguinte investigou cérebro/integridade/ACL, identidade, sandbox, custos e operação por cliente. Foram reproduzidos riscos de informação confidencial no grafo compartilhado e limitações da ingestão direta. Os testes PostgreSQL canônico e saver nativo passaram, inclusive após queda abrupta, mas produção permanece NO-GO. Consulte o [parecer de preparação para produção](../production-readiness/REPORT.md). A investigação preserva os resultados históricos acima.
