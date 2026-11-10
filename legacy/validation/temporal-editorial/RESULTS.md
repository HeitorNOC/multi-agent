# Resultados — 04/11/2026

**Avançou o protótipo editorial e de publicação. A aceitação temporal completa do Graphiti falhou; produção não aprovada.**

| Ensaio | Resultado observado |
|---|---|
| Editorial TypeScript | 10 testes PASS, typecheck strict PASS |
| Graphiti + GPT-6.1 Terra | 3/7 critérios, pytest FAIL em 218.47 s |
| Graphiti + GPT-6.1 Sol | 6/7 critérios, pytest FAIL em 232.24 s |
| Falha entre grafo e commit editorial | E2E PASS em 123.88 s, reinício e conciliação sem reingestão |
| Obsidian | Vault compatível entregue; aplicativo não encontrado nos dois caminhos verificados; UI não testada |

Os tempos da tabela vêm do testsuite XML; o console inclui um pequeno overhead adicional de pytest.

## Evidência temporal

- january_after_march_update: esperado 2; Terra [2, 3] (FAIL); Sol [2] (PASS).
- february_before_retroactive_correction: esperado 2; Terra [2, 3] (FAIL); Sol [2] (PASS).
- march_after_update: esperado 3; Terra [3] (PASS); Sol [3] (PASS).
- january_after_backdated_correction: esperado 2; Terra [2, 3] (FAIL); Sol [2] (PASS).
- february_after_backdated_correction: esperado 1; Terra [1] (PASS); Sol [1] (PASS).
- march_unchanged_by_backdated_correction: esperado 3; Terra [3] (PASS); Sol [3] (PASS).
- what_was_known_before_correction_about_february: esperado 2; Terra [] (FAIL); Sol [] (FAIL).

Terra gerou uma relação textual de dois dias com atributo dias_remotos=3; a mesma aresta apareceu em três verificações. Sol corrigiu essa inconsistência neste corpus. Nos dois modelos, a consulta de fevereiro no instante de conhecimento anterior à retificação retornou vazia. Os dados brutos, prompts e registros nativos foram preservados; não houve reparo manual de arestas/datas ou mudança do critério.

O diagnóstico somente lê os registros capturados. Depois da correção, os limites invalid_at atuais não recuperam a fronteira antiga. Remover apenas o predicado expired_at ainda não produz os registros esperados para esse corte. Esse é um limite do contrato/configuração testados; não prova impossibilidade universal de Graphiti. Não apresentamos os seis PASS de Sol como aprovação dos sete requisitos.

## Editorial e fonte canônica

O backend autenticado recebe propostas Markdown, exige revisor distinto e hash exato, rejeita mudança de classificação e sobrescrita de versão, publica snapshot imutável e concilia replay de publicação concluída sem novas chamadas ao modelo. Identidades são contas sintéticas de serviço no Keycloak, não um fluxo humano editorial com MFA/federação qualificado.

O módulo TypeScript consegue selecionar a versão da **fonte** por vigência e instante de publicação, inclusive antes/depois de retificação; são testes de componente, não recomputação de fatos Graphiti. A API de fonte canônica foi exercitada no E2E adicional com uma fonte: snapshot original após edição não aprovada, e ausência antes de sua publicação. O caso de três versões é testado no componente, sem inferir que toda a integração multiversão foi homologada.

A falha injetada deixou o grafo gravado em graph_ready e consultas 503. O restart manteve o bloqueio. A conciliação usou o snapshot aprovado original apesar de o arquivo ter sido alterado, não fez novas chamadas ao modelo e manteve uma identidade de publicação/episódio. O ramo em que a própria ingestão Graphiti tem resultado incerto continua bloqueado para conciliação específica; não se afirmou exactly-once nativo.

## Falhas e adaptações

- Inicialização duplicada de índices e limite de processos da fixture: corrigidos antes dos ensaios de aceitação; pids 128→256, memória 1 GB/CPU 1 mantidos. Primeira falha preservada em attempt-1, sem modelo invocado.
- Dependências httpx/asyncpg: instalação explícita via cache offline após diagnóstico e falha DNS registrada. Sem alteração de upstream.
- Typecheck inicialmente CommonJS: package.json passou a declarar ES module, acompanhando o runtime Node.
- Comparação lexicográfica de datas no componente canônico: teste de fração de segundo mostrou erro; corrigido com comparação temporal SQLite, regressão red/green preservada.
- Ensaios nativos Terra e Sol continuaram FAIL quando um requisito falhou. A prova adicional positiva não apaga essas reprovações.

## Consumo e operação

- terra: 17 chamadas, modelos ['gpt-6.1-terra'], uso {"input_tokens": 230857, "cached_input_tokens": 93312, "output_tokens": 1193, "reasoning_output_tokens": 25}.
- sol: 15 chamadas, modelos ['gpt-6.1-sol'], uso {"input_tokens": 205398, "cached_input_tokens": 29952, "output_tokens": 1194, "reasoning_output_tokens": 166}.
- publication: 3 chamadas, modelos ['gpt-6.1-sol'], uso {"input_tokens": 40648, "cached_input_tokens": 0, "output_tokens": 194, "reasoning_output_tokens": 0}.

Total observado: 35 chamadas. Sem fatura ou custo monetário atribuível retornado; não se convertem tokens em cobrança medida. Os prompts do CLI incluem sobrecarga de instruções. Embeddings locais: 85 vetores calculados e 0 entradas truncadas, incluindo consultas/repetições; não é contagem de registros únicos.

Serviços e dados são reais no recorte de infraestrutura, mas todo conteúdo é sintético. Telemetria Graphiti desabilitada. Instalações descartáveis por prefixo próprio, com registros de cleanup. Nenhum deployment de produção, mensagem real, compra de serviço ou dado empresarial confidencial.

## Limites que permanecem

Não houve qualificação de UI Obsidian, sincronização, Markdown/YAML arbitrário, corpus representativo, coabitação LightRAG+Graphiti, backup conjunto do novo ledger SQLite/PG/grafo, múltiplos writers, ingestão incerta, SSO humano/TLS/cofre, cobrança financeira, carga empresarial ou PITR/failover. O ledger SQLite é uma bancada; a camada de produto deverá consolidar persistência/relógio/outbox no desenho PostgreSQL da instalação. A seleção canônica assume marcos de vigência que substituem a regra anterior dessa fonte; não prova intervalos arbitrários, exclusões e contradições entre várias fontes.

A decisão detalhada está em DECISION.md. A arquitetura principal permanece; Graphiti é candidato a projeção de apoio e não a autoridade exclusiva da história de conhecimento. O próximo passo é integrar seleção da fonte canônica ao LightRAG e preservar snapshots das decisões, antes de ampliar autonomia.
