# Primeiro piloto com documentos reais do Tatodesk

**Pergunta avaliada:** Quais estados e evidências são necessários para que uma conversa passe do MBA para um atendente sem que ambos respondam ao mesmo tempo?

## Preparação

O piloto recebeu transcrições UTF-8 de páginas pertinentes de três PDFs vigentes. As quebras visuais das páginas foram reunidas em linhas lógicas, com mapeamento da linha de texto para a página original e SHA-256 de cada transcrição.

| Fonte | Páginas publicadas na sessão |
| --- | --- |
| Fluxo de Mensageria | 9, 10 e 12 |
| Resumo do Meta Business Agent na 360dialog | 3, 4 e 8 |
| Contact Center e Workspace | 9, 11, 13, 15, 16 e 17 |

## Resultado da execução

O Aurora executou a pergunta original com GPT-6.1 Terra. O Chief mobilizou a Diretora de Tecnologia e o Analista de Dados, uma dupla coerente com a análise de integração e estados. Foram registradas quatro chamadas, 50.239 tokens de entrada, dos quais 11.392 em cache, e 587 tokens de saída. O custo faturado não foi medido.

O recuperador selecionou três candidatos. Dois eram descrições gerais do MBA na página 3 do resumo. O terceiro tratava do encerramento pelo cliente, na página 16 do Contact Center. O PDF de fluxo não apareceu entre os candidatos, embora contenha evidência sobre eventos e roteamento nas páginas 10 e 12. A síntese devolveu evidência insuficiente e nenhuma citação. O trabalho chegou à revisão humana, e a sessão temporária foi encerrada sem aprovação.

**Avaliação.** A orquestração chegou ao parecer e a abstenção foi adequada aos trechos que chegaram ao modelo. A recuperação não passou no critério de cobrir os estados e os eventos pertinentes em mais de um documento. Uma busca diagnóstica no host, com termos explícitos como `WAITING`, `ACTIVE` e `standby`, encontrou evidências melhores no Contact Center e no fluxo, mas ainda deixou `control_passed` fora dos seis primeiros. Essa busca diagnóstica não chamou o modelo.

[Registro da execução](aurora-piloto-handoff.json)

## Comparação de recuperação

A pergunta e as transcrições permaneceram idênticas. O manifesto manteve o mesmo SHA-256 nas três execuções do Aurora. O modo híbrido combina similaridade dos embeddings locais multilíngues com correspondência de termos. A variante assistida acrescenta seis consultas técnicas configuradas manualmente para a pergunta exata. O modelo de resposta recebeu a pergunta original e os trechos selecionados.

| Busca | Candidatos / PDFs | Cobertura observada |
| --- | --- | --- |
| Lexical | 3 / 2 | Descrição do MBA e encerramento do atendimento. O parecer declarou evidência insuficiente. |
| Híbrida automática, medição local | 6 / 3 | Encontrou trechos gerais sobre sessão e controle. Os estados e eventos esperados ficaram fora dos seis primeiros. |
| Híbrida assistida, execução integrada | 6 / 3 | Encontrou `WAITING`, `ACTIVE`, `control_passed`, `STANDBY_CUSTOMER`, a transição entre `ML_MODEL` e `HUMAN` e limitações da transferência. |

A busca híbrida devolveu zero trechos para uma pergunta de controle fora do assunto. A cobertura da variante assistida demonstra o efeito de uma configuração específica deste caso. Sua generalização ainda precisa ser medida em perguntas inéditas.

A primeira execução assistida registrou seis candidatos e terminou em `recovery_required` durante a etapa de especialistas. O registro disponível não determinou a causa da interrupção. Uma nova sessão repetiu os seis candidatos, concluiu a síntese e registrou `supported_extracts` com quatro citações verificadas pelo backend. O parecer citou os dois estados do atendimento, o evento descrito no PDF de fluxo e a transição de tipo de sessão. `STANDBY_CUSTOMER` e as limitações do provedor chegaram à recuperação e ficaram fora das quatro citações. A transcrição da tabela de `standby` na página 9 do Fluxo também uniu duas colunas. O ensaio manteve esse texto para preservar a comparação e conferiu a linha na página renderizada.

A reexecução usou o GPT-6.1 Terra em quatro chamadas, com 47.915 tokens de entrada, dos quais 9.088 em cache, e 1.036 tokens de saída. As quatro chamadas terminaram com código zero e sem eventos de ferramenta inesperados. O custo faturado não foi medido. O resultado chegou a `awaiting_approval`, e a sessão foi encerrada sem aprovação.

Na regressão com dados fictícios, passaram os cinco testes, incluindo o fluxo com API e PostgreSQL locais. A primeira tentativa da regressão esbarrou na restrição do sandbox ao socket de loopback. A reexecução com acesso local completou a mesma suíte em 49,55 segundos. [JUnit da regressão](../validation/aurora-local-restart/pilot-hybrid-loopback.xml)

O resultado valida a recuperação assistida de evidências para revisão documental nesta pergunta. A cobertura da busca automática e a completude do parecer ainda são insuficientes para homologar o conhecimento. O comportamento do canal e o bloqueio de respostas simultâneas exigem um ensaio da integração.

[Primeira execução híbrida](aurora-piloto-handoff-hibrido.json) · [Reexecução híbrida](aurora-piloto-handoff-hibrido-reexecucao.json)

## Referência de avaliação

Os PDFs descrevem dois eixos distintos. O roteamento de mensageria registra `STANDBY_CUSTOMER`, `STANDBY_AGENT` e uma origem interna para `control_passed`; a sessão do Tatodesk é classificada como `ML_MODEL` ou `HUMAN` (Fluxo, pp. 10 e 12). O Contact Center registra `WAITING` quando o atendimento é criado, `ACTIVE` quando um atendente assume e `DONE` quando encerra. O fluxo existente muda a sessão para `HUMAN` ao abrir um atendimento digital (Contact Center, pp. 9 e 11). Esses registros descrevem o sistema de referência.

A documentação da 360dialog descreve `standby` quando o MBA atende e `messages` quando a aplicação recebe o tráfego sob seu controle. Ela informa que `messaging_handovers` ainda não é encaminhado ao webhook e que a API não oferece leitura direta do responsável atual. Também distingue `pass` para `ai_agent` de `release`, que deixa a conversa em estado ocioso, e alerta para perda de contexto no retorno. As capacidades publicadas ainda precisam de prova no número e na configuração que serão usados. [Webhooks](https://docs.360dialog.com/docs/mba/webhooks) · [Limitações](https://docs.360dialog.com/docs/mba/meta-business-agent/known-limitations)

## Modelo de estados proposto

| Estado | Evidência para entrar | Regra de saída de mensagem |
| --- | --- | --- |
| MBA em controle | Roteamento observado em `standby` para a conversa e integração corretas | O núcleo registra entradas e respostas do MBA. O Contact Center observa o histórico. |
| Transferência pendente | Intenção de handoff persistida e correlacionada à conversa | Resposta humana comum bloqueada. Uma tomada de controle por envio, se o papel de escalonamento exigir esse mecanismo e o ensaio real o confirmar, deve ser uma operação explícita, única e auditada. |
| Controle interno observado, humano na fila | Evidência aceitável de mudança de roteamento e atendimento em `WAITING` | Mensagens podem entrar no histórico da fila. A saída humana aguarda atribuição. |
| Humano ativo | Controle interno observado e atendimento em `ACTIVE`, com operador autorizado | O pipeline libera o envio humano após revalidar versão do estado e identidade. |
| Controle incerto | Tempo excedido, evidência divergente, fora de ordem ou ausente | Segura o envio automático, preserva o histórico e encaminha para conciliação. |

O comando de transferência, a observação do canal e a atribuição ao operador precisam ser persistidos separadamente. Para impedir corrida local, o envio deve carregar a versão do controle da conversa e ser validado imediatamente antes de sair pelo canal. Uma confirmação antiga, repetida ou de outro número não pode liberar a saída. Essa é uma proposta para o novo projeto. A presença de um evento no documento do Tatodesk não demonstra sua entrega pela 360dialog.

## Seleção automática com acervo misto

A rodada repetiu a pergunta de handoff pela API, com o launcher regular, LangGraph, PostgreSQL, embeddings locais e GPT-6.1 Terra. As duas sessões usaram a mesma pergunta, sem nomes de arquivos ou subconsultas preparadas. A primeira preservou os três recortes reais e seus hashes. A segunda adicionou três controles vigentes e pesquisáveis, sobre treinamento, Webchat de demonstração e um MBA acadêmico. Os dois últimos foram escritos para compartilhar vocabulário com a tarefa. Os PDFs originais ficaram em leitura e ambas as sessões foram encerradas sem aprovar o parecer.

| Acervo integrado | Trechos retornados de outros contextos | Parecer | Tempo da tarefa | Tokens de entrada / saída |
| --- | ---: | --- | ---: | ---: |
| Três recortes reais | 0/6 de fontes adicionadas | Evidência insuficiente, 0 citações | 28,67 s | 49.206 / 575 |
| Mesmos recortes mais três controles sintéticos | 3/6, nas três primeiras posições | Evidência insuficiente, 0 citações | 28,72 s | 50.793 / 575 |

Nos dois trabalhos, o Chief selecionou Diretora de Tecnologia e Analista de Dados. Cada trabalho consumiu quatro chamadas ao modelo. Houve 11.392 e 43.264 tokens de entrada em cache, respectivamente. Todas as chamadas terminaram com código zero e sem eventos inesperados de ferramenta. O tempo vai da admissão ao estado `awaiting_approval`, sem incluir a inicialização. O gasto faturado não foi medido. [Execução com recorte](aurora-handoff-focused-auto.json) · [Execução com controles](aurora-handoff-mixed-auto.json)

### Comparação no host com os sete PDFs reais

O teste local repetiu o ranking dos dois trabalhos integrados e acrescentou recortes dos outros quatro PDFs. Entraram Base de Conhecimento do MBA Frontend (pp. 4, 7 e 15), Reclame Aqui (pp. 3, 7, 10 e 12), Guia de Desenvolvimento (pp. 8, 24 e 39) e Mapa do Portal (pp. 9, 13, 17 e 19). Seus trechos ficaram no host. A pertinência depende da pergunta. O guia pode ser necessário para implementar o projeto e ainda assim ficar fora de uma resposta sobre estados de handoff.

| Base local | Trechos indexados | Trechos adicionais entre os seis do handoff | Evidências da bateria | Perguntas completas |
| --- | ---: | ---: | ---: | ---: |
| Três recortes | 206 | 0 | 6/16 | 2/10 |
| Três recortes mais controles sintéticos | 213 | 3 | 6/16 | 2/10 |
| Recortes dos sete PDFs reais | 370 | 2 | 6/16 | 2/10 |

Na base real mista, a busca trouxe o Mapa do Portal p. 9, que descreve funcionalidades de gestão de equipes, e o guia de frontend do MBA p. 4, sobre navegação e onboarding. Nenhum dos dois demonstra a transição de controle da conversa. Em um controle sem resposta sobre o limite de `startAttendance`, quatro dos seis candidatos vieram da documentação de Reclame Aqui, incluindo a página do limite da API daquele canal. Esse resultado mede candidatos. A resposta final para esse controle e a síntese com os sete PDFs reais ficaram fora da execução integrada. [Ranking por consulta](aurora-handoff-local-auto.json)

### Decisão

A abstenção funcionou nas duas execuções integradas. A busca automática ficou abaixo dos critérios existentes de 9/10 perguntas completas e 90% de recuperação das evidências. No fluxo atual, o Chief escolhe a equipe antes da busca e avalia apenas os candidatos já ranqueados. A escolha autônoma de fontes na base mista segue em validação. A próxima prova deve medir se o Chief consegue orientar uma segunda busca por subquestão e se o ranqueamento distingue canal, processo e aplicabilidade, preservando o limite de seis na saída. Os critérios devem ser medidos com perguntas inéditas sem indicação de arquivos e com controles de assunto parecido que exigem abstenção.

Para reproduzir, execute `run_mixed_corpus.py` com `focused`, `mixed` ou `local`, `--hybrid-auto` e `--output` apontando para um novo arquivo. O modo `local` usa somente o serviço de embeddings no host. [Roteiro](../validation/.tools/aurora-piloto-handoff/run_mixed_corpus.py)

## Segunda busca orientada pelo Chief

O ensaio de bancada fixou seis novas formulações, quatro com evidência esperada e dois controles sem resposta no recorte. A base tinha 377 trechos de dez documentos, com recortes dos sete PDFs e três controles sintéticos. As perguntas foram enviadas sem nomes de arquivos. O Chief recebeu a pergunta e apenas os trechos da primeira busca pertencentes às três fontes usadas nas execuções integradas anteriores. Os outros PDFs, os controles, o gabarito e os resultados da segunda busca permaneceram locais.

O GPT-6.1 Terra pôde solicitar uma única rodada complementar com até três consultas distintas. O backend da bancada validou o JSON, a quantidade, o tamanho e a duplicação de consultas. A busca preservou a pergunta original e recuperou até 24 candidatos por consulta. O mesmo cross-encoder local foi usado nos dois modos com reordenação, com título da fonte e trecho como entrada. A lista final ficou limitada a seis candidatos em todos os modos.

| Variante | Evidências localizadas | Perguntas com cobertura completa |
| --- | ---: | ---: |
| Busca híbrida atual | 2/8 | 1/4 |
| Pergunta original com reordenação local | 2/8 | 1/4 |
| Segunda busca orientada pelo Chief com reordenação | 4/8 | 2/4 |

A busca orientada recuperou as duas evidências da auditoria de mensagens, sobre o payload original e a persistência da mensagem normalizada. Na pergunta de frontend, os três modos encontraram o trecho de onboarding que estava em uma fonte fora do primeiro piloto. A publicação gradual do agente da Meta continuou parcial. No handoff, o replay local mostrou que `HUMAN` e `control_passed` chegaram à lista interna, mas saíram antes dos seis primeiros. O trecho de referência para `ACTIVE` ficou fora das listas internas de 24. Os dois controles sem resposta ainda produziram candidatos. A bancada não executou a síntese nem verificou a abstenção nesses dois controles.

As seis chamadas ao Codex concluíram sem erros e sem eventos inesperados de ferramenta. Cada uma levou de 4,46 a 5,78 s e as seis somaram 73.576 tokens de entrada, incluindo 34.176 em cache, e 318 de saída. O ensaio mede uma única amostra pequena e reutiliza os documentos conhecidos. A estratégia é útil como experimento, mas ficou abaixo do critério de 90% de recuperação. A integração ao fluxo do piloto ficou pendente. Para o handoff, a próxima comparação deve separar um canal lexical para eventos e estados exatos de uma seleção final que preserve pelo menos uma evidência aplicável por subquestão. [Resultado por pergunta](aurora-chief-segunda-busca.json) · [Gabarito](../validation/.tools/aurora-piloto-handoff/chief-search-cases.json)

```powershell
$env:PYTHONPATH = (Resolve-Path 'apps/aurora/.venv/Lib/site-packages').Path
$auroraValidationPython = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $auroraValidationPython -X utf8 validation/.tools/aurora-piloto-handoff/compare_chief_search.py `
  --output reports/aurora-chief-segunda-busca-reexecucao.json
```

## Critério do próximo ensaio de delegação

Hoje o Chief seleciona cada diretor e seus especialistas no plano inicial. O subgrafo executa os especialistas antes de chamar o diretor para revisar os resultados. O próximo ensaio deve comprovar que o diretor também toma decisões durante a execução. [Subgrafo atual](../apps/aurora/runtime/worker.py)

- **Chief of Staff.** Define as entregas de cada área e escolhe o diretor e o grupo de especialistas autorizado para a tarefa. Também define os limites de ferramentas, acesso e orçamento. Arbitra dependências entre áreas e consolida o parecer.
- **Diretor.** Divide a entrega em subtarefas e decide quais membros do grupo acionar, com que instruções e em que ordem. Pode executar atividades independentes em paralelo, pedir uma busca complementar e devolver achados para correção dentro dos limites recebidos. Se precisar de outra área, agente ou permissão, solicita ao Chief.
- **Especialista.** Executa a subtarefa delegada, apresenta fontes e lacunas e devolve o resultado ao diretor. O diretor confere as evidências antes de entregar o parecer da área.

O cenário de aceitação deve usar pelo menos duas diretorias e incluir um especialista autorizado que o diretor decide deixar disponível. Um diretor deve emitir subtarefas distintas, revisar um retorno e acionar uma rodada complementar por falta de evidência. O ensaio deve verificar a recusa de uma tentativa de acionar agente fora do grupo, além da retomada sem duplicar atribuições concluídas. O painel deve distinguir quem o Chief autorizou, quem o diretor efetivamente acionou e a razão de cada nova atribuição.
