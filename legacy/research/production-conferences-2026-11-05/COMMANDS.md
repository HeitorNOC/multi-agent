# Registro de pesquisa — 05/11/2026

Busca via ferramenta web disponível. Sem acesso ao Google Search/Scholar por sessão autenticada; Google Research consultado como fonte primária de autores. Não alegar pesquisa por uma interface específica que não foi usada.

## Consultas principais

- `site:usenix.org 2025 2026 LLM agents production durable systems`
- `site:proceedings.mlsys.org 2025 2026 agent systems serving orchestration`
- `site:research.google blog agents production multi agent 2025 2026 reliability`
- `site:anthropic.com engineering multi-agent research system`
- `site:dbos.dev durable agents production recovery paper VLDB 2025 2026`
- `site:restate.dev blog production AI agents recovery customer`
- `site:aclanthology.org 2025 multi agent failure MAST tau bench`
- `Why Do Multi-Agent LLM Systems Fail NeurIPS 2025 MAST paper`
- `DBOS durable execution VLDB 2025 paper reliable workflow`
- `site:uber.com/en engineering agents LangGraph Genie`
- `site:engineering.atspotify.com agent fleet production 2025 2026`
- `site:stripe.dev minions agents production 2026`
- `site:usenix.org 2026 agent prompt injection AIOps Pasquini`
- `site:proceedings.mlr.press HippoRAG 2 2025`
- `site:aclanthology.org LightRAG 2025 graph retrieval`
- `site:usenix.org Agentix nsdi26 artifact github`
- `site:research.google scaling agent systems paper 2026 conference`
- Títulos MASS/CATS/scaling + `site:openreview.net` para conferir diferença entre submissão e aceite.
- `Making Genomic Data Transfers Fast, Reliable, and Observable VLDB` — não estabeleceu publicação em conferência; tratado como preprint/caso.

## Inspeção e refinamento

1. Abrir páginas primárias, localizar seção relevante com `find`, ler trechos de método/avaliação/limites com `open`. Buscas genéricas retornaram ruído, páginas comerciais e fontes secundárias; estas não fundamentam o parecer.
2. Uber Finch: arquitetura, dados curados e avaliação de resultados SQL/roteamento/regressão. Uber identidade: seções Architecture, Registry, STS, MCP Gateway e contexto propagado na aplicação.
3. Stripe: ambas as partes, sobretudo Blueprints, MCP e isolamento. Anthropic: arquitetura, delegação, avaliação e confiabilidade. BMS: caso + registro arXiv; não confundir transferência de dados com agentes.
4. MAST: PDF dos anais, conjunto de traces/taxonomia e limitação de cobertura. ICML failure attribution e ACL MultiAgentBench: registros e resumos oficiais, sem declarar leitura integral dos PDFs.
5. CIDR: PDF, seção 6.1 External Services e avaliação de protótipo. O próprio texto delimita chamadas externas e intervenção humana.
6. AIOps: página USENIX + PDF **prepublication** consultado, seção de avaliação (180 trials, juiz LLM e revisão parcial) e generalização da defesa. Não executar ferramentas de ataque.
7. Agentix: inicialmente um clique abriu o ícone PDF; descartado como evidência. Clique correto abriu `nsdi26-luo.pdf` final. Lidas implementação/avaliação/baselines/métricas. Nenhum selo de artefato assumido.
8. CATS/BATS: consultadas v1 e v2 HTML e registro Google. A checagem adicional do corpo v2 revelou que ainda usa BATS, apesar de CATS no resumo Google. Corrigida a hipótese inicial de renomeação entre versões; divergência preservada sem escolher uma nomenclatura como prova. Lido apêndice G sobre limites conjuntos e alocação. MASS: cópia anônima submetida a ICML 2025 não comprova aceite; registro Google Research e histórico OpenReview apontam ICLR 2026 Poster.
9. LightRAG: método de avaliação por juiz LLM. PropRAG: métricas, baselines herdados, custos e comparação factual; não usar snippet de tabela para classificar uma métrica sem seu cabeçalho. Evitados números de ranking na recomendação. HippoRAG 2: registro ICML e código indicado; não testado.
10. Fontes de Restate/DBOS encontradas sobre recovery/versioning: úteis como contraponto comercial, mas não aceitas como prova neutra de superioridade, nem motivo para instalar segundo scheduler. Spotify/Uber software factory apareceram na triagem, sem inspeção suficiente para decisões principais.

Artefatos novos: REPORT.md, COMMANDS.md. Índices README/STATUS atualizados com ligação ao estudo. Nenhuma mudança no código da PoC, pins ou resultados de teste históricos; zero inferência e zero benchmark executado. URLs/versões consultadas estão no parecer; páginas web permanecem mutáveis, não são snapshots imutáveis com hash como os repositórios da rodada anterior.
