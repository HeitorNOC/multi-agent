# Carga contínua e custo atribuível do Aurora · 06/11/2026

O ensaio usa dois workers e oito vagas na fila, em uma máquina. O gerador envia um pedido de incidente a cada 1,5 s durante uma janela de 90 s, com três rajadas adicionais de 12. As aprovações simuladas usam o hash retornado pela API. O tempo de entrega inclui a espera na fila e a aprovação automatizada do roteiro. Os serviços de API, autoridade, LangGraph, PostgreSQL/pgvector, Neo4j e embeddings são reais. A extração e o modelo usam respostas controladas sobre quatro fontes fictícias publicadas, com latência artificial de 150 ms por chamada direta e acesso serial ao provedor.

Os critérios são duas execuções simultâneas sem exceder oito vagas, respostas de admissão 202 ou 429, conclusão de todos os pedidos aceitos, um recibo único por conclusão, quatro reservas distintas por trabalho e fila vazia ao final. O roteiro registra latências e vazão para este perfil. A janela e o cenário delimitam o alcance da medida.

## Resultado depois da correção

**PASS no perfil local.** Dos 96 pedidos, **46 foram aceitos e todos concluíram**. Os outros **50 receberam HTTP 429** no limite de capacidade. A fila zerou em **99,64 s** a partir do primeiro envio. O pico foi de dois workers e oito entradas em espera. Houve **184 reservas distintas**, quatro por trabalho, e **46 efeitos simulados únicos**. [Métricas finais](sustained-4fd29906be.json) · [JUnit final](sustained-02.xml)

| Medida | p50 | p95 |
| --- | ---: | ---: |
| Espera por passagem na fila, incluindo aprovação | 7,35 s | 12,48 s |
| Tempo do pedido aceito à conclusão | 19,33 s | 24,53 s |
| Consulta de estado | — | 47 ms |

A aprovação compartilha a fila de execução. O roteiro recebeu 48 recusas 429 em tentativas de aprovação antes de conseguir enfileirar as 46 aprovações. A carga de entrada superou a capacidade desse recorte. A rodada valida a conclusão dos pedidos aceitos sob saturação local e registra a latência observada. Capacidade com provedor comercial e conector real permanece em aberto.

## Falha na primeira execução

A primeira rodada admitiu 48 pedidos e recusou 48 por capacidade. Um worker falhou com `DeadlockDetected` ao inicializar o esquema LangGraph vazio. A sessão esperando `pg_advisory_lock` mantinha uma transação virtual aberta. A sessão que detinha o lock precisava que essa transação terminasse para criar índices com `CREATE INDEX CONCURRENTLY`. O roteiro inicial encerrou a observação quando detectou o trabalho falho após a janela de entrada. Nessa amostra, 37 trabalhos já estavam concluídos e havia oito entradas pendentes na fila. Os trabalhos restantes não foram classificados como falhas independentes. [Métricas iniciais](sustained-80fd76d1ca.json) · [JUnit inicial](sustained-01.xml) · [Diagnóstico PostgreSQL](sustained-01-deadlock.txt)

O worker passou a tentar `pg_try_advisory_lock` em consultas curtas com autocommit, liberando a transação entre tentativas. A inicialização mantém a exclusão mútua e tem espera limitada a 30 s. A reexecução usa um banco novo e deixa a fila drenar mesmo se algum trabalho terminar com erro, para distinguir falha individual de trabalho ainda em progresso.

## Custo direto por proposta histórica

Foram conciliados os hashes exatos dos prompts dos slots com o uso registrado pelo CLI no ensaio anterior. Os 16 slots das duas propostas têm correspondência única. Os outros 17 registros de uso do lote ficaram fora da atribuição dessas propostas. O consolidador também conferiu os totais de tokens do lote com o export verificado anteriormente. A saída contém contagens, sem prompts nem credenciais. [Atribuição histórica](historical-job-cost.json)

| Proposta até a revisão | Chamadas Terra | Entrada total | Entrada em cache | Saída | Equivalente API Standard | Créditos Codex teóricos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Campanha Horizonte | 10 | 170.494 | 88.832 | 12.779 | US$ 0,1500 | 3,7500 |
| Incidente no CRM | 6 | 92.315 | 43.264 | 5.011 | US$ 0,0763 | 1,9067 |

Os equivalentes aplicam as tarifas públicas Standard do GPT-6.1 Terra a entrada sem cache, entrada em cache e saída. São observações de uso de duas propostas reais do ensaio histórico, que ficaram aguardando aprovação. A conta ChatGPT não forneceu fatura por trabalho. Os equivalentes excluem ingestão, infraestrutura, revisão humana e demais chamadas do lote. O incidente controlado desta rodada usa quatro slots e tem outro plano de equipe. [OpenAI Docs de preços da API](https://developers.openai.com/api/docs/pricing) · [OpenAI Docs de créditos Codex](https://learn.chatgpt.com/docs/pricing#token-rates)

## Comandos

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-queue/test_sustained.py -q --tb=short --basetemp=validation/aurora-queue/.state/sustained-next --junitxml=validation/aurora-queue/sustained-next.xml
& validation/integrated-pilot/.venv/Scripts/python.exe validation/aurora-queue/cost_attribution.py demo-enterprise/.state/session-772d0679a7 --output validation/aurora-queue/.state/job-cost-next.json
```

Os recursos Docker e o estado de teste ficam isolados. A rodada de carga e a reatribuição histórica fizeram zero novas chamadas comerciais.
