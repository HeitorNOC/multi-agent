# Vagas reservadas para aprovações e retomadas · 06/11/2026

O launcher do Aurora mantém uma fila de 32 entradas, com até 24 novos pedidos aguardando. O limite protege oito vagas para aprovações e retomadas. Essas operações podem ocupar as demais vagas livres até o limite total. A ordem de execução continua sendo a ordem persistida de entrada na fila. Trabalhos já enfileirados por uma versão anterior continuam avançando.

A verificação de capacidade acontece na mesma transação que grava a entrada. Se a fila de novos pedidos estiver cheia, um novo pedido recebe HTTP 429. Uma aprovação pode entrar nas vagas protegidas e continua vinculada ao hash da proposta. Quando a fila inteira está cheia, a aprovação recebe 429 sem mudar o estado da proposta. A interface mostra a reserva e evita oferecer uma nova admissão quando o limite de novos pedidos é atingido. O servidor compartilhado permite a configuração e mantém o comportamento anterior para perfis sem reserva.

## Prova da reserva

Com o executor pausado e as seis vagas para novos pedidos preenchidas, a API recusou um sétimo pedido. Uma aprovação e uma retomada foram aceitas nas duas vagas restantes, em ordem de entrada. Uma nova aprovação recebeu 429 quando a fila inteira ficou cheia, com seu campo de aprovação ainda vazio. O teste também recusou um hash errado e comprovou o replay da mesma admissão e da mesma aprovação sem inserir entradas adicionais. A suíte Node passou com 34 testes. O build e os dois projetos TypeScript passaram. [Log Node](reserve-node.log)

## Comparação sob carga

A repetição usa os mesmos dois workers, oito vagas totais, 96 pedidos em 90 s, cenário fictício, bancos locais reais e provedor controlado do [ensaio de referência](SUSTAINED.md). Nesta execução, seis vagas podem ser ocupadas por novos pedidos e duas ficam reservadas para aprovações ou retomadas. A conclusão exige um recibo único por trabalho, quatro reservas distintas e fila vazia. O recorte mede a capacidade da bancada, com zero chamadas comerciais.

| Medida | Sem reserva | Com duas vagas reservadas |
| --- | ---: | ---: |
| Pedidos aceitos e concluídos | 46 | 47 |
| Novos pedidos com HTTP 429 | 50 | 49 |
| Tentativas de aprovação com HTTP 429 | 48 | 14 |
| p95 de espera na fila | 12,48 s | 9,96 s |
| p95 da admissão à conclusão | 24,53 s | 21,48 s |

**PASS no laboratório.** Os 47 trabalhos aceitos concluíram, com 47 recibos distintos e 188 reservas distintas. A fila zerou em 100,33 s a partir do primeiro envio. As 14 recusas são tentativas de aprovação e o roteiro conseguiu enfileirar todas as 47 aprovações. O ensaio mostra a proteção contra saturação por novos pedidos e a redução das recusas nessa amostra. A fila inteira ainda pode ficar cheia. [Métricas finais](sustained-98142393a7.json) · [JUnit final](sustained-reserve.xml)

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-queue/test_sustained.py -q --tb=short --basetemp=validation/aurora-queue/.state/reserve-next --junitxml=validation/aurora-queue/reserve-next.xml
node --test validation/aurora-queue/reserve.test.ts
node demo-enterprise/build.cjs
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo/tsconfig.json
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json
```
