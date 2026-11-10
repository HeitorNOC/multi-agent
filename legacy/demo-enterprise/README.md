# Grupo Aurora — simulação empresarial ampliada

O código-fonte fica em [apps/aurora](../apps/aurora/) e [packages/aurora-api](../packages/aurora-api/). Este diretório reúne os comandos existentes, o corpus fictício e os registros do ensaio. Consulte o [mapa de manutenção](../docs/ORGANIZACAO_AURORA.md).

**Perfil instrumentado posterior:** [novo ensaio e resultados](../validation/observability-recovery/RESULTS.md), com trilha, original canônico conferido e duas jornadas PASS no recorte. Nova sessão http://127.0.0.1:60937 . O perfil padrão `observability-v1` tem teto de 40 reservas por sessão; foram usadas 33 nesta rodada, separadas das 55 reservas históricas. O FAIL original em `RESULTS.md` permanece histórico. A produção não foi aprovada.

Empresa inteiramente fictícia com 18.400 colaboradores, sete países, doze centros de distribuição e quatro unidades: varejo/e-commerce, distribuição B2B, logística e software. Esses números descrevem o domínio, não uma carga medida de usuários/agentes reais.

## O que mudou

- **47 agentes disponíveis:** dez diretorias e 37 especialistas. O Chief of Staff coordena a seleção e fica separado do catálogo. [Referências e cobertura do catálogo](../docs/CATALOGO_AURORA.md)
- **Seleção real por pedido:** um modelo recebe o catálogo e propõe os times, responsáveis e justificativas de exclusão. A política só admite IDs/hierarquias válidos, no máximo quatro diretorias e oito agentes; não predefine quais devem executar.
- **Hierarquia executável:** o workflow LangGraph chama somente os subgrafos das diretorias selecionadas; os especialistas escolhidos executam primeiro e o diretor consolida seus retornos antes da síntese final do Chief.
- **17 documentos:** dezesseis vigentes recuperáveis e uma política de preços histórica, preservada para inspeção e excluída da indexação vigente. Existem referências cruzadas, reservas e bloqueios de estoque, proposta comercial, política de margem, custo, caixa, compras condicionadas, logística, contratos, comunicação, pessoas e incidente de dados.
- **Visualização funcional:** cérebro central, diretores ao redor e especialistas ligados a cada diretor. Selecionados/concluídos se destacam; um clique mostra motivo, fontes e retorno original. O grafo representa a execução real. Não é uma reprodução do vídeo original, que não estava acessível nesta rodada, nem uma visualização 3D completa.

Diretorias e títulos são exemplos de configuração deste cenário. A capacidade é a unidade de seleção. O consumo do modelo vem dos agentes mobilizados e das etapas de coordenação da tarefa.

## Usar

Na primeira execução, siga a [instalação dedicada do Aurora](../docs/ORGANIZACAO_AURORA.md#instalar-e-iniciar-em-windows).

```powershell
.\demo-enterprise\Start-Aurora.ps1
```

Após uma parada limpa, `Start-Aurora.ps1` reabre a última instalação preparada na mesma conta do Windows. Para iniciar outra instalação no perfil concorrente de laboratório, encerre a atual e use `.\demo-enterprise\Start-Aurora.ps1 -NewSession -Workers 2`. A preparação de uma instalação nova usa o orçamento de modelo do perfil escolhido. A interface mostra vagas de espera e workers ativos.

No cenário **Engenharia de webhook**, a Diretora de Tecnologia delega tarefas ao grupo autorizado pelo Chief. O painel exibe a reserva, as subtarefas, os testes e o diff para revisão humana. O executor usa a imagem Docker local `adaptive-webchat-executor:local` e o orçamento do cenário permite até 11 chamadas ao modelo, incluindo uma tentativa de correção. A aprovação registra um recibo local vinculado à entrega. [Ensaio de engenharia](../reports/aurora-engenharia-webhook.md)

Abra o endereço em `.state/launcher.log` (na rodada registrada, o endereço efetivo está em `evidence/session.json`). A interface informa o progresso de ingestão. Escolha um dos dois pedidos e clique **Pedir ao Chief**:

1. **Campanha Horizonte:** conciliar proposta de marketing, oportunidade Orion, estoque, compras, margem vigente, caixa e comunicação. As áreas necessárias devem emergir da seleção do Chief.
2. **INC-47:** avaliação de incidente sintético no CRM, com suspeita versus confirmação, relógio de SLA interno e checklist técnico/jurídico. Não justifica convocar toda a empresa.

Selecione um trabalho, clique nos nós e abra documentos/citações. Os agentes não convocados mostram o motivo declarado pelo Chief. O retorno original do especialista/diretor aparece no inspetor depois da execução. Propostas ficam aguardando aprovação para um registro **simulado** no comitê local. Aprovar não publica campanha, envia mensagem, transfere dinheiro, contém incidente ou notifica terceiros.

Para parar:

```powershell
.\demo-enterprise\Stop-Aurora.ps1
```

Durante a preparação, a parada aguarda o documento em andamento. Quando a instalação já está pronta, a parada encerra os processos e mantém os volumes Docker para retomar a mesma fila, autoridade, checkpoints e projeções. Espere a mensagem de confirmação antes de reiniciar. Sessões antigas sem metadados de retomada precisam de `-NewSession` para uma instalação nova. Após uma parada sem confirmação, consulte os logs antes de reabrir.

Para dano no PostgreSQL, a instalação parada dispõe de `Backup-Aurora.ps1` e `Restore-Aurora.ps1`. O procedimento usa um ponto compatível com os diários locais e preserva o volume anterior. [Comandos e alcance da recuperação](../validation/aurora-local-restart/BACKUP.md).

## Cérebro e recuperação

LightRAG, PostgreSQL/pgvector, Neo4j e modelo ONNX são reutilizados. O cérebro é uma API/catálogo lógico central, com projeções por documento/versão para preservar a fronteira de proveniência já ensaiada. A análise cruza evidências dessas projeções; não alegamos uma única materialização de grafo que funde todos os documentos.

Este cenário usa modo LightRAG `mix` (grafo + vetor), com palavras-chave explícitas e contexto real. Metadados do catálogo dizem quais fontes cada capacidade pode consultar. Backend verifica que o agente foi escolhido; a lista de fontes é resolvida pelo servidor. Todos os documentos são fictícios e fornecidos a um operador local autorizado; não é ensaio de ACL corporativa ou de dados pessoais reais.

O MiniLM existente trabalha com janelas curtas. Para não truncar silenciosamente documentos maiores nem multiplicar a extração desnecessariamente, este perfil usa trechos de extração de até 512 tokens e um adaptador de vetor composto: divide o texto em segmentos de no máximo 120 tokens WordPiece, calcula todos com o ONNX fixado e combina vetores com média ponderada normalizada. A API retorna 384 dimensões. Nome do espaço vetorial é distinto do embedding direto anterior. É uma adaptação explícita; qualidade é conferida no recorte dos dois cenários, sem declarar equivalência universal a um modelo nativo de contexto longo.

## Integridade, orçamento e limites

**Resultado do ensaio executado:** campanha com oito agentes rejeitada por reconciliação documental; incidente com quatro agentes aceito e aguardando aprovação. Resultado integrado **FAIL**, sem liberação de produção. Ver [resultados completos](RESULTS.md). O catálogo e a delegação funcionaram neste recorte; a confiabilidade entre fontes continua pendente.

Token/calls medidos, não fatura comercial. Na rodada original (`--run-profile original`), adotou-se teto agregado de **64 reservas entre suas tentativas**; foram 55, incluindo uma desconhecida. O novo perfil padrão `observability-v1` inicia outro bloco de qualificação com teto próprio de 40 e contabilidade separada. Ver resultados atuais no link acima e falhas históricas em `COMMANDS.md` / `evidence/first-attempt.json`. Reservas sem saída conhecida não são tratadas como gratuitas.

Cada trabalho admite somente slots de planejamento, agentes escolhidos e síntese, no limite `agentes escolhidos + 2`. Slots têm prompt vinculado e resultado durável. Um slot desconhecido bloqueia reexecução automática; seu fechamento governado geral ainda é pendência histórica. Modelos são reais por Codex Terra, sem shell, rede ou ferramentas no subprocesso de inferência.

O backend verifica os cálculos e fatos estruturados deste corpus fechado antes de aceitar o parecer. O gabarito não é enviado ao modelo. Esse verificador não prova automaticamente cada frase livre nem a correção de qualquer pergunta arbitrária. Os cenários ainda são delimitados; pedidos gerais e ingestão de documentos do cliente não foram liberados.

Checkpoints PostgreSQL e o ledger local da API são preservados durante a sessão. Banco de negócio é SQLite de desenvolvimento. Encerrar o launcher remove bancos Docker da instalação; novo início não restaura a sessão anterior automaticamente. Efeitos/auditoria externos, SSO, DR, controlador A4 pleno e escala operacional não são homologados. Nenhum dos quatro FAIL históricos de V1 se converte em PASS por esta simulação.

## Verificar

```powershell
node demo-enterprise/build.cjs
npm --prefix apps/aurora run typecheck
node --test demo-enterprise/policy.test.ts demo/policy.test.ts
& validation/integrated-pilot/.venv/Scripts/python.exe -m pytest demo-enterprise/test_embedding_pooling.py -q
& validation/integrated-pilot/.venv/Scripts/python.exe demo-enterprise/test_scenarios.py
```

O último teste usa modelos reais e a sessão ativa. Verifica seleção versus execução/slots, inatividade dos demais, equipes diferentes, pareceres coerentes com os fatos e retomada antes de aprovação sem novas inferências. Não executa ações externas.

## Preservação do produto

R01–R21 mantidos: instalação por empresa; TS empresarial + Python; LangGraph único owner; LightRAG reutilizado; fontes, fatos e histórias separados; CoS/A0–A4 como direção; capacidades dinâmicas; política por operação, sandbox, orçamento, auditoria e antirollback; JARVIS/3D; Obsidian opcional; inferência comercial independente de conta pessoal. Keycloak/OpenFGA continuam fora da prioridade desta demonstração.
