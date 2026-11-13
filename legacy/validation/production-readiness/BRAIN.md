# Cérebro empresarial: requisitos para produção

A proposta mantém um cérebro lógico central por instalação, acessível a especialistas por uma Knowledge API autorizada. Uma empresa pode ter domínios e índices separados sem fragmentar a autoridade do conhecimento. O deployment é dedicado ao cliente; não foi convertido em SaaS público.

## Camadas do cérebro

1. **Fontes canônicas:** documentos e registros dos sistemas de origem, IDs estáveis, hashes, versões imutáveis, autoria/origem, ACL, vigência e momento em que o sistema tomou conhecimento. O objeto original e suas referências precisam sobreviver a uma reconstrução de índices.
2. **Projeções de consulta:** chunks, vetores, entidades, relações, índices lexical/híbrido e caches. Reutilizar LightRAG e backend suportado; projeções apontam para fontes/versões e uma geração publicada. Podem ser reconstruídas; não são a única cópia da verdade empresarial.
3. **Conhecimento temporal e episódico:** fatos que mudam com o tempo, contradições, episódios de decisões e execução. Graphiti é candidato pronto para memória temporal; histórico de mensagens ou um checkpoint não substituem essa função. Sua integração deve preservar IDs/proveniência e distinguir fato, hipótese e decisão aprovada.
4. **Contexto de execução:** estado do workflow, plano, participantes, ferramentas e evidências usadas. LangGraph governa esse progresso. Sua persistência não dá, sozinha, autorização ou integridade a todo o cérebro.

## Integridade demonstrada e correção necessária

A PoC anterior alimentava LightRAG por ainsert_custom_kg. No SHA auditado, esse método declara explicitamente ficar fora da garantia de recuperação por documento: pode deixar contribuições sem recovery anchors após falha parcial. Foi apropriado como fixture de pipeline, mas não homologou a ingestão de produção.

Nesta rodada, ainsert foi usado com pipeline/journal reais, extração determinística e storages reais. Três testes passaram: busca híbrida com entidades/relação/chunks, partições autorizadas com revogação antes de cache e exclusão que remove a fonte do retrieval. Sessenta e dois testes upstream selecionados também passaram, cobrindo isolamento, exclusão fail-closed, recuperação, validação e cache. Embeddings/extração continuam sintéticos; qualidade semântica e relevância não foram medidas.

No PostgreSQL real, a fixture verificou hash do conteúdo, referência obrigatória à fonte/versão, proibição de editar versões pelo ingestor, RLS e publicação que recusa uma geração incompleta. Esses controles são exemplos de contrato do catálogo; ainda não são um catálogo de produto conectado a todos os storages do LightRAG.

## Risco de confidencialidade reproduzido

Inserimos uma fonte pública e outra financeira confidencial com entidades comuns no mesmo grafo. O retrieval híbrido real trouxe o segredo nas entidades/relações. Remover apenas chunks confidenciais da resposta não removeu a informação fundida. O teste verde é uma caracterização de risco confirmado, não aprovação dessa configuração.

QueryParam, no SHA avaliado, oferece modos/keywords/budgets, mas não um filtro de ACL documental que por si só autorize toda a expansão de grafo. Workspace separa dados; não deve ser confundido com identidade de usuário.

A mitigação testada autorizou as partições antes de consultar grafo/vetores/cache. Após revogar acesso, a consulta voltou a verificar grants e policy epoch antes de ler cache. Não houve segredo na consulta pública. O wrapper é nosso; não atribuir essa autorização ao LightRAG nativo.

Para produção, escolher e provar uma destas alternativas: partições de índice por classe de acesso, ou retrieval realmente orientado por ACL/proveniência em cada expansão, vetor, reranker e cache. Não basta acrescentar um filtro depois da geração. Uma conclusão derivada de várias fontes deve exigir todas as permissões relevantes, salvo publicação/declassificação expressamente autorizada. O exemplo SQL aplicou esse princípio a facts/fact_sources.

Partições têm custo: duplicação, reconstrução e relações entre domínios. Não criar uma partição por usuário sem analisar a explosão combinatória. A Knowledge API resolve grupos de acesso, versões e política de consulta; especialistas não escolhem workspaces arbitrários.

## Publicação, mudança e exclusão

Ingestão deve seguir descoberta → quarentena/validação → versão canônica → processamento journaled → projeções verificadas → publicação de snapshot. A consulta fixa snapshot/corpus revision, policy epoch e fingerprint de acesso. Não misturar grafo de uma geração com vetores de outra.

Atualizar fonte ou embedding/modelo exige reindexação versionada e teste de compatibilidade. Publicar geração completa por ponteiro atômico, preservando a anterior para rollback. O gate SQL de três partes é apenas uma fixture: ainda falta conectá-lo a manifestos e checksums reais de todos os backends, filas e artefatos.

Revogação deve bloquear o conteúdo antes de reconstruir o índice. Se uma partição misturada não puder responder com segurança, mantê-la indisponível até reparo. Incluir caches de consulta/modelo, snippets, embeddings, relações derivadas, resultados de rerank, memória episódica e checkpoints que contenham o trecho. A exclusão journaled foi demonstrada num backend; retenção, legal hold e exclusão completa entre serviços permanecem pendentes.

## Temporalidade e confiança

O Graphiti fixado em 7e0342a49ce5a04f6415ac2f64ce150bb81b0689 possui valid_at/invalid_at e created_at/expired_at, além de filtros temporais. Dezesseis testes upstream selecionados de helpers temporais e consultas passaram sem banco ou LLM. Isso não qualifica extração temporal em português, contradições empresariais ou consulta distribuída em produção.

Seu SECURITY.md declara que servidores REST/MCP de referência não têm autenticação/autorização e que todos os episódios de um group_id recebem a mesma confiança; um episódio novo pode invalidar fatos antigos. Não expor esses servidores como cérebro de produção. Reutilizar graphiti-core atrás da Knowledge API e validar isolamento, grupos, confiança, ingestão e autorização; não reimplementar o motor temporal apenas para evitar sua integração.

Fonte externa, documento interno aprovado, hipótese de agente e política corporativa não recebem a mesma autoridade. Conteúdo de documento é dado, não instrução para dar privilégios. Resposta de agente não vira automaticamente fato canônico, e consenso entre agentes não é verificação. Contradições devem preservar fontes e intervalos; informação nova não deve sobrescrever uma política só por ter data mais recente.

## Backend e empresa grande

O PostgreSQL 16.15 de teste tinha pgcrypto, mas não pgvector/Apache AGE. Portanto passar nos testes de catálogo/checkpoint não significa que o backend completo LightRAG esteja pronto nesse PostgreSQL.

O código LightRAG no SHA auditado bloqueia AGE a partir de 1.8.0 por incompatibilidade conhecida e contém checagens tanto de extensão SQL quanto de binários. Não contornar o gate por variável de ambiente. Qualificar uma combinação suportada ou um backend de grafo alternativo, como Neo4j, com versões explícitas. Não está aprovada nenhuma versão posterior por presunção.

Multiprocessing/Manager e locks de workspace encontrados no código não são prova de coordenação de writers entre hosts independentes. Antes de escalar ingestão, provar leases/fencing e um modelo suportado de escrita por índice. Pool, locks, migrações e limites de conexão devem ser ensaiados com a topologia escolhida.

Se LightRAG e Graphiti forem usados juntos, devem ter responsabilidade e projeções distintas, com IDs/revisões compartilhados e sem concorrer para definir a verdade. Não pressupor compatibilidade de schema ou edição/licença de múltiplos bancos só porque ambos suportam Neo4j.

## JARVIS e colaboração

A UI continua própria e funcional. Organograma/responsabilidade, equipe temporária de execução e grafo de conhecimento são vistas diferentes que podem se relacionar. Clique em nó/aresta deve trazer fonte, versão e autorização verificadas pelo servidor. Ocultar só o texto e deixar nomes, contagens ou arestas confidenciais também pode vazar informação.

OpenAgents transporta colaboração e referências; não é um segundo cérebro ou controlador. Eventos, traces e anexos também obedecem a ACL. Chief of Staff sintetiza/comunica; controlador adaptativo escolhe capacidades/risco/orçamento; governança decide aprovações; runtime executa; Knowledge API medeia conhecimento. Agentes temporários herdam permissões limitadas, e cargos permanentes exigem aprovação.

## Prova ainda necessária

Corpus em português com fontes contraditórias, versões e datas, documentos públicos/restritos, tabelas/PDFs e injeção de instruções. Medir recall de fontes autorizadas, precisão de citações, resposta correta e abstenção, vazamento por nós/arestas/cache, atualização/revogação e reconstrução após falha. Comparar naive/hybrid/mix com modelos/embeddings reais autorizados. Não promover esta fixture pequena à homologação do cérebro de uma grande empresa.
