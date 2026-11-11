# Replanejamento — Aurora v2

Branch: `refactor/arquitetura-v2`, criada a partir de `chore/limpeza-repositorio` (commit `b570eec7`).
Status: **proposta para aprovação**. Nenhum código da v2 foi escrito ainda.

## 1. Por que reescrever a estrutura

O que já foi construído funciona e está testado (207 testes da API, em SQLite e PostgreSQL), mas a estrutura não aguenta o próximo passo:

| Problema | Onde | Efeito |
|---|---|---|
| Uma interface com 57 operações para tudo (trabalhos, fila, eventos, conversas, Cérebro, recuperação, inferência) | `ledger/journey-ledger.ts` | Cada recurso novo engorda a mesma interface e os dois adaptadores (~700 linhas cada) |
| Assinaturas inconsistentes: `insertJob(job)` recebe a entidade, `updateJob(id, patch)` recebe id e remendo, `appendEvent(job: string, …)` chama o id de `job` | mesma porta | Não dá para saber pelo tipo se um parâmetro é entidade ou identificador; nada impede trocar um id de trabalho por um id de fonte |
| Servidor monolítico com configuração, rotas, worker, fila, política e erros no mesmo arquivo | `server.ts` (1.372 linhas) | Difícil de ler, testar por partes e evoluir |
| Rotas escritas à mão com `if (path === …)` e validação espalhada | `server.ts` | Validação inconsistente, sem contrato único de entrada/saída |
| Interface numa página só, com CSS manual e componentes de 900 linhas | `apps/aurora/web/main.tsx` | Cérebro, conversa, agentes e trabalhos competem pela mesma tela; não há navegação |
| Três cópias de lógica parecida | `demo/`, `demo-enterprise/`, `apps/aurora/` | Não fica claro qual é o produto |

A reescrita **mantém as regras que já foram provadas** (recibos, aprovação exata, efeito único, inferência desconhecida não repetida, vigência, acesso) e troca a estrutura. Os testes de caracterização HTTP e os contratos viram a rede de segurança: a v2 só substitui a v1 quando passar neles.

## 2. Princípios de código da v2

1. **Tipos que dizem o que são.** Identificadores com marca (`JobId`, `SourceId`, `ConversationId`, `AgentId`…), que o compilador não deixa trocar entre si. Entidades são objetos de domínio; ids nunca se passam por entidades.
2. **Um repositório por agregado**, com interface pequena e verbos uniformes: `get(id)`, `add(entidade)`, `save(entidade)` com controle de versão otimista, e consultas nomeadas (`listByStatus`, `listForActor`). Nada de uma porta com 57 métodos.
3. **Regras no domínio, não no repositório nem na rota.** As transições de um trabalho (`approve`, `reject`, `interrupt`, `requireRecovery`) são funções do domínio que devolvem a nova versão e os eventos gerados.
4. **Unidade de trabalho explícita.** `uow.run(async ({ jobs, events, queue }) => …)` agrupa repositórios numa transação; nada grava fora dela.
5. **Casos de uso pequenos.** Cada ação do produto é um arquivo: `admit-job.ts`, `approve-job.ts`, `ask-brain.ts`… Recebem dependências por injeção e são testáveis sem HTTP.
6. **Rotas finas com contrato.** Cada rota declara o schema de entrada e saída (Zod), chama um caso de uso e mais nada. Erros de domínio viram HTTP num único lugar.
7. **Configuração tipada e validada na inicialização.** Uma configuração inválida impede a subida, com a mensagem do campo errado.
8. **Arquivos curtos e com um propósito.** Sem arquivo de módulo acima de ~300 linhas; nomes no vocabulário do produto.

## 3. Estrutura de pastas proposta

```
apps/
  api/                         servidor (Node + TypeScript)
    src/
      main.ts                  composição: config → infraestrutura → casos de uso → HTTP
      config/                  schema e leitura da configuração
      shared/                  ids com marca, erros de domínio, relógio, resultado
      modules/
        jobs/                  trabalhos, fila, aprovação, efeitos, recibos de inferência
          domain/              job.ts, job-events.ts, transitions.ts
          application/         admit-job.ts, approve-job.ts, resume-job.ts, …
          infrastructure/      sqlite/, postgres/ (repositórios)
          http/                routes.ts, schemas.ts
        conversations/         conversa e Chief of Staff
        knowledge/             Cérebro: fontes, versões, índice, respostas
        agents/                catálogo de personas, time da empresa, organograma (E4)
        deliverables/          entregas e revisão (E5)
        routines/              rotinas agendadas (E6)
        integrations/          conectores (E7)
        recovery/              central humana de recuperação
      platform/
        database/              unidade de trabalho, migrations, SQLite e PostgreSQL
        model/                 cliente da CLI (Claude/Codex), limitador, recibos
        workers/               supervisão do processo do worker e concessões
        http/                  servidor, erros, autenticação do ator
    test/                      contratos, casos de uso, HTTP de ponta a ponta
  web/                         interface (Vite + React + Tailwind + shadcn/ui)
    src/
      app/                     roteamento, layout com sidebar, provedores
      components/ui/           componentes shadcn/ui
      features/                uma pasta por área (mesmas do menu)
      lib/                     cliente da API, formatação
  runtime/                     Python: worker LangGraph do trabalho aberto
legacy/                        bancada fechada do Aurora, demos e protótipos (congelados)
docs/
```

`packages/aurora-api`, `apps/aurora/web` e `apps/aurora/runtime` migram para `apps/api`, `apps/web` e `apps/runtime`; a bancada fechada e as demos vão para `legacy/`, sem apagar nada.

## 4. Interface: navegação por áreas

Layout com **sidebar** (componente Sidebar do shadcn/ui), tema escuro como padrão e claro opcional, Tailwind para estilo. As telas seguem a especificação funcional e as imagens de referência:

| Área (menu) | O que mostra | Origem no documento |
|---|---|---|
| **Command Center** | Trabalhos ativos, aprovações pendentes, falhas, consumo de modelo, entregas recentes | Command Center |
| **Conversa** | Chat com o Chief of Staff, com cartões de trabalho | Conversa |
| **Cérebro** | Grafo navegável de áreas e fontes, envio de arquivos ("eu leio, destilo e guardo no lugar certo"), busca e perguntas com citação | Cérebro (imagem 1) |
| **Agentes** | Catálogo de personas por área ("Marketing & Conteúdo · 5 especialistas · 3 no time"), cartão com nome, cargo, frase, habilidades, "Conhecer →" e "✓ No seu time"; "Criar meu agente" | Agentes (imagem 2) |
| **Organograma** | Conselheiro → Chief of Staff → especialistas, cada um com "Conversar" e "Estação" | Organograma (imagem 4) |
| **Trabalhos** | Lista, detalhe com plano, achados, citações e aprovação | Fluxos e operações |
| **Entregas** | Artefatos com revisão, aceite e histórico | Entregas |
| **Rotinas** | Agendamentos e histórico de execuções | Rotinas |
| **Integrações** | Catálogo por categoria com "Conectar" | Integrações (imagem 3) |
| **Governança** | Central de recuperação, trilha de auditoria, uso do modelo | Operações/Governança |
| **Configurações** | Empresa, provedor do modelo (CLI local), armazenamento | — |

Loja e as áreas de marketing (Copy, Design, Tráfego, Instagram) ficam para depois do núcleo.

## 5. "Montar sua empresa"

Primeiro uso guiado, em quatro passos:

1. **Empresa**: nome, setor, objetivos e políticas gerais.
2. **Cérebro**: enviar os primeiros documentos.
3. **Time**: escolher agentes prontos do catálogo por área (ou "criar meu agente"); o Chief of Staff entra sempre.
4. **Organograma**: conferir quem responde a quem e quem aprova o quê.

Depois disso, dois modos de trabalho convivem:

- **Fluxo aberto**: o gestor descreve o pedido e o Chief of Staff escolhe os agentes **do time da empresa** (não mais do catálogo inteiro), que consultam o Cérebro e citam as fontes. É o fluxo que já funciona hoje.
- **Fluxo direto**: o gestor conversa com um agente específico pela "Estação" dele.

## 6. Modelo de domínio (agentes e empresa)

| Entidade | Papel |
|---|---|
| `Organization` | A instalação: nome, setor, objetivos |
| `AgentTemplate` | Persona do catálogo: nome, cargo, área, frase, habilidades, ferramentas permitidas |
| `Agent` | Agente contratado pela empresa a partir de um template ou criado do zero; tem instruções próprias, fontes que pode ler e limites |
| `OrgPosition` | Posição no organograma: a quem responde, o que aprova |
| `Skill` | Capacidade nomeada ("Buscar no Cérebro", "Emitir artefato", "artigo-seo") ligada a ferramentas e permissões |
| `Job` / `AgentExecution` | Trabalho e a execução de cada agente dentro dele, com recibos |
| `Deliverable`, `Routine`, `IntegrationConnection` | Entregas, rotinas e conectores (E5–E7) |

## 7. Roteiro

Cada fase termina com testes passando e verificação na interface.

| Fase | Conteúdo | Aceite |
|---|---|---|
| **F0 — Fundação** | Estrutura de pastas, configuração tipada, ids com marca, repositórios por agregado, unidade de trabalho (SQLite e PostgreSQL), HTTP com schemas, migração dos casos de uso existentes | Contratos portados e os testes HTTP de caracterização atuais passando contra a v2 nos dois armazenamentos |
| **F1 — Interface base** | Vite + Tailwind + shadcn/ui, sidebar, rotas, tema; Conversa, Cérebro e Trabalhos migrados | Navegação por áreas, sem perda de funcionalidade, conferida no navegador (desktop e celular) |
| **F2 — Agentes e empresa (E4)** | Catálogo de personas, "No seu time", criar agente, organograma, assistente "Montar sua empresa"; Chief of Staff escala só o time | Testes de domínio e HTTP; trabalho aberto usando agentes contratados |
| **F3 — Entregas (E5)** | Artefatos, revisão, aceite, rejeição com reabertura | Fluxo completo com auditoria |
| **F4 — Rotinas (E6)** | Agendamento, disparo, retry e histórico, sem duplicar após reinício | Testes de agenda e reinício |
| **F5 — Integrações (E7)** | Catálogo e um primeiro conector real | Leitura e escrita autorizadas; ação não autorizada bloqueada |
| **F6 — Command Center (E8)** | Painel com dados reais | Conferido no navegador |

Depois: identidade corporativa, provedor remoto (API), Loja e áreas de marketing.

### Andamento (11/11/2026)

- **F0 — concluída.** Jobs, Cérebro, trabalho aberto, conversa, recuperação nativa e migração de dados da v1, nos dois bancos; v1 congelada em `legacy/`. Os testes HTTP de caracterização da v1 não rodam literalmente contra a v2 (o formato das rotas mudou de propósito); os mesmos cenários foram portados.
- **F1 — concluída.** Interface com sidebar, tema e as áreas Command Center, Conversa, Trabalhos, Cérebro e Governança, servida pela API; conferida no navegador em desktop e celular.
- **F2 — concluída.** Catálogo de 37 personas em 10 áreas, contratar, criar meu agente, orientações, organograma, empresa, assistente "Montar sua empresa" e Configurações. O Chief of Staff só escala o time contratado. Fica para depois: a "Estação" (conversa direta com um agente) e permissões por agente além das fontes abertas a todos.
- **F3 — concluída.** O efeito aprovado gera a entrega na mesma transação do recibo (sem entrega, sem efeito). O gestor aceita a versão exata ou pede ajustes; o trabalho de revisão é admitido junto com a mudança da entrega e, aprovado, vira a próxima versão. Histórico por entrega e exportação em Markdown. Fica para depois: entregas de outros formatos (planilhas, documentos) e envio para destinos externos, que dependem das integrações (F5).
- **F4 — concluída.** Rotinas diárias (com dias da semana) ou por intervalo, no fuso da instalação (`AURORA_TIMEZONE`, com horário de verão). Cada horário vira no máximo um trabalho: a execução é gravada na mesma transação da admissão, com chave única por rotina e horário; depois de uma parada só o horário vencido mais recente dispara. Recusas viram novas tentativas com espera crescente até desistir. Conferido com a API real: disparo pela agenda e reinício sem duplicar.
- **F5 — concluída.** Catálogo de integrações por categoria e o primeiro conector real, **pasta local** (sem credencial; serve pasta sincronizada de OneDrive/Google Drive/Dropbox): lê documentos para o Cérebro e grava entregas aceitas (só a versão aceita sai; nunca sobrescreve). Ação sem permissão ou com a conexão desligada é recusada e registrada. Proteções de caminho: sem sair da pasta, sem atalhos, sem conectar a pasta de dados do Aurora. Os conectores com login (Google Drive, SharePoint, Slack, Gmail, WhatsApp, HubSpot, Webhook) estão no catálogo como "em breve": exigem OAuth ou credenciais da empresa, que o Aurora não guarda.
- **F6 — concluída.** Command Center com dados reais (`/api/overview`): o que precisa de decisão (pareceres, entregas, recuperação), andamento, problemas (inclusive rotinas que desistiram), consumo do modelo por dia no fuso da instalação e por uso (trabalhos, conversa, Cérebro), avisos do provedor (cota esgotada, CLI ausente, tempo esgotado), próximas rotinas, números da empresa e atividade recente.

**O roteiro F0–F6 está concluído.** Depois dele:

- **Estação e acesso por agente — concluídos.** Conversa direta com um agente, que responde só com as fontes que pode ler; fontes restritas podem liberar agentes específicos.
- **Contas de acesso — concluídas.** E-mail e senha, Google e Microsoft. A primeira conta é a do dono e assume os dados do operador local; depois, só entra quem o dono liberar. `AURORA_AUTH=local` mantém o uso individual sem login.
- **Catálogo de agentes ampliado.** 69 personas em 11 áreas, com marketing completo (copy, social media/Instagram, tráfego pago, design, SEO, e-mail/CRM, vídeo, marca, performance, influenciadores) e a área E-commerce & Loja.
- **Execução:** nesta fase, os agentes rodam na assinatura do Claude Code ou do Codex do próprio usuário, sem custo por chamada no Aurora. A execução por chave de API (pagamento por token, com custo por chamada) aparece em Configurações como "em breve".

- **Busca híbrida e imagens no Cérebro — concluídas.** Palavras (BM25) + significado (vetores guardados, modelo local) e imagens lidas uma vez pelo modelo; anexos na conversa.
- **Conectores com login — Google Drive, Gmail e Slack concluídos.** OAuth com PKCE (Google) e token de bot (Slack), tokens cifrados no banco com a chave guardada fora dele, sincronização que só baixa o que mudou e aviso para reconectar quando o acesso é revogado.
- **Mapa 3D do Cérebro e dos agentes — concluído.** Layout orgânico por forças, ligações curvas, foco num nó e recentrar.
- **Áreas do Cérebro criadas pela empresa — concluídas.** Criar, renomear e excluir (sem fonte em vigor), também direto do envio de uma fonte.
- **Padronização da interface — concluída.** Select, campos, confirmação de ações destrutivas e alternância de vistas com o mesmo desenho em todas as telas (ver [ARQUITETURA.md › Interface](ARQUITETURA.md#6-interface)).
- **Testes de interface — concluídos.** Playwright contra a API real, no CI.

- **Vistas dos agentes e Jarvis — concluídos.** Agentes em Lista operacional (status, atividade, marcos e tempo de cada um, como a v1), Mapa 3D e Organograma em cartões com setas (horizontal ou vertical). Jarvis no menu: o Chief of Staff como assistente por voz e texto, com reator 3D no centro da rede de agentes, painel de sistemas e pendências, e a situação da empresa no contexto do Chief (pendências, trabalhos andando, quem trabalha).

Próximos passos — **o núcleo: uma empresa de agentes** (CEO → Chief → diretores → especialistas, com planejamento aprovado pelo CEO, revisão em cadeia e alçadas), detalhado em [PLANO_NUCLEO.md](PLANO_NUCLEO.md): N1 time, hierarquia e autonomia; N2 planejamento devolvido ao CEO; N3 execução hierárquica e revisão; N4 Cérebro com padrões e projetos; N5 memória; N6 recursos da empresa e execução.

Também pendentes:

- Regras de negócio que faltam: teto de consumo (mensal) e aviso ao chegar perto; aviso quando uma rotina falha; aprovação para agentes permanentes e limite para temporários (previstos na v1).
- Permissões por papel (dono × membro) nas telas de administração (áreas, integrações, time).
- Execução por chave de API (pagamento por token), hoje "em breve" em Configurações.
- Conectores que faltam (SharePoint/OneDrive, WhatsApp, HubSpot, Webhook), pela demanda do piloto.
- Piloto com dados reais.

## 8. Decisões para você confirmar

| Decisão | Recomendação | Alternativa |
|---|---|---|
| Interface | **Vite + React SPA** servida pela própria API (instalação local, sem necessidade de SSR) | Next.js |
| HTTP | **Fastify** (maduro, schemas e plugins) | Hono (mais enxuto) |
| Validação | **Zod**, compartilhado entre API e interface | JSON Schema puro |
| Personas | Agentes com **nome próprio** como nas imagens (Bela, Lia, Sofia…), editável pela empresa | Só cargos |
| Grafo do Cérebro | Reaproveitar a visualização atual adaptada ao novo layout | Biblioteca de grafo pronta (react-force-graph) |
| Bancada fechada do Aurora | **Congelar em `legacy/`** como prova de qualificação | Manter no caminho principal |

## 9. Como a v2 substitui a v1 sem perder garantias

1. A v2 nasce ao lado da v1 na mesma branch; a v1 continua rodando até a troca.
2. Os testes HTTP de caracterização (fila, admissão, aprovação, efeito único, recuperação, conversa, Cérebro, trabalho aberto) rodam contra a v2. Só depois de passarem, a v1 sai.
3. Os contratos dos repositórios rodam nos dois armazenamentos, como hoje.
4. O worker LangGraph do trabalho aberto não muda de comportamento; só a pasta.
