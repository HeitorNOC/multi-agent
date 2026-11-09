# Fila durável do Aurora · 05/11/2026

O [ensaio posterior de concorrência](CONCURRENCY.md) comparou este perfil de um worker com o perfil opcional de dois, sob a mesma carga local.

O Aurora admite novos trabalhos enquanto existe uma execução ativa. A fila fica no SQLite da sessão, com WAL e sincronização integral. A API grava o trabalho, o evento e a entrada da fila na mesma transação e devolve HTTP 202 com o identificador. O launcher do Aurora configura 32 vagas de espera. Ao atingir o limite, a API responde 429 e inclui `Retry-After`. A execução segue com um worker ativo por instalação. As sessões que usam o servidor comum sem configurar fila mantêm o contrato anterior.

Pedidos com `Idempotency-Key` repetida e o mesmo cenário recebem o trabalho original, mesmo com a fila cheia ou depois de reiniciar a API. A mesma chave com cenário divergente recebe 409. A interface exibe ocupação e o estado **Na fila** e reutiliza a chave se a tentativa falhar na sessão atual do navegador.

A execução segue a ordem em que os pedidos foram gravados. A aprovação humana continua vinculada ao hash da proposta. Quando há espaço, aprovação e entrada de retomada são gravadas juntas. A fila libera o executor enquanto um trabalho aguarda revisão. O recibo do efeito simulado permanece único por trabalho.

## Recuperação

O launcher tenta religar a API até três vezes durante a sessão, com o mesmo endereço, diretório e credenciais. Em reinício da API, os pedidos em espera permanecem enfileirados. Um trabalho que já estava em execução aparece como interrompido e exige retomada explícita. A retomada passa pelo estado dos slots de inferência e pelo checkpoint LangGraph. Se o runtime estiver indisponível antes do despacho, o pedido permanece na fila.

Um lock SQLite impede dois processos API de operarem o mesmo diretório. Uma credencial efêmera vincula os comandos ao worker ativo. O worker usa um lock de sessão PostgreSQL por trabalho para impedir dois processos de executarem o mesmo checkpoint. Esses mecanismos foram qualificados em uma instalação local.

## Ensaio com trabalhos completos

O teste usou a API, o worker do Aurora, LangGraph, PostgreSQL e o serviço de recibos reais. O retorno de modelo e o transporte de fontes foram controlados. Zero chamadas de modelo comercial. A fila do ensaio tinha oito vagas para testar saturação e reinício em uma janela curta.

- Uma rajada de 24 pedidos com um trabalho ativo admitiu oito e recusou 16 com 429. O mesmo pedido pôde ser consultado pela chave de admissão, com a fila cheia e após reinício.
- Os oito pedidos sobreviveram à queda da API e saíram na ordem persistida. O primeiro trabalho, em execução no momento da queda, ficou interrompido e passou por retomada separada. O teste recusou uma segunda instância da API no mesmo diretório e chamadas do worker antigo.
- Após revisão, oito trabalhos chegaram a `completed`. O teste interrompeu um worker após gravar o efeito. O novo processo recebeu o mesmo recibo, sem criar novo efeito nem consumir outro slot. O nono trabalho foi rejeitado na revisão.
- Foram registradas 36 reservas e 36 despachos controlados para produzir nove pareceres, com exatamente oito efeitos simulados ao final.

Na primeira prova, os oito trabalhos chegaram à revisão em **19,93 s** depois que o runtime voltou e concluíram em **14,23 s** a partir do primeiro envio de aprovação. O p95 observado de espera na fila foi **17,72 s**, considerando também as retomadas. São medidas do perfil controlado com oito vagas e um executor. [Métricas da primeira execução](evidence-294516e08d.json) · [JUnit](run01.xml)

A repetição final reiniciou a API **no mesmo endereço** e confirmou o bloqueio do executor antigo. Os oito trabalhos chegaram à revisão em **20,09 s** após liberar o runtime e concluíram em **15,07 s** a partir do primeiro envio de aprovação. O p95 de espera na fila foi **17,98 s**. O cenário confirmou a recusa de uma aprovação com hash divergente. [Métricas finais](evidence-cfdbb65fef.json) · [JUnit final](same-port.xml)

## Reprodução

```powershell
New-Item -ItemType Directory -Path validation/aurora-queue/.state -Force | Out-Null
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest validation/aurora-queue/test_queue.py validation/aurora-model-slots/test_slots.py -q --tb=short --basetemp=validation/aurora-queue/.state/next --junitxml=validation/aurora-queue/next.xml
node demo-enterprise/build.cjs
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo/tsconfig.json
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo-enterprise/tsconfig.json
```

A primeira execução Python passou com quatro testes, incluindo três regressões de slots e recuperação. Os 33 testes Node passaram, assim como a compilação e os dois projetos TypeScript em modo estrito. A UI recebeu verificação por build e contratos HTTP. [Log Node](node.log)

**Aceite local. Produção segue NO-GO.** A fila melhora a admissão e a continuidade no reinício da API. O launcher inteiro ainda cria uma sessão nova quando iniciado do zero. Resta qualificar a retomada dessa sessão após perda do host, a concorrência de execução, o orçamento por trabalho, a carga sustentada e os conectores do ambiente alvo.
