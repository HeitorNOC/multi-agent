# Qualificação do caminho semântico nativo

## Pergunta desta rodada

O LightRAG fixado consegue ingerir documentos portugueses, extrair entidades/relações com modelo real, gravar vetores pré-treinados e grafo em servidores reais, responder com fontes e preservar versões/permissões ao restaurar um backup? O resultado efetivo está em RESULTS.md; não se confunde com os smoke tests separados da rodada anterior.

## O que mudou

- Reutilizado o LightRAG no SHA `aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a`, sem monkeypatch de `_process_extract_entities`, sem chunker/embedding/extrator sintéticos.
- Ingestão nativa `ainsert`, chunker/tokenizer nativos, journal/doc-status PostgreSQL. Sem `ainsert_custom_kg` e sem fabricar nós/arestas na camada empresarial.
- GPT-6.1 Terra executa os prompts reais do LightRAG: extração, palavras-chave, eventuais resumos e geração. Adaptador usa saída JSON de transporte com um campo text; devolve o texto bruto ao parser nativo. Não reescreve triples nem calcula respostas esperadas.
- Embeddings ONNX de `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, artefato Qdrant quantizado na revisão `faf4aa4225822f3bc6376869cb1164e8e3feedd0`. Os sete arquivos são conferidos pelos hashes registrados na rodada anterior. Inferência offline; sem download/código remoto. Vetores reais de 384 dimensões persistidos em PGVectorStorage; PGKVStorage/PGDocStatusStorage e Neo4JStorage reais.
- Geração pelo próprio `aquery_llm`, com recuperação modo `mix` (grafo e chunks vetoriais), keywords nativas e referências nativas. Não se fornece ao sintetizador um corpus inteiro montado manualmente nem keywords fixas. Não se usou reranker nesta rodada.
- Mantidos OIDC Keycloak, principal da aplicação, grants antes de recuperar ou usar cache, corpus canônico versionado/hashes e workspace por instalação/geração/domínio.

A arquitetura continua com um único owner de workflow LangGraph; não foi adicionado outro runtime. Esta prova focaliza o cérebro; não repete ou requalifica automaticamente a organização dinâmica, ferramentas e workflow completo anteriores.

## Aceitação definida antes das chamadas

Um teste E2E percorre quatro fontes sintéticas em g1 e g2: política remota versionada, vendas/campanha com causalidade explicitamente incerta, comentário hostil sem autoridade e aquisição financeira com canário. Exige nós e arestas realmente extraídos nos dois domínios, dados vetoriais de 384 dimensões consultados no PostgreSQL e doc-status processado antes da publicação.

Exige resposta da política g1 com dois dias e g2 com três, referência nativa correspondente e citação numérica; abstenção para meta de março ausente; ausência de alegação causal comprovada no caso da campanha; nenhuma exposição de canário privado em respostas públicas. Financeiro autorizado deve recuperar o canário, demonstrando que o controle negativo protege dado que efetivamente está no índice. Após revogação, consulta negada deve ocorrer antes de outra chamada ao modelo.

O teste faz backup frio real de bancos, identidade, grafo e objetos; restaura em volumes vazios; inventário externo simulado mais atual mantém o gate fechado até g2 ser reingerida pelo caminho real. Revogação pós-backup é reaplicada. Consulta histórica g1 e atual g2 continuam distintas. A leitura de um resultado persistido em cache após restore pode evitar nova inferência; a resposta original continua tendo sido produzida pelo modelo real.

## Limites mantidos

- São quatro documentos curtos por geração, um modelo e um caso por requisito. O PASS só qualifica viabilidade integrada nesse recorte, não relevância/recall em corpus representativo, garantia estatística, idiomas gerais ou capacidade empresarial.
- Chunk size 64, overlap 8, uma rodada de extração (`entity_extract_max_gleaning=0`) e concorrência de LLM 1 limitam custo. Não são valores otimizados de produção. Keywords e respostas não foram substituídas por gabaritos.
- Modelo de embeddings suporta 128 WordPiece tokens e pode truncar. O serviço registra comprimento/truncamento em cada entrada. A contagem nativa de contexto LightRAG não é o tokenizer WordPiece do encoder; devem ser observados os números efetivos, não presumida equivalência.
- O CLI usa instruções e autenticação da conta Codex; tokens incluem sua sobrecarga. Há limite local de 24 chamadas por instalação. Não é adaptador empresarial definitivo, fatura monetária, licença de serviço multiusuário ou medição de custo por agente.
- A exceção contém somente fontes sintéticas; a inferência financeira da ingestão é autorizada para esse corpus de teste. Nenhum documento empresarial confidencial foi enviado.
- Inventário atual e provedor externo continuam simuladores. Chaves/diário e recibos externos permanecem disponíveis ao operador. Sem PITR/HA/failover, TLS/federação/cofre ou desastre de chaves qualificados. Serviço local de embeddings usa HMAC em HTTP loopback, não implantação de rede empresarial.
- Versionamento g1/g2 não substitui temporalidade bitemporal Graphiti, tratamento completo de contradições, vigência empresarial ou trust tiers. O comentário hostil não autoriza ferramentas; a ausência de tool events no CLI não certifica resistência geral a prompt injection.
- A camada empresarial efetiva continua exigindo Chief of Staff, Adaptive Controller A0–A4, equipes dinâmicas por capacidades e contratação permanente aprovada. Não reduzimos o produto a este teste de RAG.

## Regra da decisão

Se o caminho nativo passar, manter LightRAG como candidato de conhecimento e avançar para corpus/temporalidade representativos; não trocar todo o stack por lacunas de integração resolvidas. Se falhar, registrar se é erro da bancada, do adaptador, do contrato nativo ou de qualidade do modelo. Corrigir bancada não conta como correção de upstream. Uma resposta sem suporte ou vazamento não pode ser reclassificada como PASS apenas por afrouxar o gabarito.

Mesmo com PASS, esta versão não está liberada para produção. A rodada reduz o bloqueio específico de fixtures semânticas no recorte integrado; permanecem os gates de implantação/produto registrados na decisão anterior.
