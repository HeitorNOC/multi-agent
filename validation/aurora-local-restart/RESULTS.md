# Parada e retomada no mesmo host · 06/11/2026

`Stop-Aurora.ps1` espera o launcher terminar. Para uma instalação pronta, o launcher encerra os processos da aplicação, para os contêineres rotulados e preserva os volumes. `Start-Aurora.ps1` reabre a instalação mais recente após uma parada confirmada. Um lock local impede dois launchers de operarem o mesmo diretório de estado.

A retomada usa os metadados autenticados pela proteção de dados do Windows da mesma conta, com verificação de caminho, arquivos obrigatórios, identidade dos recursos Docker e hash do corpus. O launcher reabre os bancos e a autoridade, verifica cada projeção existente e só então libera a fila. O identificador da instalação, a configuração de workers e o teto de reservas são reaproveitados. A API e o login local dos revisores recebem credenciais novas. Consulte o endereço emitido na inicialização.

O ensaio usa o `start.py` real, a API, o worker do Aurora, PostgreSQL/pgvector, Neo4j e embeddings ONNX. A extração e as respostas de modelo são controladas sobre o corpus sintético. Nenhuma chamada comercial é necessária para reproduzir a prova.

**PASS.** A instalação voltou a aceitar trabalho em **50,56 s** no ensaio. O segundo launcher verificou as **16 fontes existentes** e o registro de extração não cresceu. Os três trabalhos mantiveram seus identificadores. O pedido na fila voltou a progredir sem duplicar a admissão, a inferência interrompida foi encaminhada para revisão, e a retomada do efeito devolveu o mesmo recibo. As quatro novas chamadas controladas corresponderam ao pedido que já estava na fila. Houve um único efeito gravado e zero chamadas comerciais. [Métricas](evidence-3cbb0f4982.json) · [JUnit](run02.xml)

```powershell
New-Item -ItemType Directory -Path validation/aurora-local-restart/.state -Force | Out-Null
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-local-restart/test_launcher.py -q --tb=short --basetemp=validation/aurora-local-restart/.state/next --junitxml=validation/aurora-local-restart/next.xml
```

A primeira execução preparou o corpus e ficou esperando a prontidão porque o teste comparava o PID do executável do ambiente virtual com o PID do interpretador que executou o launcher. A espera foi corrigida para usar o registro de inicialização da aplicação. Foram encerrados apenas os contêineres e volumes rotulados dessa execução. [JUnit inicial](run01.xml)

A proteção dos metadados foi exercitada separadamente com leitura correta e recusa de adulteração. Outro ensaio recusou uma parada não confirmada antes de abrir os metadados ou tentar reanexar os recursos. Os scripts PowerShell passaram na análise sintática e os módulos Python passaram na compilação.

Esta entrega cobre a parada confirmada. Se o launcher anterior saiu sem gravar o marcador de parada, a reabertura automática é bloqueada e os logs podem ser examinados. A recuperação de disco corrompido continua usando o procedimento de backup. Segundo host e cofre externo pertencem ao backlog futuro.
