# Resultados — 04/11/2026

**PASS no recorte semântico nativo; continuar com LightRAG. Produção desta versão permanece NO-GO.**

Um teste E2E, oito checkpoints e cinco verificações de resposta passaram. Tempo até o fim das asserções: 398.71 s; duração pytest com cleanup em semantic.log. Quatro documentos sintéticos por geração, g1/g2; não se extrapola para capacidade empresarial.

O caminho testado usa extração/keywords/respostas GPT-6.1 Terra, chunker nativo, embeddings MiniLM ONNX reais, vetores PostgreSQL de 384 dimensões, KV/doc-status PostgreSQL e grafo Neo4j. Não há fixture de entidade/aresta/vetor/resposta nem monkeypatch do extrator nativo. A camada própria mantém identidade, grants, fonte canônica, geração, verificação de atualidade e publicação.

Grafo g1 observado: publico: 7 nós / 5 relações, financeiro: 4 nós / 3 relações. O canário financeiro estava realmente recuperável por perfil autorizado e foi negado para o analista. Revogação posterior ao backup foi preservada após restore e nova ingestão g2. Consulta negada não fez nova chamada ao modelo.

O backup frio restaurou bancos, identidade, grafo e objetos em volumes vazios. A g1 antiga não abriu o gate diante do inventário g2. A reingestão nativa de g2 permitiu retomar consultas atuais; g1 permaneceu consultável explicitamente como histórico autorizado. Nenhuma ferramenta de envio real foi executada.

## Respostas efetivamente observadas

**historical-policy**

A política ACME versão 1 permitia trabalhar remotamente **dois dias por semana**, até 28/02/2026. [1]

### References

* [1] politica-remoto@v1.md

**current-policy**

A política ACME versão 2 permite trabalhar remotamente **três dias por semana** desde 1º de março de 2026. [1]

Ela substitui a versão 1 da política. [1]

### References

* [1] politica-remoto@v2.md

**historical-policy-after-restore**

A política ACME versão 1 permitia trabalhar remotamente **dois dias por semana**, até 28/02/2026. [1]

### References

* [1] politica-remoto@v1.md

**causal-uncertainty**

Não. A relação entre a pausa da campanha e a queda nas vendas é uma **hipótese**, sem causalidade comprovada. A campanha foi pausada em 10 de fevereiro de 2026. [1]

As vendas da ACME caíram de R$ 100.000 em janeiro para R$ 80.000 em fevereiro de 2026, uma redução de 20%. [1]

### References

* [1] vendas-campanha@v1.md

**abstention-missing-target**

Não há informação suficiente no contexto para determinar o valor aprovado da meta de vendas de março de 2026.

Os dados disponíveis informam apenas as vendas realizadas em janeiro e fevereiro de 2026. [1]

### References

* [1] vendas-campanha@v1.md

## Uso e limites

- Execução aprovada: 21 chamadas reais, uso {"input_tokens": 277901, "cached_input_tokens": 193408, "output_tokens": 3109, "reasoning_output_tokens": 25}.
- Tentativa anterior que falhou na inspeção SQL: 5 chamadas reais, preservadas separadamente. Total observado nesta rodada: 26 chamadas, uso {"input_tokens": 344806, "cached_input_tokens": 202496, "output_tokens": 4237, "reasoning_output_tokens": 25}. O limite de 24 era por instalação; não foi apresentado como consumo total de todas as tentativas.
- Custo monetário não medido; não houve recibo de cobrança atribuível. Tokens incluem sobrecarga do CLI, extração, keywords e respostas. Não são uma projeção de custo de API empresarial.
- 30 lotes, 76 vetores calculados (incluindo consultas e entradas repetidas), 0 entradas truncadas, maior entrada 53 WordPiece tokens. Esses vetores calculados não significam esse mesmo número de registros únicos no banco.
- Sem eventos inesperados de ferramentas no Codex. Isso não certifica prompt injection geral ou o gateway MCP do produto.
- Este PASS fecha a ausência de prova integrada com extração/embeddings reais neste corpus pequeno. Não fecha recall/citações em corpus representativo, temporalidade Graphiti, conectores reais, TLS/federação/cofre, custo monetário, carga empresarial, PITR/failover ou implementação completa da organização adaptativa/JARVIS.

## Falhas preservadas

attempt-1: erro de prontidão PostgreSQL, antes do modelo; corrigida a espera pelo listener TCP definitivo. attempt-2: erro da consulta auxiliar de inspeção por capitalização de identificador PostgreSQL; corrigida a fixture. Não se alterou o código LightRAG para fazer o teste passar. Logs de diagnóstico redigidos para retirar senha efêmera da própria fixture; backups e chaves excluídos do pacote. A tentativa final inteira passou, em vez de somar testes incompletos como aprovação.

Os critérios e limites estão em REPORT.md; comandos em COMMANDS.md. A decisão anterior de continuar componentes permanece, agora com evidência semântica integrada mais forte. O próximo bloqueio de conhecimento é qualificar corpus representativo e temporalidade/contradições, preservando a API e um único dono de execução.
