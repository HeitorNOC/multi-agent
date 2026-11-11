# Aurora — plano do núcleo: uma empresa de agentes

O Aurora **é uma empresa**. O dono (o "CEO" daqui em diante) faz pedidos como faria a uma empresa
de verdade, e ela funciona como uma: o Chief of Staff recebe o pedido, entende, planeja com os
diretores, devolve o plano para o CEO aprovar, distribui o trabalho pelos times, revisa o que
volta, manda corrigir o que está fora do padrão e só leva ao CEO o que exige a decisão dele.

Não há módulos de negócio (campanha, atendimento, fiscal). O conhecimento está nos agentes e no
Cérebro, os recursos e as ferramentas vêm do CEO, e o resto é o núcleo, onde este plano investe.

## 1. Como um pedido anda (o modelo de empresa)

Exemplo-guia: *"Quero implementar o módulo de atendimento por WebChat, como um microserviço."*

```
CEO ──pedido──► Chief of Staff
                 │ 1. Entende: conversa com o CEO só sobre o que falta
                 │ 2. Levanta: documentos, padrões da empresa, projetos existentes, recursos disponíveis
                 │ 3. Analisa o que falta (lacunas) e escreve os requisitos
                 │ 4. Delega a especificação (opcional): Diretor de TI, Tech Lead, Diretor executivo…
                 │      cada diretor detalha a sua parte, com o seu time se precisar
                 ▼
CEO ◄──plano── Chief (requisitos, arquitetura, times, etapas, recursos, riscos, custo estimado)
 │ aprova · modifica · cancela
 ▼
Chief ──distribui──► Diretores ──distribuem──► Especialistas
                        │  constroem (projetos, estruturas, código, testes, documentação)
                        │  revisão do diretor sobre o próprio time
                        ▼
                     Chief revisa contra o plano e os padrões
                        ├─ desvio de padrão / qualidade → volta ao diretor para corrigir (sem o CEO)
                        ├─ decisão dentro da alçada do Chief → decide e registra
                        └─ algo crítico (escopo, custo, segurança, efeito externo) → leva ao CEO
                     … até estar tudo pronto
                        ▼
CEO ◄──entrega── Chief (o que foi feito, como foi verificado, o que precisa da decisão dele)
```

Três ideias sustentam isso:

1. **Hierarquia real.** Diretores são agentes com time próprio (o organograma que já existe:
   quem responde a quem). Um diretor recebe uma parte do trabalho, divide entre os especialistas
   dele, revisa e responde ao Chief. O Chief não microgerencia especialista por especialista.
2. **Duas fases com aprovação no meio.** Planejamento (barato: leitura, análise, especificação)
   e execução (cara: construção). A execução só começa com o plano aprovado pelo CEO, e o plano
   aprovado vira a referência de todas as revisões.
3. **Alçadas.** Cada decisão tem dono. O CEO define nas configurações o que o Chief resolve
   sozinho e o que sobe para ele; o Chief faz o mesmo com os diretores. Tudo fica na trilha: quem
   decidiu, com qual regra.

## 2. Onde o núcleo está hoje

| Parte | Hoje | Limite para o modelo de empresa |
| --- | --- | --- |
| Time | O CEO contrata do catálogo (37 personas, 10 áreas) e define a quem cada um responde. O Chief só escala quem já está no time. | O Chief não sugere nem traz quem falta; diretores não lideram nada na execução. |
| Chief | Decide entre responder ou abrir **um** tipo de trabalho (parecer); conhece a situação da empresa. Respostas de até 1.200 caracteres. | Não levanta o que falta, não escreve requisitos, não devolve plano para aprovação. |
| Orquestração | Fluxo fixo (plano → pesquisa → síntese → aprovação → efeito), até **3** especialistas em sequência, sem hierarquia. Checkpoints e retomada. | Sem fase de planejamento separada, sem delegação a diretores, sem ciclo de revisão e correção. |
| Cérebro | BM25 + vetores, trechos de 800 caracteres, **6 por especialista**, uma consulta fixa. Vigência, permissões, citações. | Não distingue padrão da empresa de documento comum; não enxerga projetos de código; planilhas sem cálculo. |
| Memória | Histórico inteiro guardado; o Chief lê as **últimas 10 mensagens, 500 caracteres cada**. | Um projeto de semanas perde o fio; decisões não ficam registradas à parte. |
| Recursos e ações | Pasta, Drive, Gmail, Slack (ler e entregar parecer). Agentes só leem o Cérebro. | Não há registro de recursos (banco, fila, ambientes, repositórios), nem execução de engenharia, nem ações pelas integrações. |

## 3. Fases

Cada fase fecha com testes nos dois bancos e um critério de pronto observável.

### N1 — Time, hierarquia e autonomia — concluída (11/11/2026)

Como ficou: a proposta de contratação acontece **na conversa, antes de o trabalho abrir** (não é
uma pausa no meio da execução). É onde o N2 vai acontecer (o Chief propõe plano e time e o CEO
aprova antes da execução) e não mexe no estado do trabalho. Ajustar e tirar do time já são
alçadas guardadas e mostradas; o Chief passa a usá-las no N3, quando revisar o time na execução.
Sem modelo, o Chief por regras reconhece pedidos como o CEO fala ("quero", "preciso",
"implemente", "monte"…) e usa uma regra de cobertura por palavras em comum para achar quem falta.


- **Diretores com time:** um agente pode liderar outros (já há "responde a"); o catálogo ganha
  papéis de liderança por área (Diretor de TI, Tech Lead, Diretor executivo, Diretor de marketing…)
  com o que cada um revisa.
- **Autonomia do Chief** (Configurações › Alçadas):

| Configuração | Opções | Padrão |
| --- | --- | --- |
| Trazer agente que falta | Nunca · Propor e esperar aprovação · Contratar sozinho dentro dos limites | Propor |
| Tipo de contratação pelo Chief | Só para o trabalho · Permanente | Só para o trabalho |
| Limites | Agentes por trabalho; áreas permitidas | 8; todas |
| Ajustar o time (orientações, a quem responde) | Nunca · Propor · Sozinho | Propor |
| Tirar agente do time | Nunca · Propor | Nunca |

- Proposta de contratação é um cartão de aprovação (agente, porquê, por quanto tempo). Contratado
  "só para o trabalho" sai ao fim; o histórico fica.

**Pronto quando:** para o WebChat, com um time sem Tech Lead, o Chief propõe o Tech Lead do
catálogo, que entra só nesse trabalho.

### N2 — Planejamento: o Chief entende, levanta e devolve o plano — concluída (11/11/2026)

Como ficou: com o modelo ligado, pedidos de construção, implementação, campanha ou projeto viram
planejamento na conversa. O Chief pergunta só o que falta (até 3 perguntas), escreve o brief,
consulta o Cérebro (só o que o CEO pode ler) e propõe etapas com responsáveis do time ou do
catálogo, riscos e as fontes usadas. O CEO ajusta escrevendo, aprova a versão que está vendo
("Aprovar e começar") ou cancela. Aprovado, o trabalho nasce com o pedido montado do brief e com
o time do plano (`jobs.preset`): o worker usa este time em vez de pedir ao modelo, e quem o plano
traz do catálogo entra na mesma transação. Planos aguardando aprovação aparecem no Command Center,
no Jarvis e no briefing do Chief. Sem modelo, o Chief por regras continua abrindo o trabalho
direto (e, se houver plano em elaboração, só explica ou cancela).

Passo 4 (delegação aos diretores): o plano indica em `specify` os diretores e líderes que detalham
a sua parte; ele fica "Diretores detalhando" (não pode ser aprovado), cada um escreve requisitos,
componentes, riscos e perguntas em segundo plano (`SpecificationRunner`, retoma depois de
reiniciar), e o Chief consolida numa versão nova que volta ao CEO. Se um diretor falhar ou a
consolidação não sair, o plano volta como estava, com o que houver.


1. **Entende:** pergunta ao CEO só o que falta (canais, volume, integrações, prazo, o que conta
   como pronto). Pedido completo não gera pergunta.
2. **Levanta:** busca no Cérebro os documentos, os **padrões da empresa** (N4), os **projetos
   existentes** (N4) e os **recursos disponíveis** (N6).
3. **Analisa o que falta:** o que já existe e pode ser reaproveitado (ex.: o microserviço de
   autenticação), o que precisa ser criado, o que falta de recurso ("não há fila configurada").
4. **Escreve os requisitos** e, conforme o pedido, **delega a especificação** aos diretores: o
   Diretor de TI define arquitetura e integrações, o Tech Lead detalha serviços, contratos e
   testes, o Diretor executivo avalia prioridade e custo. Cada diretor pode envolver o seu time.
5. **Consolida e devolve ao CEO:** requisitos, arquitetura, times e responsáveis, etapas,
   recursos usados e faltantes, riscos, estimativa de custo (chamadas e tokens). O CEO **aprova,
   modifica** (o Chief replaneja só o que mudou) ou **cancela**.

**Pronto quando:** o pedido do WebChat vira um plano revisável, com o que reaproveita dos projetos
existentes e os padrões que vai seguir citados, e nada é construído antes do "aprovado".

### N3 — Execução hierárquica e revisão em cadeia — concluída (11/11/2026)

Como ficou: o plano aprovado vai ao trabalho com as etapas (dependências e revisor por etapa,
escolhido pela hierarquia: diretor da área no plano, senão o líder, senão o Chief). O worker chama
`advance` até acabar; para cada etapa, o responsável entrega (com as entregas anteriores, o retorno
da revisão e os trechos do Cérebro) e o revisor aceita, manda refazer (até 3 tentativas) ou leva ao
CEO. Escalação e tentativas esgotadas param a execução e aparecem no parecer, na frente do botão de
aprovar. Cada entrega e revisão tem recibo (queda retoma sem refazer) e conta no orçamento do plano.
A lista operacional, o organograma e o Jarvis mostram quem está entregando ou revisando qual etapa.
Etapas rodam em sequência (respeitando as dependências); rodar em paralelo fica para quando houver
mais de um worker por trabalho. O Chief ainda não altera o time durante a execução (as alçadas de
ajustar e tirar do time ficam guardadas para isso).


- **Plano como árvore de tarefas:** cada tarefa tem dono (diretor ou especialista), dependências,
  entradas (o que recebe das anteriores), entrega esperada e critério de aceite. O worker LangGraph
  executa em ondas: o que não depende de nada pendente roda em paralelo; a saída de uma tarefa é
  entrada das seguintes.
- **Diretor como sub-orquestrador:** recebe a sua parte, divide entre o time, revisa e devolve ao
  Chief. O mesmo motor em dois níveis (Chief → diretores → especialistas).
- **Revisão em cadeia:** especialista → diretor (qualidade da área) → Chief (plano e padrões).
  Fora do padrão volta para correção com o motivo; limite de tentativas; esgotado o limite, sobe.
- **Escalonamento por alçada:**

| Sobe para o CEO | O Chief resolve e registra |
| --- | --- |
| Mudança de escopo ou do plano aprovado | Desvio de padrão (manda corrigir) |
| Custo acima do estimado (limite configurável) | Escolha técnica dentro do plano e dos padrões |
| Segurança, dados pessoais, acesso novo a recurso | Ordem e paralelismo das tarefas |
| Qualquer efeito externo (publicar, enviar, merge, deploy) | Refação de uma entrega |
| Conflito entre diretores sem acordo | Contratação dentro da alçada (N1) |

- **Orçamento por trabalho:** teto de chamadas e tokens por tarefa e no total; perto do teto, o
  Chief pergunta ao CEO.
- Lista operacional, organograma e Jarvis mostram a árvore real: quem está em qual tarefa, o que
  voltou para correção, o que espera o CEO.

**Pronto quando:** no WebChat, o Tech Lead recebe um serviço sem testes de um especialista,
devolve; o Chief encontra um desvio do padrão de logs, devolve ao Diretor de TI; nenhum dos dois
casos chega ao CEO; a criação do repositório sobe para aprovação; derrubar o worker no meio retoma
da tarefa em que parou.

### N4 — Cérebro: padrões, projetos e recuperação — concluída (11/11/2026)

Como ficou: avaliação no CI (`retrieval-eval.test.ts`: acerto nos 3 primeiros, MRR e abstenção;
a busca dos agentes faz 100% contra 92% de uma consulta só); busca dos agentes com várias
consultas (as partes do pedido), fusão por posição, reordenação por cobertura e título, e uma
passada pelos títulos das fontes; trechos vizinhos como contexto; resumo extrativo por documento;
tabelas (CSV) com resumo calculado de todas as linhas (média, soma, por categoria); banco
PostgreSQL somente leitura como conector; repositório do GitHub como fonte (os projetos
existentes). Resumos por área ficaram de fora de propósito: juntariam fontes com leitores
diferentes. Padrões entram como documentos comuns (achados pela busca e pelo título); marcá-los
como checklist de revisão é o próximo passo natural.


1. **Avaliação primeiro:** perguntas da empresa com resposta e fontes esperadas; mede recuperação,
   citação e abstenção. Roda no CI; toda mudança é medida contra ela.
2. **Padrões da empresa como fonte especial:** documentos marcados como "padrão" (arquitetura,
   código, segurança, marca, atendimento) viram **checklists de revisão** usados pelo Chief e pelos
   diretores no N3, e entram sempre no contexto de quem constrói na área.
3. **Projetos existentes:** conector de repositório Git somente leitura; o código é indexado com
   estrutura (serviços, contratos, dependências, configurações), não só como texto, para o Chief
   saber o que reaproveitar.
4. **Busca planejada pela tarefa** (o agente formula as consultas, várias rodadas com limite),
   **reranqueamento** local, **contexto em volta do trecho** e **resumos por documento, área e
   projeto**, versionados com a fonte.
5. **Dados tabulares** consultáveis e **banco somente leitura** como fonte (dashboards).

**Pronto quando:** a avaliação mostra ganho sobre a linha de base atual, e o plano do WebChat
cita o padrão de arquitetura e o projeto de autenticação que vai reaproveitar.

### N5 — Memória — concluída (11/11/2026)

Como ficou: decisões registradas por conversa (plano aprovado ou cancelado, contratação decidida,
"fica decidido…" e o que o Chief registra com o modelo), resumo extrativo do que sai da janela,
mensagens antigas relevantes de volta ao contexto, "o que decidimos?" respondido sem modelo, botão
Memória na conversa. Memória da empresa em Configurações (fatos por categoria) para o Chief e
todos os agentes. O prompt do Chief monta fatos, memória e histórico dentro de um orçamento.


- **Da conversa:** resumo acumulado, **decisões registradas** à parte e busca no histórico inteiro.
- **Da empresa:** fatos estáveis (produtos, clientes, marca, stack) que o CEO vê e edita.
- **Do trabalho:** requisitos, plano aprovado, decisões e entregas acompanham cada tarefa.
- **Contexto com orçamento:** cada papel recebe o contexto montado por prioridade (pedido, plano,
  decisões, padrões, trechos) dentro de um limite de tokens.

**Pronto quando:** semanas depois, "e o WebChat?" traz o plano, as decisões e o andamento, sem o
CEO repetir nada.

### N6 — Recursos da empresa e execução — concluída (11/11/2026)

Como ficou: cadastro de recursos (bancos, filas, ambientes, repositórios, nuvem) em Integrações,
só descrições (descrição com cara de senha é recusada); o Chief planeja com eles, o plano diz o que
usa e o que falta provisionar, e o pedido do trabalho os descreve. Conectores de ação com o mesmo
portão de sempre (entrega aceita + clique do CEO): GitHub (lê o repositório e abre pull request com
a entrega e os arquivos de código das etapas; nunca faz merge, o CI do repositório testa),
WhatsApp Business (mensagem) e Página do Facebook (post). Testados com HTTP simulado; com contas
reais, falta a aprovação da Meta (conta empresarial, app revisado, modelos fora da janela de 24 h).
A compilação e os testes do código entregue acontecem no CI do repositório, no pull request (não
num ambiente isolado do Aurora). Instagram fica para depois (exige imagem em cada post).


- **Registro de recursos (o CEO fornece):** bancos, filas (Kafka…), ambientes, repositórios,
  nuvem, com credenciais no cofre e escopo (o que pode ser usado, por quem, com que permissão).
  O Chief planeja com o que existe e pede o que falta ("preciso de um tópico Kafka para eventos de
  atendimento").
- **Execução de engenharia em ambiente isolado:** especialistas de TI trabalham numa cópia de
  trabalho do repositório (criar estrutura, escrever código, rodar build e testes) num ambiente
  isolado por trabalho, sem acesso além dos recursos liberados. A entrega é um pull request com
  descrição, testes e evidências; **merge e deploy só com aprovação**.
- **Ações pelas integrações:** publicar, enviar mensagem, consultar, com o conteúdo exato aprovado
  ou pré-autorização com regras (sempre registrada). Meta (Instagram, Facebook, WhatsApp) exige
  conta empresarial verificada e app aprovado.
- **Entregas com material:** código, documentos, imagens, planilhas e painéis, versionados.

**Pronto quando:** o WebChat termina como um pull request no repositório da empresa, com o
serviço, os contratos, os testes passando no ambiente isolado e a documentação, aprovado pelo
Chief e aguardando o merge do CEO.

## 4. Casos de aceite

1. **Módulo de atendimento por WebChat** (fio condutor): N1 → N2 → N3 → N4 (padrões e projetos)
   → N6 (recursos e execução).
2. **Campanha de promoção:** mesmo motor, time de marketing, ação pelo Instagram e WhatsApp.
3. **Dashboard de avaliações e canais:** N4 (tabelas e banco somente leitura) + entrega de painel.
4. **Políticas e documentos:** já atendido; N4 melhora perguntas amplas e comparações.

## 5. Decisões para o CEO confirmar

| Decisão | Recomendação |
| --- | --- |
| Padrão das alçadas | Chief propõe contratações; desvio de padrão ele resolve; escopo, custo acima do estimado, segurança e efeito externo sobem |
| Agentes por trabalho | 8 |
| Ordem das fases | N1 → N2 → N3, com a avaliação do N4 começando junto; depois N4, N5 e N6 |
| Executor de engenharia | O Claude Code em modo não interativo (o provedor que o Aurora já usa), num ambiente isolado por trabalho |
