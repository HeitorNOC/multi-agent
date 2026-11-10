# Backup operacional local do PostgreSQL · 06/11/2026

O procedimento cobre dano lógico no PostgreSQL de uma instalação Aurora preparada e parada. A cópia inclui os checkpoints do LangGraph e as tabelas de conhecimento e vetores. A fila, os recibos, os slots, a autoridade e o registro local da aplicação são preservados nos seus bancos originais. O grafo Neo4j permanece no volume original. Essa delimitação permite recuperar o PostgreSQL sem sobrescrever aprovações ou recibos atuais.

```powershell
.\demo-enterprise\Stop-Aurora.ps1
.\demo-enterprise\Backup-Aurora.ps1 -Directory .\backups\aurora-01
```

O diretório pai precisa existir e o destino da cópia precisa ser novo. A parada deve ter sido confirmada. O comando bloqueia outro launcher, verifica a identidade dos recursos Docker, abre somente o PostgreSQL para exportação e volta a pará-lo. O manifesto protegido pelo Windows DPAPI autentica os dois dumps e registra o ponto dos diários locais. Os dumps contêm os dados da instalação em formato de backup PostgreSQL. Guarde o diretório em armazenamento local de acesso restrito.

```powershell
.\demo-enterprise\Restore-Aurora.ps1 -Directory .\backups\aurora-01
.\demo-enterprise\Start-Aurora.ps1
```

A restauração usa a mesma instalação e a mesma conta Windows. Ela compara a integridade dos dumps e o estado dos diários antes de criar qualquer volume de destino. Se houver divergência, retorna código 2, identifica os diários alterados e lista os IDs dos pedidos atuais ausentes na cópia. A aplicação não tenta adivinhar como repetir pedidos ou efeitos. O launcher e seus volumes anteriores ficam disponíveis para diagnóstico.

Com o ponto de recuperação compatível, a restauração cria um contêiner e um volume PostgreSQL novos, carrega os dois bancos e atualiza os metadados de retomada somente depois de o PostgreSQL novo ser parado. O volume anterior é preservado. `Start-Aurora.ps1` então faz as verificações usuais da autoridade e das projeções antes de disponibilizar a fila.

O procedimento não cobre dano simultâneo aos diários SQLite ou ao volume Neo4j. A recuperação desses componentes ainda depende do ensaio de reconstrução mais amplo. A operação entre máquinas pertence ao backlog futuro.

## Resultado do ensaio

**PASS.** Em um contêiner descartável, removemos o schema de checkpoints e o banco de conhecimento do PostgreSQL. O comando rejeitou um dump adulterado e restaurou a cópia íntegra em outro volume. O backup levou **3,23 s**, a restauração dos bancos **5,81 s** e a inicialização posterior **49,98 s**. O Aurora verificou as 16 fontes sem nova extração. O trabalho na fila manteve o ID, a inferência interrompida ficou para revisão e o efeito já registrado devolveu o recibo original. Depois que um pedido adicional foi aceito, a tentativa de usar novamente a cópia antiga foi recusada e identificou o ID ausente. Nenhuma chamada comercial. Os scripts PowerShell passaram na análise sintática e o teste de ponta a ponta executou a mesma CLI Python invocada por eles. [Métricas](evidence-90e3a67983.json) · [JUnit](backup01.xml)

```powershell
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-local-restart/test_launcher.py::test_operational_postgres_backup_restore -q --tb=short --basetemp=validation/aurora-local-restart/.state/backup-next --junitxml=validation/aurora-local-restart/backup-next.xml
```
