# Recuperação da instalação Aurora · 06/11/2026

**Decisão posterior de escopo:** a primeira versão roda em uma máquina por instalação. A restauração entre máquinas e a custódia externa para perda total do host foram adiadas. Os resultados abaixo servem para delimitar a recuperação no próprio host.

O ensaio reconstrói a instalação em um diretório limpo, com novos processos e volumes PostgreSQL/pgvector e Neo4j. A API e o worker LangGraph são os do Aurora. O teste usa um corpus fictício fechado, embeddings locais e respostas de modelo controladas. Nenhuma chamada comercial faz parte do ensaio.

## Corte e reconstrução

1. Preparar quatro trabalhos com estados distintos. Pausar novos despachos quando uma inferência admitida fica sem recibo. Encerrar a API de origem e esperar a liberação do lock do checkpoint antes de exportar os dados.
2. Exportar fila, diário e aprovações da API, outbox de telemetria, slots de modelo, SQLite canônico, registro nativo, dump dos checkpoints, pgvector e Neo4j. Selar os hashes e a configuração com AES-GCM. O registro de autoridade, a chave de restauração e o selo ficam em custódia separada do pacote de dados.
3. Encerrar os processos e remover os contêineres e volumes de teste da origem após conferir os rótulos de propriedade. Em destino novo, verificar pacote e autoridade antes de restaurar os bancos. Reiniciar a autoridade com o mesmo registro e chave de assinatura. Abrir o cérebro após comparar os inventários das projeções. A API e os revisores recebem novas credenciais locais.

| Estado no corte | Critério de aceite na restauração |
| --- | --- |
| Pedido na fila | Mantém o identificador original e chega à revisão. Repetir a chave de admissão devolve o mesmo trabalho. |
| Proposta aguardando aprovação | Mantém o mesmo hash e continua aguardando decisão. A aprovação explícita posterior produz um único recibo. |
| Inferência admitida sem recibo | Fica interrompida e passa a exigir revisão na retomada. Dois revisores encerram a tentativa como desconhecida. O modelo não é chamado novamente. |
| Queda depois de gravar o efeito | A retomada devolve exatamente o recibo anterior. |

O pacote adulterado e a abertura com uma chave errada são recusados. A reconstrução exige que o estado atual da autoridade coincida com a âncora selada, incluindo o head, os orçamentos, os slots, os votos e o testemunho de backup. A autoridade do ensaio usa SQLite e chaves de laboratório.

Na primeira execução, o backup levou **50,86 s** e a fila voltou a produzir uma proposta em **62,66 s** contados desde o início da reconstrução. As checagens funcionais terminaram em **66,06 s**. A auditoria offline confirmou 62 assinaturas, os quatro estados esperados e a preservação do recibo anterior. [Métricas da primeira execução](evidence-a0741a0447.json) · [JUnit](run01.xml)

**Resultado final: PASS no laboratório.** A repetição confirmou a liberação do checkpoint antes da cópia e o hash da aprovação pendente depois do restore. O backup levou **51,30 s**, a reconstrução até a fila voltar a produzir uma proposta levou **64,07 s**, e as checagens funcionais terminaram em **67,54 s**. Todos os quatro trabalhos e as quatro projeções da amostra foram recuperados. Das 13 reservas finais, 12 correspondem a slots concluídos e uma a um encerramento desconhecido. Os quatro despachos controlados após o restore foram todos do trabalho que já estava na fila. Ficaram dois recibos de efeito, o original preservado e o criado pela aprovação posterior. O verificador conferiu 62 assinaturas nesta execução. [Métricas finais](evidence-c33706f342.json) · [Auditoria offline](verified-run02.json) · [JUnit final](run02.xml)

## Escopo e reprodução

Este é um ensaio de perda simulada no mesmo computador. Os processos e volumes de destino são novos e a custódia fica fora do diretório da origem. A máquina física, o daemon Docker, as dependências fixadas e o disco de custódia são compartilhados pela bancada. O corte tem uma pausa coordenada. Falta medir perda de dados entre backups e recuperar em outra máquina com custódia externa real. O selo autentica o pacote e cifra a configuração de recuperação. Os arquivos de dados do ensaio são fictícios.

```powershell
New-Item -ItemType Directory -Path validation/aurora-host-restore/.state -Force | Out-Null
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-host-restore/test_host_restore.py -q --tb=short --basetemp=validation/aurora-host-restore/.state/next --junitxml=validation/aurora-host-restore/next.xml
```

O ensaio depende de Docker Desktop ativo, acesso local aos serviços e das imagens já fixadas no `BrainLab`. Os dumps e as chaves gerados ficam em `.state`. Os recursos do teste são isolados dos ambientes de demonstração.

O verificador offline lê o pacote selado, a transcrição da autoridade e as duas bases da API. A saída contém apenas contagens e transições. Para usar o verificador, informe o diretório do caso abaixo do `--basetemp`, onde se encontram `custody`, `transfer` e `target`.

## Perda entre backups

O teste seguinte mediu **pedidos que o cliente confirmou ter recebido como aceitos**, comparando-os com a fila restaurada. A API real do Aurora aceitou os pedidos por HTTP 202. Um diário independente do diretório da origem, com `fsync` após cada resposta recebida, serviu de referência. Os workers ficaram pausados. O backup da fila capturou quatro pedidos, e a API aceitou outros três antes da interrupção.

| Medida da amostra | Resultado |
| --- | ---: |
| Pedidos confirmados antes da interrupção | 7 |
| Pedidos recuperados do backup | 4 |
| Pedidos confirmados ausentes no destino | 3 |
| Tempo entre o backup pronto e a saída do processo | 0,641 s |

As confirmações ausentes chegaram 0,203 s, 0,422 s e 0,625 s após o backup ficar pronto. Elas ainda estavam na fila e nenhuma inferência tinha sido despachada. O diário registrou a perda para o ensaio. A aplicação não usa esse diário para recuperar pedidos. Como a chave de idempotência também faz parte do SQLite local, a restauração não preserva a chave de um pedido que ficou fora do backup.

Em seguida, o provedor fictício registrou uma reserva posterior à cópia. A tentativa de restaurar o mesmo pacote íntegro foi recusada antes de copiar o banco ou iniciar a API no novo destino, pela mesma comparação de autoridade usada no ensaio de reconstrução completa. O caso distingue duas situações. A fila pode perder pedidos confirmados quando a autoridade de modelos ainda não viu o trabalho. Se a autoridade avançou, a abertura da geração antiga é bloqueada até haver um ponto de recuperação compatível. Zero chamadas comerciais. [Métricas](recovery-gap-b248100c12.json) · [JUnit](gap01.xml)

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-host-restore/test_recovery_gap.py -q --tb=short --basetemp=validation/aurora-host-restore/.state/gap-next --junitxml=validation/aurora-host-restore/gap-next.xml
```

O intervalo de 0,641 s é a janela injetada nessa amostra, com três envios controlados. O teste não determina o RPO de produção. Para um piloto que exija preservar confirmações já entregues ao cliente, a admissão e sua chave precisam sobreviver fora do host antes do HTTP 202. Para homologar restauração entre máquinas, são necessários um destino de teste com volumes novos, armazenamento independente para os backups, acesso autorizado a um cofre e uma âncora de autoridade fora da origem. Esses recursos ainda não estão disponíveis. **Produção segue NO-GO.**
