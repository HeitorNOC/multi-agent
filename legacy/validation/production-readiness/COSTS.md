# Custos: preço publicado, estimativa e custo efetivamente medido

**Custo de modelos efetivamente incorrido nesta investigação: nenhuma chamada paga executada.** Custos de energia/infra local preexistente não foram medidos. Há três níveis distintos: rate card público, projeção de consumo hipotético e conciliação real por recibos/fatura. Apenas os dois primeiros foram produzidos aqui.

O usuário definiu empresa grande como referência e início com cenários menores. Os números abaixo são hipóteses explícitas para dimensionamento; não são dados de um cliente nem capacidade já demonstrada.

## Rate cards usados no cálculo

USD por milhão de tokens, padrão/global/contexto curto, consultados em 2026-11-03. Não incluem impostos, câmbio, contrato empresarial ou prêmio de região. Não comparam qualidade entre modelos.

| Exemplo | Entrada nova | Saída | Leitura de cache | Escrita curta / longa |
|---|---:|---:|---:|---:|
| GPT-6.1 Sol | 2,00 | 10,00 | 0,10 | 2,50 / 5,00 |
| GPT-6 Luna | 0,10 | 0,50 | 0,01 | 0,125 / 0,25 |

Fonte e escopo de preços: [OpenAI API](https://developers.openai.com/api/docs/pricing). Não são recomendações de modelo nem garantias de acesso pela conta do cliente.

| Exemplo | Entrada nova | Saída | Leitura de cache | Escrita curta / longa |
|---|---:|---:|---:|---:|
| Claude Sonnet 5.5 | 2,00 | 10,00 | 0,10 | 2,50 / 4,00 |

Os TTLs são 5 min/1 h para esse exemplo, conforme a [documentação Anthropic](https://platform.claude.com/docs/en/about-claude/pricing).

| Exemplo | Entrada nova | Saída incluindo thinking | Leitura de cache |
|---|---:|---:|---:|
| Gemini 3.5 Flash-Lite | 0,30 | 2,50 | 0,03 |

Armazenamento de cache é outra parcela: USD 1,00 por milhão de tokens/hora no exemplo. Fonte: [Google](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). A adaptação genérica recusa escrita de cache Google, pois não implementa sua cobrança específica; valor desconhecido não vira zero.

## Como a contabilidade precisa funcionar

Cada tentativa mantém installation/company/task/run/agent, provedor, request_id, modelo efetivo, versão de rate card, moeda, região/tier, categorias de tokens, ferramentas, estado da chamada e recibo. Não registrar só o total retornado pelo coordenador: incluir especialistas, avaliadores, retries, ingestão, extração, embeddings e manutenção do cérebro.

Em Responses OpenAI, cached e cache writes compõem input_tokens: subtrair suas parcelas antes de aplicar preço da entrada nova. Escritas por TTL têm preços diferentes; reasoning é parte da saída, sem somá-lo novamente. Em Anthropic, input_tokens exclui leitura/escrita de cache. Os [contratos OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) e [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) foram usados nos testes de normalização.

`costs.py` usa Decimal, valida categorias e recusa ambiguidades. Oito testes passaram, incluindo inconsistências de contagem, dupla contagem de raciocínio e categoria sem adaptador. São fixtures de usage e preços, não respostas de cobrança reais.

Separar valores estimado/reservado, consumo reportado, obrigação externa ainda incerta e valor conciliado. Um timeout pode ter custo. Não liberar toda a reserva após perder um stream sem usage final; manter obrigação pendente e reconciliar por request_id. Os controles precisam existir antes de cada chamada: limite de saída, contexto, loops, ferramentas, especialistas, concorrência e margem de reserva. Estouro já incorrido deve ser contabilizado, e não escondido para manter o teto visual.

A [API de custos OpenAI](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs) fornece agregados para conciliação; não foi chamada. O reconciliador deve usar credencial administrativa separada, protegida do runtime e de ferramentas. Dados agregados podem exigir alocação de diferenças, créditos, tarifas e períodos; custo calculado não equivale automaticamente à fatura.

## Projeções reproduzíveis

Premissas: 40 mil tokens de entrada + 8 mil de saída por tarefa somando todos os agentes/chamadas; 20% de trabalho adicional por retries; 30 dias/mês; sem cache/desconto. É um workload deliberativo hipotético, não o consumo obrigatório de toda tarefa.

| Cenário | Usuários / workflows ativos | Tarefas/dia | Documentos |
|---|---:|---:|---:|
| Piloto | 20 / 5 | 50 | 2 mil |
| Referência grande | 2 mil / 100 | 10 mil | 1 milhão |
| Stress hipotético | 10 mil / 500 | 50 mil | 10 milhões |

| Projeção apenas de tokens de tarefas | Piloto/mês | Referência grande/mês | Stress/mês |
|---|---:|---:|---:|
| Sol ou Sonnet, nas tarifas acima | USD 288 | USD 57.600 | USD 288.000 |
| Luna, sem assumir qualidade equivalente | USD 14,40 | USD 2.880 | USD 14.400 |
| Flash-Lite, sem assumir qualidade equivalente | USD 57,60 | USD 11.520 | USD 57.600 |

São resultados matemáticos das hipóteses e rate cards; não cotação do produto ou conta mensal prevista. Roteamento entre modelos, contexto menor e execução A0–A4 podem mudar muito o consumo, mas dependem de avaliação de qualidade/segurança. O controlador deve gastar mais quando a tarefa exigir, sem forçar uma equipe completa para toda consulta.

Para ingestão inicial, hipótese adicional: 8 mil tokens/documento e saída de extração equivalente a 20% da entrada. Um milhão de documentos gera 8 bilhões de tokens de entrada e 1,6 bilhão de saída: aproximadamente USD 32 mil no rate card Sol/Sonnet usado, somente extração. Não é requisito de consumo do LightRAG: tamanho de chunk, densidade de entidades, gleans, retries e corpus real precisam ser medidos.

A página oficial de [text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small) apresenta USD 0,02/milhão e 1.536 dimensões. Uma única passagem pelos 8 bilhões de tokens originais daria USD 160; isso exclui overlap, entidades/relações, reembeddings e consultas. Não confundir esse piso aritmético com o custo total do cérebro.

## Infraestrutura e capacidade

Com 900 tokens novos/chunk, um milhão de documentos de 8 mil tokens produz cerca de 8,89 milhões de vetores de chunks. Só seus 1.536 float32 ocupam aproximadamente 50,86 GiB, antes de índice, entidades, relações, texto, replicação e backups. Essa é uma conta de armazenamento, não medição de performance.

TCO = ingestão inicial + inferência/embeddings/rerank/OCR + APIs de ferramentas + app/runtime + banco/HA + grafo/vetores/objetos + rede + backup/DR + observabilidade + operação/suporte + reindexação + impostos. O orçamento de operações/engenharia não pode ficar oculto na linha de tokens.

Não há cotação de infraestrutura neste pacote: região, SLA, retenção, disponibilidade e tamanho real de fontes ainda não foram definidos. Preencher esses itens com preços públicos genéricos daria precisão falsa. O artefato JSON conserva premissas e exclusões para atualizar a projeção quando houver medições.

## Medição real necessária antes de contratar

Executar corpus pequeno representativo em português com dados autorizados, registrar tokens/usage efetivos de ingestão e tarefas, erro/retrabalho, latência e custo por entrega correta. Em seguida comparar rate card/usage com o extrato do provedor e resolver diferenças. Repetir com cache frio/quente, falha de stream, timeout, revisão humana e reprocessamento de fonte. Essa medição paga permanece não executada e exige orçamento de teste explicitamente autorizado; não presume acesso a créditos ou contas pessoais.
