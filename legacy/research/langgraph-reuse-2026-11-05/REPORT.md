# Reutilização de soluções LangGraph — 05/11/2026

**Conclusão: grande parte da lógica solicitada já existe e deve ser reutilizada.** A direção recomendada é adaptar os mecanismos nativos do LangGraph e os padrões oficiais, mantendo nossa camada empresarial restrita aos contratos específicos. Os FAIL anteriores mostram lacunas da nossa integração; não demonstram ausência de solução conhecida para orquestração e recuperação.

Esta pesquisa atende à orientação mais recente do usuário: buscar implementações existentes, inclusive no YouTube, antes de continuar construindo o núcleo por conta própria. Não se aprovou produção, não se apagaram os negativos e não houve chamada de modelo nesta rodada.

## O que encontramos e o que reutilizar

| Necessidade | Solução existente | Aplicação ao nosso caso |
|---|---|---|
| Checkpoint e retomada em outro processo | [Checkpointers LangGraph](https://docs.langchain.com/oss/python/langgraph/checkpointers), incluindo PostgreSQL e pending writes | Manter saver oficial e thread estável; retomar apenas trabalho incompleto |
| Evitar recalcular operação já concluída dentro de um nó | [Functional API: entrypoint/tasks](https://docs.langchain.com/oss/python/langgraph/functional-api) | Envolver inferência/consulta cara em tarefas duráveis onde apropriado, sem fabricar outro motor de replay |
| Falha transitória, timeout e escalonamento | [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance) | Usar RetryPolicy, TimeoutPolicy e error handlers. Separar erro transitório de desfecho desconhecido; heartbeat do runtime não renova automaticamente nosso lease empresarial |
| Supervisor e especialistas com contexto separado | [Subagents oficial](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents) | Implementar catálogo por capacidades sobre o padrão já documentado, com ferramentas/ACL delimitadas por agente |
| Planejamento e delegação já empacotados | [Deep Agents SDK](https://docs.langchain.com/oss/python/deepagents/overview) | Candidato concreto para o harness do CoS/especialistas, usando LangGraph por baixo; ainda não instalado ou executado nesta pesquisa |
| Gerenciamento pronto de threads/runs/fila/cancelamento | [Agent Server](https://docs.langchain.com/langsmith/agent-server) | Avaliar como runtime de implantação, em vez de duplicar controles de execução; configuração e condições comerciais precisam ser verificadas |

Não é necessário inventar um mecanismo geral de checkpoints, retries ou supervisão. Continua necessária a adaptação de negócio: grants atuais, plano/payload aprovados, reserva de orçamento, fontes canônicas, recibos, anti-rollback e o protocolo com a autoridade assinada. Um checkpoint não torna atômicos três bancos/serviços independentes.

## Código real e manutenção

Foram guardados **nove arquivos selecionados** em commits fixados, incluindo licenças e código. Não houve clone/auditoria integral nem execução dos novos SDKs. [Manifesto de fontes](source-manifest.json).

| Projeto | Estado consultado | Decisão de reutilização |
|---|---|---|
| LangGraph já instalado | 1.2.19, SHA `3c916d750575b22c464790e9774494d810ccd322`, sem diff no clone | Usar agora os mecanismos nativos; prova dirigida executada abaixo |
| Deep Agents | 0.7.32, SHA `6cd647ba201d4612aeaa2d49d9588bd6e46ce250`, repositório não arquivado | Priorizar avaliação do harness extensível. `create_deep_agent` recebe `subagents`, `checkpointer` e `interrupt_on` e retorna grafo compilado; não é outro motor concorrente |
| LangGraph Supervisor | SHA `88859b34017ac3569bbd4a3092c7e77593a0a960`, arquivado | Referência didática. O próprio README recomenda supervisor por ferramentas para a maioria dos casos; não escolher o pacote antigo só porque aparece em vídeo |
| Open Deep Research | SHA `1b7d2e80db9faa586165c60e09096dbbfd483a64`, arquivado | Referência de aplicação: supervisor, pesquisadores, saídas estruturadas e limites de concorrência. Não adotar como plataforma empresarial pronta |

A inspeção de `Deep Agents` encontrou uma adaptação concreta de dependências: seu metadata exige Python >=3.11, `langchain>=1.4.9` e `langchain-core>=1.7.5`. Nosso ambiente tem Python 3.12.14 e `langchain-core 1.7.4`, sem os pacotes `langchain` e `deepagents`. Portanto sua adoção exige ambiente isolado e compatibilidade testada; não foi feita atualização silenciosa do ambiente existente.

As fontes selecionadas preservam os avisos/licenças originais. MIT desses arquivos não aprova automaticamente todos os ativos, modelos ou produtos comerciais relacionados.

## YouTube: referências localizadas

| Vídeo | Utilidade e ressalva |
|---|---|
| [Building Deep Agents and Deploying in Production — LangChain/Robert Xu](https://www.youtube.com/watch?v=IZabCqyBJLg) | A descrição indexada cobre durable execution, memória, autenticação e revisão humana. Referência direta para produção/harness |
| [Hierarchical multi-agent systems with LangGraph — LangChain](https://www.youtube.com/watch?v=B_0TNuYi56w) | Supervisor e handoffs; relacionar ao estado atual do pacote, hoje arquivado |
| [Building LangChain and LangGraph 1.0 — LangChain](https://www.youtube.com/watch?v=r5Z_gYZb4Ns) | Arquitetura do runtime, middleware e composição; verificar diferenças com 1.2.19 |
| [How to Build Multi AI Agents with Langgraph — Kenny Liao](https://www.youtube.com/watch?v=rwqGQEzXF-o) | Tutorial com comparação de padrões e código associado na descrição; pista de implementação, sem homologação de produção |
| [Building Effective Agents with LangGraph](https://www.youtube.com/watch?v=aHCDrAbH_go) | Link indicado na própria página oficial Built with LangGraph |

**Acesso efetivo:** vídeos foram encontrados na busca, com descrições/metadados indexados. O acesso direto devolveu rodapé ou cache miss; não houve leitura integral de transcrições nem inspeção audiovisual completa. Não se afirma ter assistido aos vídeos. As conclusões técnicas acima foram confrontadas com documentação e código primários; resumos de terceiros/transcritores encontrados não sustentam o parecer.

## Aplicações reais e limite da evidência

O [caso Replit publicado com LangChain](https://www.langchain.com/breakoutagents/replit) descreve gerente, editores e verificador, com participação humana. O [relato técnico da Elastic](https://www.elastic.co/blog/building-automatic-import-attack-discovery-langchain) descreve LangGraph nos fluxos ES|QL e Automatic Import. São relatos de implementação dos envolvidos, não execução nossa nem código completo que possamos copiar.

O [blog de engenharia LinkedIn](https://www.linkedin.com/blog/engineering/generative-ai/behind-the-platform-the-journey-to-create-the-linkedin-genai-application-tech-stack) descreve uma camada fina própria sobre LangChain e integração com a infraestrutura empresarial; o texto consultado não menciona LangGraph, então não serve sozinho como prova específica desse motor. A lição aproveitável é reutilizar o framework e adaptar as fronteiras do negócio, sem atribuir ao artigo garantias que ele não apresenta.

Encontramos também uma [demonstração da comunidade Temporal](https://github.com/temporal-community/temporal-ai-hitl-adk-langgraph) que preserva espera humana após queda. O próprio README atribui ao Temporal a espera durável. Isso é uma alternativa com responsabilidade de execução diferente; não será acrescentada por padrão, pois o usuário escolheu LangGraph como owner. Demonstração de conferência não é SLA de produção.

## Prova executada nesta rodada

**1 E2E PASS, quatro checkpoints, 10,92 s**, PostgreSQL real, sete invocações de subprocessos no ensaio final, zero modelos. [JUnit](native.xml), [log](native.log), [evidência estruturada](evidence/results.json). O helper iniciou a bancada existente apenas como infraestrutura; o objeto da prova foi o runtime nativo, não a API/ledger empresarial completo.

1. `@task` concluída antes de `interrupt` foi reutilizada por outro processo com `Command(resume=...)`: mesmo valor e contador igual a um.
2. Dois nós paralelos: um concluiu e o outro falhou. Em novo processo, o nó bem-sucedido não se repetiu (`a=1`, `b=2`), demonstrando pending writes.
3. Fornecedor sintético persistiu efeito e o processo saiu com código 88 antes de confirmar o resultado ao grafo. Nova tentativa usou a mesma admissão/chave: duas chamadas ao fornecedor, **um efeito**, mesmo recibo. O fornecedor foi construído para honrar idempotência; isso não prova o contrato de qualquer API externa.
4. `RetryPolicy` nativo recuperou uma falha transitória na terceira tentativa, dentro do limite de três.

**Negativo preservado:** a primeira execução falhou em 10,60 s no caso de queda precoce: `invoke(None)` encontrou `EmptyInputError`, sem checkpoint recuperável. Aplicamos a admissão durável fora do grafo, conservando o input original, conforme o padrão de outbox indicado na documentação. O ensaio inteiro foi repetido. [JUnit anterior](native-first.xml), [captura anterior](evidence/first-results.json). Não se alterou o upstream nem se chamou um efeito novo com outro ID para esconder a falha.

Essa prova não requalifica os quatro FAIL de V1, não executa Deep Agents/Agent Server nem comprova perda de host, custo real ou carga empresarial. Ela demonstra que os mecanismos/padrões reutilizáveis funcionam no recorte e identifica a fronteira que nossa integração deve adaptar.

## Adaptação recomendada para os pontos que falharam

| Falha/necessidade nossa | Adaptação usando solução existente |
|---|---|
| `read_commit`: negócio e recibo local em transações separadas | Transação PostgreSQL que persiste resultado e recibo/outbox empresarial conjuntamente; chave estável e lookup do comando, antes de decidir qualquer repetição. Conciliação qualificada com o head assinado, sem apagar intenção pendente |
| Confirmação externa perdida | Retry somente com contrato idempotente comprovado; consultar recibo por ID. Não interpretar ausência de checkpoint como efeito ausente |
| Inferência unknown sem recibo | Rota de erro/interrupt no LangGraph e ferramenta de revisão governada; dois revisores e evidência retida permanecem requisitos próprios. Sem recibo ou autorização explícita de substituição, não repetir o original nem devolver quota |
| Coordenação e contexto dos especialistas | Harness/subagentes oficial e entradas por capacidade; fonte ausente bloqueia a tarefa. Preservar respostas intermediárias recuperáveis, escopo de ferramentas e política de escalonamento A0–A4 |
| Metadado de aprovação divergente no V3 | Aprovação deriva da camada TypeScript/plano autorizado, exposta ao grafo/UI como autoridade. O campo produzido pelo LLM é proposta, não grant |
| Duplicação de controles de run/worker | Deixar execução/checkpoints/retomada sob LangGraph; API empresarial expõe projeção do estado e mantém somente suas políticas/contratos. Avaliar Agent Server se sua gestão pronta reduzir operação própria |

**Sequência concreta:** adaptar primeiro admissão/resultado idempotentes e a transação de recibo/outbox, reaproveitar tasks/retries/interrupts, então repetir precisamente os casos vermelhos de V1. Avaliar Deep Agents em ambiente isolado para CoS/equipes, sem reimplementar seu harness nem trocar o motor escolhido. Agent Server fica como opção comercial de implantação, sem compra ou adoção presumida.

O [self-hosted da plataforma LangSmith](https://docs.langchain.com/langsmith/self-hosted) é descrito como add-on Enterprise. Não inferir que toda combinação de Agent Server/deployment tenha o mesmo preço/licença; examinar a oferta concreta antes de torná-la dependência por cliente.

Permanecem instalação dedicada, cérebro central, LightRAG, TypeScript empresarial + IA Python, capacidades dinâmicas, controlador A0–A4, JARVIS, Obsidian opcional, ACL/histórico, orçamento e recuperação com autoridade. A recomendação é adaptar componentes existentes, com uma camada própria mais fina — sem declarar os testes antigos aprovados por documentação ou vídeo.
