# Execução concorrente do Aurora · 05/11/2026

**PASS no laboratório para dois workers por instalação.** O perfil padrão usa um worker. O perfil de laboratório com dois exige fila durável e slots governados e pode ser escolhido ao iniciar uma sessão com `Start-Aurora.ps1 -Workers 2`.

O mesmo escalonador local retira os trabalhos em ordem de gravação até ocupar o limite configurado. Cada worker recebe uma concessão própria e trava apenas o checkpoint de seu trabalho no PostgreSQL. A preparação do esquema compartilhado do checkpointer é serializada para evitar corrida entre os primeiros workers. LangGraph mantém a orquestração. As chamadas do adaptador de modelo permanecem serializadas e o efeito simulado continua condicionado ao hash aprovado e ao recibo por trabalho.

## Comparação medida

Foi executada uma rodada por perfil no mesmo laboratório. Cada rodada manteve a fila em oito vagas e usou LangGraph, PostgreSQL e a autoridade de reservas reais. O provedor controlado serializou suas respostas com 150 ms de espera por chamada e a recuperação de fontes usou o corpus fictício via transporte controlado. A ordem dos perfis foi um worker e depois dois. São medidas da bancada, sujeitas à carga do host.

| Medida | Um worker | Dois workers |
| --- | ---: | ---: |
| Pico observado de workers ativos | 1 | 2 |
| Oito trabalhos até a revisão após liberar a fila restaurada | 19,37 s | 10,59 s |
| Oito trabalhos da primeira aprovação até conclusão, com queda injetada | 9,33 s | 5,78 s |
| Onda 1, quatro trabalhos do envio à conclusão | 12,96 s | 7,39 s |
| Onda 2, quatro trabalhos do envio à conclusão | 14,29 s | 7,29 s |
| p95 de espera nas passagens pela fila, incluindo retomadas | 15,13 s | 8,21 s |

Cada perfil completou **16 trabalhos aprovados**, encerrou um trabalho por rejeição humana e gravou **16 recibos de efeito distintos**. A conferência em leitura encontrou **68 slots concluídos e 68 reservas distintas** por perfil. A rajada de 24 pedidos recebeu oito admissões e 16 respostas 429 enquanto o runtime estava temporariamente indisponível. A fila conservou a ordem no reinício da API no mesmo endereço. A retomada após a queda que seguiu o efeito simulado devolveu o mesmo recibo sem novo despacho.

A regressão de orçamento fez quatro chamadas disputarem as duas reservas finais da mesma instalação. Houve duas admissões e duas recusas antes do despacho. Os testes registraram zero chamadas comerciais nesta rodada.

[Métricas de um worker](evidence-2aafb9555e.json) · [Métricas de dois workers](evidence-91b068e4bc.json) · [JUnit da comparação](concurrency-01.xml) · [JUnit de slots e quota](concurrency-slots.xml) · [33 testes Node](concurrency-node.log)

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-queue/test_queue.py -q --tb=short --basetemp=validation/aurora-queue/.state/concurrency-next --junitxml=validation/aurora-queue/concurrency-next.xml
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-model-slots/test_slots.py -q --tb=short --basetemp=validation/aurora-queue/.state/slots-next --junitxml=validation/aurora-queue/slots-next.xml
node demo-enterprise/build.cjs
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo/tsconfig.json
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json
```

**Produção segue NO-GO.** O perfil com dois workers demonstrou sobreposição de workflows em um host. Faltam carga prolongada no ambiente alvo com o provedor e os conectores escolhidos, orçamento por trabalho completo e restauração após perda do host. A comparação não mede throughput do provedor comercial, custo faturado ou capacidade de múltiplas réplicas. A verificação da interface foi por build, TypeScript e contratos HTTP.
