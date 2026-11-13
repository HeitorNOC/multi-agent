# Demonstração executável — 05/11/2026

**Jornada entregue e testada:** Chief of Staff → dois especialistas → fontes LightRAG → síntese → aprovação vinculada ao conteúdo → efeito simulado → retomada em novo processo. Interface React local disponível; sem login corporativo, Keycloak ou OpenFGA.

## Resultado observado

- Teste integrado **PASS em 35,77 s**, com cinco checkpoints de aceite em [journey.json](evidence/journey.json). Três chamadas de ingestão e quatro de análise real até esse ponto; nenhuma geração simulada apresentada como modelo.
- Fontes nativas prontas: vendas de janeiro, vendas de fevereiro e estoque, com versão e hash. PostgreSQL/pgvector, Neo4j e ONNX reais através do LightRAG reutilizado.
- Modelo planejou duas capacidades; especialistas consultaram fontes e a síntese apresentou receita de 10.000 → 8.000, queda de 20%, zero rupturas nos dois meses e causa não comprovada. O backend validou os fatos estruturados desse corpus fechado.
- Retomada em outro processo **antes da aprovação** manteve o trabalho parado e não chamou o modelo novamente. Hash inválido e chamada direta ao efeito sem token foram recusados.
- Aprovação de teste seguida de **saída 88 após registrar o efeito e antes do checkpoint final** deixou o trabalho interrompido. Novo worker retomou e concluiu com o mesmo recibo. Outra retomada de trabalho concluído conservou um efeito e não invocou o modelo. Cinco processos distintos participaram do primeiro trabalho.
- Testes de política/API: **4 PASS**, incluindo fato errado, causalidade estruturada inventada, fonte desconhecida, equipe ampliada, aprovação/hash/payload adulterados, origem indevida, acesso interno sem token e falha controlada de admissão. O teste HTTP usa backend de controle sem modelo; está separado da jornada nativa.
- TypeScript strict passou para API, política, testes e UI. Build React e compilação dos dois workers Python passaram.

## Deixado para o usuário

Uma segunda análise foi iniciada pela interface e chegou a **aguardando aprovação**, com outra síntese real. O usuário pode abrir fontes, revisar destinatário/conteúdo, aprovar, rejeitar ou usar a interrupção controlada. Nenhuma ação foi aprovada nesse segundo trabalho pelo agente.

Até esse estágio: **11 chamadas**, 137.888 tokens de entrada, 50.048 de entrada em cache e 2.248 de saída. Cache é subconjunto da entrada, não soma adicional. Custo monetário não medido. Teto de 16 reservas por sessão; iniciar outro trabalho usa até quatro slots adicionais. Esses números são do ambiente Codex de bancada, não fatura de API comercial ou custo total de produção. [Sessão exportada](evidence/session.json).

## Escopo que esta prova cobre

Integração operável, checkpoint PostgreSQL entre processos, gate de aprovação do payload e deduplicação do **efeito local simulado**. Banco empresarial da demo é SQLite; adaptar para PostgreSQL continua trabalho do produto. O executor não roda código arbitrário. Corpus, identidades e publicação são de desenvolvimento.

Não requalifica os quatro FAIL de V1 em `validation/investment-gate`, não comprova fechamento geral de inferência unknown, backup/restore conjunto, HA/DR, identidade empresarial, controlador A4, sandbox de produção ou escala grande. O protocolo anterior e seus negativos permanecem preservados.

Esta entrega foi autorizada como demonstração delimitada após o usuário priorizar algo palpável. R01–R21 do produto permanecem no desenho; recursos adiados não foram retirados. UI atual é o recorte operacional inicial, com evolução JARVIS/3D preservada.
