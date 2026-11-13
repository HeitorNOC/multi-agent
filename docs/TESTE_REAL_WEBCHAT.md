# Teste real: módulo de atendimento por WebChat

Roteiro do primeiro teste de ponta a ponta com o **modelo de verdade**. Os testes automáticos cobrem
o núcleo inteiro (N1–N6), mas com modelo, HTTP e Chief simulados. Este teste mostra o que eles não
pegam: a qualidade do plano, se o JSON do modelo valida ou cai nas regras, se o orçamento de chamadas
basta, o custo e o tempo reais, e onde a interface confunde.

O resultado esperado não é "passou": é uma **lista de ajustes** com evidência (seção 6).

## 1. O que é preciso

| Item | Para quê | Quem faz |
| --- | --- | --- |
| CLI do Claude logada (`claude`) | o modelo. O Aurora usa a sessão da CLI, **não há chave de API** | instalada; se a checagem disser "OAuth session expired", rode `claude` num terminal e faça `/login` |
| PostgreSQL local | checkpoints do worker (LangGraph). Sem ele o worker não sobe | você instala (seção 2) |
| Ambiente Python do worker | `npm run setup:runtime` (já criado em `apps/runtime/.venv`) | pronto |
| Interface construída | `npm run build` | pronto |
| Repositório de teste no GitHub, vazio, privado (ex.: `aurora-teste-webchat`) | destino do pull request no fim | você cria |
| Token *fine-grained* só desse repositório: Contents e Pull requests em leitura e escrita | o conector GitHub | você cria e cola no Aurora |

Os dados do teste ficam num banco separado (`apps/api/data/teste-real/`), sem misturar com o que você
já tem. Para recomeçar do zero, apague essa pasta.

## 2. PostgreSQL

Instale o PostgreSQL 17 (o instalador pede a senha do usuário `postgres`; guarde-a com você):

```bash
winget install --id PostgreSQL.PostgreSQL.17 -e
```

Crie o banco dos checkpoints:

```bash
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres aurora_checkpoints
```

## 3. Subir

No PowerShell, na raiz do projeto, defina a conexão (a senha fica só na sua sessão do terminal) e
rode a checagem:

```powershell
$env:AURORA_CHECKPOINT_DSN = "postgresql://postgres:SUA_SENHA@localhost:5432/aurora_checkpoints"
node scripts/teste-real/preflight.mjs --probe
```

`--probe` faz uma chamada mínima ao modelo para confirmar que a CLI está logada. Tudo verde? Suba:

```powershell
./scripts/teste-real/iniciar.ps1
```

Ele sobe o Aurora em `http://localhost:4300`, com o modelo ligado no Chief, no Cérebro e no worker.
Em outro terminal, prepare a empresa do teste (recursos, fatos e alçadas):

```bash
node scripts/teste-real/preparar.mjs
```

## 4. Configuração na tela (5 min)

1. **Primeiro acesso:** nome da empresa e Chief of Staff (o assistente de início).
2. **Configurações → Alçadas do Chief:** contratar = **propor** (você decide cada contratação), só
   neste trabalho, até 8 agentes. O `preparar.mjs` já deixa assim; só confira.
3. **Integrações → GitHub:** cole o token e o repositório de teste (`dono/aurora-teste-webchat`).
4. **Integrações → Recursos da empresa:** confira os quatro recursos cadastrados pelo script.
5. **Cérebro:** envie o padrão de arquitetura `scripts/teste-real/padrao-microservicos.md`.

Anote a hora de início.

## 5. Roteiro

Cada passo tem o que fazer, o que **deve** acontecer e o que anotar. Marque ✅, ⚠️ (funcionou com
ressalva) ou ❌.

### P1. Pedido

Na conversa com o Chief, escreva:

> Quero um módulo de atendimento por WebChat como microserviço: widget no site, conversa em tempo
> real com a equipe de atendimento, histórico por cliente e fila de atendimento. Tem que seguir nosso
> padrão de microserviços. Prazo: 6 semanas.

**Deve:** o Chief responde com um plano em elaboração e **perguntas** (canais, volume, autenticação do
cliente, retenção do histórico, integração com CRM…). Não deve propor etapas ainda.
**Anote:** as perguntas fazem sentido? Ele citou o padrão do Cérebro? Tempo da resposta.

### P2. Respostas

Responda numa mensagem só:

> Só WebChat por enquanto. Até 2 mil conversas por dia, pico de 200 simultâneas. Cliente entra
> anônimo e pode se identificar com e-mail. Histórico guardado por 1 ano. Sem CRM nesta fase.
> Usa o Postgres e o Kafka que já temos.

**Deve:** versão nova do plano com etapas (responsável e entrega em cada uma), quem traz do catálogo,
**recursos da empresa** (Postgres, Kafka) e o que falta **provisionar** (ex.: ambiente de staging,
WebSocket/gateway). Se o plano indicar diretores para detalhar, o status fica **"Diretores detalhando"**.
**Anote:** as etapas são de um microserviço de verdade (contrato da API, modelo de dados, eventos,
widget, testes, deploy)? Os responsáveis fazem sentido? Usou só recursos cadastrados?

### P3. Contratação

Se aparecer o cartão de contratação, **aceite**.
**Deve:** os agentes aparecem no Time com o selo "Só neste trabalho" e o diretor da área lidera.
**Anote:** quantos e quem. Faltou alguém óbvio (ex.: segurança)? Sobrou alguém?

### P4. Especificação pelos diretores

Espere o status sair de "Diretores detalhando" (a página atualiza sozinha).
**Deve:** cada diretor mostra requisitos e riscos, e o Chief consolida numa versão nova.
**Anote:** tempo até consolidar; algum diretor "não conseguiu agora"? A versão consolidada mudou o
plano de forma útil?

### P5. Ajuste

Escreva: `junta as etapas de testes e de deploy numa só`.
**Deve:** nova versão com as etapas juntas; o resto igual.
**Anote:** ele mexeu só no que foi pedido?

### P6. Aprovar

Clique em **Aprovar e começar**.
**Deve:** abre o trabalho; em Trabalhos, Command Center e no organograma aparece quem está
entregando ou revisando cada etapa.
**Anote:** hora de aprovação.

### P7. Execução

Acompanhe em **Trabalhos → (o trabalho)**. Não intervenha.
**Deve:** cada etapa tem entrega e revisão (aceita ou "refazer", até 3 tentativas). Uma escalação ao
CEO, se houver, para a execução e aparece no parecer.
**Anote, por etapa:** tentativas, se a revisão foi substantiva ou só carimbo, se as entregas usam as
anteriores (o modelo de dados da etapa 2 aparece na API da etapa 3?), se o código vem em blocos com
`caminho=`. Escalações: o motivo era mesmo decisão sua?

### P8. Parecer

**Deve:** parecer com etapas, entregas, revisões e o que precisa da sua decisão, na frente do botão de
aprovar.
**Anote:** dá para decidir só lendo o parecer? Tempo total, da aprovação do plano ao parecer.

### P9. Entrega no GitHub

Aprove o parecer e, na entrega, **Salvar em → GitHub**.
**Deve:** um pull request no repositório de teste, com a entrega e os arquivos de código das etapas.
Nunca faz merge.
**Anote:** os arquivos estão nos caminhos certos? O código compila ou é esqueleto?

### P10. Memória

Numa conversa nova, pergunte: `o que decidimos sobre o webchat?`
**Deve:** responde com as decisões (plano aprovado, contratação, retenção de 1 ano…).
**Anote:** faltou alguma decisão?

### P11. Queda e retomada (opcional, só se o resto passou)

Num segundo pedido menor, durante a execução, feche o terminal do Aurora e suba de novo.
**Deve:** o trabalho continua da etapa em que estava, sem refazer entregas (recibos).

## 6. O que levar de volta

Ao terminar, rode:

```bash
node scripts/teste-real/coletar.mjs
```

Ele grava `apps/api/data/teste-real/relatorio.json` com os números do teste: chamadas ao modelo por
tipo, quedas para as regras, tentativas e escalações por etapa, tempos. Traga esse arquivo e a sua
tabela de ✅/⚠️/❌ com as anotações. Daí sai a lista de ajustes, em ordem de impacto.

| Passo | Resultado | Anotações |
| --- | --- | --- |
| P1 Pedido | | |
| P2 Respostas | | |
| P3 Contratação | | |
| P4 Especificação | | |
| P5 Ajuste | | |
| P6 Aprovar | | |
| P7 Execução | | |
| P8 Parecer | | |
| P9 GitHub | | |
| P10 Memória | | |
| P11 Retomada | | |

## 7. Se algo travar

- **Trabalho parado em "na fila":** o worker não subiu. Veja o terminal do Aurora (erro do Python ou
  da conexão com o PostgreSQL).
- **"Limite de uso" do modelo:** a assinatura da CLI atingiu o teto. O trabalho para com recibo; ele
  continua de onde parou quando o limite voltar.
- **O Chief responde "seco", sem plano:** caiu nas regras (o JSON do modelo não validou). Anote; o
  `coletar.mjs` mostra quantas vezes.
