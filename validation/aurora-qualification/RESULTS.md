# Homologação local do Aurora · 05/11/2026

**Decisão: continuar o MVP em laboratório. Produção e capacidade empresarial continuam NO-GO.** A rodada confirmou a recuperação local de checkpoints e recibos, mediu o limite de admissão da API e observou o consumo de uma chamada real pela conta ChatGPT autorizada. A carga de novos trabalhos revelou o primeiro impedimento mensurável para escala: a instalação trabalha com uma execução ativa e devolve os demais pedidos ao cliente.

| Frente | Resultado local | Critério pendente para produção |
| --- | --- | --- |
| Restauração de workflow e slots | PASS em novo diretório e volume PostgreSQL, com autoridade retida independente | Restore do launcher completo, armazenamento e chaves fora do host, perda do host inteiro, RPO/RTO pactuados |
| Carga | PASS de integridade no replay e na recusa sob ocupação | Fila durável, concorrência de trabalhos, teste sustentado de tarefas completas e metas do ambiente alvo |
| Custo | Uma chamada real medida por tokens e latência. Valor faturado indisponível | Conciliar custo com cobrança atribuível e medir infraestrutura, falhas e ingestão |
| Integrações | PASS local para PostgreSQL/pgvector, Neo4j, LightRAG, ONNX, publicação canônica TypeScript e checkpoint LangGraph | Conectores corporativos específicos com identidade, revogação, exclusão e recuperação próprios |

## Restauração

O ensaio parou o processo nativo e o PostgreSQL originais. Restaurou o arquivo SQLite de recibos e o dump do schema de checkpoint para um diretório e volume novos. O serviço de autoridade permaneceu disponível fora do bundle, na mesma máquina. O checkpoint em pausa retomou no passo de revisão, o recibo conhecido foi reutilizado e a inferência sem recibo permaneceu em revisão. A autoridade ainda conhecia uma operação posterior ao backup cujo recibo estava ausente. O trabalho ficou bloqueado, com zero novos despachos e três reservas preservadas.

Backup em **0,279 s** e restauração até a validação em **4,658 s** para esse recorte pequeno. Os tempos são observações do ensaio local. A autoridade e suas chaves permaneceram fora do bundle no mesmo host. [Evidência da restauração](evidence/965233a4962b/restore.json) · [JUnit](local-01.xml)

## Integrações e restauração do cérebro

O ensaio integrado reutilizou o contrato de publicação e recuperação do cérebro. O armazenamento, os embeddings ONNX, o índice vetorial, o grafo e os processos da aplicação eram reais. As respostas de extração, palavras-chave e síntese vieram de um provedor determinístico restrito ao corpus fictício. A única chamada externa desta rodada foi a sonda separada de custo.

- A consulta foi recusada antes da publicação da projeção. Após publicação, as duas fontes produziram nós, relações e evidências com referência à versão canônica.
- A publicação da segunda versão retomou depois de uma queda entre a projeção e o commit canônico. A prova conferiu a decisão anterior e a nova versão após o restore.
- O bundle antigo e o bundle com dump alterado e manifesto reescrito foram recusados antes de mudar serviços. O bundle atual recuperou a base de checkpoints, pgvector e Neo4j em volumes novos, além do registro canônico e das chaves cifradas.
- O ambiente restaurado abriu congelado. Após reabertura, a revogação continuou valendo para a identidade financeira, a diretoria ainda teve acesso à decisão histórica e uma nova consulta usou a versão 2.

Restore do cérebro em **53,851 s**, com 99 assinaturas verificadas offline. O teste completo levou **236,23 s**, incluindo preparação, duas gerações de backup e limpeza. A chave de cifragem e a autoridade sobreviveram na mesma máquina. Os ensaios de slots e de cérebro são provas complementares em instalações distintas. [Resultado integrado](evidence/brain-43617501f5bc/verification.json) · [JUnit](brain-01.xml)

## Carga

Foram enviados 544 replays HTTP de um recibo já persistido, com prova assinada verificada em cada solicitação. Todos devolviam o mesmo resultado e compartilharam a reserva e o despacho originais. O limite exploratório, definido antes do ensaio, foi p95 de 1 s e nenhuma divergência.

| Clientes simultâneos | Replays | p50 | p95 | req/s na janela |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 80 | 15,1 ms | 32,2 ms | 61,24 |
| 8 | 80 | 25,1 ms | 45,4 ms | 294,21 |
| 32 | 128 | 134,9 ms | 191,2 ms | 199,52 |
| 64 | 256 | 259,3 ms | 339,8 ms | 225,01 |

No endpoint real de admissão, 64 clientes enviaram 128 pedidos durante um trabalho controlado ativo. Todos receberam HTTP 409 com a mensagem de trabalho em execução, p95 **114,3 ms**, sem criar linhas adicionais de trabalho. Isso mede a velocidade da recusa e a proteção contra admissão concorrente. Os 225,01 req/s da outra prova correspondem a replays, com um recibo em uma instalação pequena. [Replays](evidence/965233a4962b/load.json) · [Admissão](evidence/20dd665bba07/admission.json) · [JUnit de admissão](admission-01.xml)

## Custo

O adaptador Codex fez **uma chamada GPT-6.1 Terra** autenticada via ChatGPT, com um enunciado fictício e diretório de trabalho vazio. A saída retornou o valor esperado em **5,13 s**. O log registrou **11.216 tokens de entrada**, **20 de saída**, zero de cache e zero eventos de ferramenta. A telemetria captura o contexto cobrado pelo transporte, além do texto do enunciado. [Medida da chamada](cost-probe.json)

As taxas publicadas para Terra Standard implicam **0,2829 crédito Codex teórico** ou **US$ 0,011316 equivalente de API**, calculados com as respectivas tabelas. O modo de autenticação da prova foi ChatGPT. O CLI retornou tokens, sem lançamento monetário por chamada. A medição de cobrança requer um registro atribuível de consumo ou a API de Costs de um projeto de teste separado. [OpenAI Docs para créditos Codex](https://learn.chatgpt.com/docs/pricing#token-rates) · [OpenAI Docs para preços da API](https://developers.openai.com/api/docs/pricing) · [OpenAI API Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)

Como referência de volume, o [ensaio anterior do Aurora](../observability-recovery/native-evidence/verified.json) registrou 33 chamadas, 499.216 tokens de entrada (246.016 em cache) e 34.229 de saída. À tarifa Standard atual e sem custo separado de gravação de cache, esse total equivale a **US$ 0,4366458** em API ou **10,916145 créditos Codex**. O lote inclui preparação, trabalhos concluídos até aprovação e tentativa falha. Falta atribuição por entrega, custo de infraestrutura e valor faturado. Nenhuma assinatura ou projeto novo foi contratado nesta rodada.

## Reprodução

Os ensaios locais precisam de Docker Desktop ativo e acesso a loopback. Use diretórios de teste novos em cada execução. A sonda de custo exige `--one-call` e recusa reutilizar seu diretório privado, para evitar chamadas involuntárias. O modo padrão dos testes usa modelo controlado.

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-qualification/test_qualification.py -q --tb=short --basetemp=validation/aurora-qualification/.state/local-next --junitxml=validation/aurora-qualification/local-next.xml
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-qualification/test_brain_integration.py -q --tb=short --basetemp=validation/aurora-qualification/.state/brain-next --junitxml=validation/aurora-qualification/brain-next.xml
& validation/integrated-pilot/.venv/Scripts/python.exe validation/aurora-qualification/probe_cost.py --one-call
```

O acesso ao pipe do Docker no sandbox retornou `permission denied`. Os ensaios de loopback/Docker foram executados com autorização de ambiente. Dumps, chaves e logs de transporte ficam nos diretórios privados. Os testes criam recursos Docker rotulados e limpam apenas os recursos da instalação de teste.
