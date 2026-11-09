# Recuperação das chamadas diretas do Aurora

O bootstrap do Aurora encaminha planejamento do Chief, especialistas, diretores e síntese ao serviço nativo de inferência. O serviço vincula instalação, trabalho, slot e hash do prompt à admissão. A autoridade externa ao banco local reserva uma unidade e concede o despacho em uma única transação. A mesma reserva é usada pelo adaptador de modelo. O caminho de ingestão do LightRAG continua com seu orçamento existente.

| Estado | Comportamento |
| --- | --- |
| Admissão nova | O worker ativo pode iniciar a chamada uma vez, dentro dos limites do plano e da instalação. |
| Recibo local persistido antes de uma queda | Na retomada com o mesmo prompt, o serviço concilia o hash com a autoridade e devolve o resultado persistido. |
| Admissão sem recibo | A central identifica o slot, o hash de entrada e a reserva. Duas identidades locais registram e confirmam o encerramento. O trabalho fica em `closed_unknown`. |
| Recibo confirmado ausente ou divergente | A central mostra indisponibilidade do recibo e o trabalho fica bloqueado para investigação. |

Os revisores recebem metadados, sem acesso ao prompt ou ao conteúdo bruto do recibo pela central. A concessão do executor é gerada por processo e conferida na API antes de admitir chamadas diretas. LangGraph continua responsável pelo andamento e pelos checkpoints. O launcher tenta religar o serviço nativo no mesmo endereço e com o mesmo banco até três vezes durante uma sessão já pronta.

Foram encontrados 33 recibos concluídos nos quatro bancos das sessões históricas examinadas em modo de leitura. Nenhum tinha status desconhecido. Esses registros continuam como evidência histórica das instalações de origem. A autoridade rejeita o uso de um recibo legado sem admissão compatível.

## Provas executadas

Os testes usam o servidor TypeScript, a autoridade Ed25519 e o serviço nativo HTTP reais. O cenário com o worker do Aurora usa LangGraph e checkpoint em PostgreSQL no Docker local. Respostas do modelo e recuperação de fontes são controladas nessa prova. A bancada fez zero chamadas a modelos comerciais.

| Execução | Resultado | Evidência |
| --- | --- | --- |
| Qualificação Python, com três novos testes e 14 regressões da central e do protocolo | 17 PASS em 155,82 s | [JUnit](qualification.xml) |
| Reexecução do caso do worker com perda da confirmação | 1 PASS em 12,74 s | [JUnit](confirmation-final.xml) |
| Regressão Node | 33 PASS | [Log](node-qualification.log) |
| Build e TypeScript strict da API e da interface | PASS | Comandos abaixo |

- Cinco pedidos concorrentes para o mesmo slot produzem uma reserva e um despacho. Prompt divergente e estouro dos limites por trabalho e instalação são recusados. Alterar o resultado após a confirmação retida bloqueia o replay.
- Uma queda do serviço entre o recibo local e a confirmação retida permite conciliação após novo processo no mesmo endereço. O despacho original permanece único.
- No worker do Aurora, o Chief seleciona uma equipe e o processo nativo cai antes de persistir o resultado do especialista. Uma concessão de executor obsoleta é recusada. A primeira identidade não confirma a própria revisão. O segundo revisor encerra o slot, e a perda da resposta da confirmação é conciliada com o mesmo ID de envio. O trabalho encerrado não pode gerar outro slot sob a mesma intenção.

```powershell
New-Item -ItemType Directory -Path validation/aurora-model-slots/.state -Force | Out-Null
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-model-slots/test_slots.py validation/human-recovery/test_console.py validation/observability-recovery/test_recovery_contracts.py validation/governed-recovery/test_votes.py -q --tb=short --basetemp=validation/aurora-model-slots/.state/qualification --junitxml=validation/aurora-model-slots/qualification.xml
node demo-enterprise/build.cjs
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo/tsconfig.json
node --test validation/human-recovery/recovery_auth.test.ts demo/telemetry.test.ts demo/policy.test.ts demo/server.test.ts demo-enterprise/policy.test.ts validation/observability-recovery/api_effect.test.ts validation/temporal-editorial/editorial.test.ts validation/langgraph-business-flow/editorial_read.test.ts validation/langgraph-retained-flow/proof.test.ts
```

A execução inicial esbarrou no diretório temporário padrão do pytest e na restrição de loopback. A prova foi refeita com diretório isolado no workspace e acesso autorizado à rede local. O Docker Desktop estava parado e foi iniciado para o ensaio de PostgreSQL.

## Alcance do aceite

**Aprovado para o perfil de laboratório do Aurora. Produção permanece NO-GO.** A prova cobre o fechamento e o reaproveitamento de recibo dos slots diretos, com um escritor por instalação local. Perda do host e restauração completa do launcher, backup dos recibos com chaves e RPO/RTO, múltiplas réplicas, ingestão, cobrança monetária, carga empresarial, ferramentas externas e dados reais exigem homologação própria. O ensaio não inclui execução paga nem inspeção visual no navegador.
