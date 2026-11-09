# Resultados observados — 04/11/2026

Decisão: continuar a arquitetura por componentes e o piloto restrito; **NO-GO para produção desta versão**. Fundamentação completa em DECISION.md.

- Integração final: um teste E2E PASS, 11 checkpoints, 258.40 s até o fim das asserções; duração pytest incluindo cleanup em decision.log. Serviços reais, extração/vetores sintéticos.
- Recuperação: g1 coerente recusada por inventário atual g2; seis respostas inválidas/indisponíveis negadas; g2 republicada; revogação mantida; mudança posterior de sequência fecha gate. Inventário externo é simulador, não ERP real.
- Efeitos: 2 envios e 2 recibos no provedor simulado, correspondentes à ação histórica já executada e à nova decisão g2. Ausência de recibo histórico não provoca send. Aprovação antiga não habilita execução.
- Login humano sintético: authorization code + PKCE S256, state e nonce, JWT assinado, proibição de escalada, replay de code/PKCE incorreto recusados e revogação no cadastro da aplicação. Sem federação real, MFA ou TLS; cookie policy permissiva somente no loopback HTTP da fixture.
- Carga: 40 consultas, concorrência 5, erros 0, p50 0.0274 s, p95 0.2375 s. Há cache, corpus minúsculo e nenhum LLM no caminho medido. Não usar como previsão empresarial.
- Admissão concorrente: 32 tentativas, 23 admitidas, gasto sintético 6, reserva 92, limite 100; sem ultrapassar saldo. Não mede dinheiro nem fairness/filas distribuídas.
- Modelo real: GPT-6.1 Terra, 7/7 casos no mesmo lote, 20.24 s de CLI. Respostas revisadas quanto a política atual/histórica, 20%, causalidade hipotética, abstenção e instrução hostil. Nenhum evento de ferramenta. Índice de origem ainda usa fixtures de extração/embedding.
- Uso real observado no probe + benchmark: 28952 tokens de entrada, 0 em cache, 470 de saída. Custo monetário **não medido**: CLI não retornou fatura ou débito atribuível. A sobrecarga de instruções do CLI está incluída; não é contagem isolada do prompt empresarial.
- Embeddings reais locais: 6/6 top1 e 6/6 top3, 36 documentos, 384 dimensões. Benchmark denso isolado com MiniLM ONNX quantizado; revisão e hashes fixados. Não substitui a prova integrada semântica LightRAG/Graphiti.
- Executor isolado: quatro capabilities inválidas/repetidas recusadas; sem credenciais, egress e escrita privilegiada; cancelamento com filho; dois contêineres próprios removidos. Perfil de componente, não implantação de gateway MCP.
- Avisos Python: 91 entradas, uma não auditável (LightRAG 1.5.8 indisponível no catálogo), sem avisos conhecidos nas demais. Não é auditoria de segurança completa.

## Falhas preservadas

`attempt-1`: PASS sem os ensaios humanos posteriores, 272,92 s. `attempt-2`: FAIL em 302,90 s na fixture de login humano; Keycloak registrou cookie_not_found no HTTP loopback. Adaptação explícita da política de cookies do cliente de teste, sem alegar conformidade HTTPS. A tentativa final precisa passar integralmente; não se soma PASS antigo com FAIL novo para produzir aprovação. A primeira invocação pip-audit usou flags incompatíveis, foi preservada e corrigida. O worker com exit 1 por perda de ACK do provedor é falha deliberadamente injetada, exigida pelo teste.

Durante a preparação foram acrescentados captura imutável do contexto do benchmark e tratamento de timeout do inventário. A captura usada pelo modelo fica em model-input-context.json e seu hash foi conferido; a consulta da última instalação fica em model-context.json. Não houve novas chamadas ao modelo para adaptar respostas ao gabarito.

## Limites operacionais

A recuperação depende de inventário confiável, diário externo, provedor e chaves retidas pelo operador. Backups são frios; nenhuma medição de RTO/RPO/PITR/failover. A verificação HTTP assinada não demonstra autenticidade/completude dos conectores reais nem elimina janela distribuída entre verificação e efeito. Sandbox usa rede none; DB/grafo/IdP usam bridge com localhost, sem qualificação de egress desses serviços. Nenhuma mensagem ou transação empresarial real foi executada.
