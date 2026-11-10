# Cérebro nativo + TypeScript/LangGraph + restauração conjunta — 04/11/2026

**Decisão: continuar a qualificação; produção permanece NO-GO.** Este bloco conecta o conhecimento nativo do LightRAG à camada empresarial TypeScript e ao único owner de workflow LangGraph. O resultado executado e a contabilidade estão em [verification.json](verification.json); não se aprova produção por um corpus fictício pequeno.

## Resultado executado

**1 E2E PASS em 240,67 s, quatro checkpoints do mesmo ensaio**, após duas tentativas falhas preservadas. [JUnit](attempt-3.xml), [log](attempt-3.log), [resultados estruturados](evidence/results.json). Tempo interno: 236,02 s; cleanup dos recursos descartáveis confirmado.

| Verificação integrada | Resultado observado |
|---|---|
| Fonte canônica sem projeção | 503 antes de admitir trabalho/reserva de modelo; autoridade permaneceu coerente |
| Consulta TypeScript → LangGraph → LightRAG | Duas capacidades; extração/grafo/vetores nativos. Respostas: dois dias por semana e limite de 1000, com referências às respectivas fontes v1 |
| Publicação com queda | Worker encerrou com código 79 após staging de v2; retomada não consumiu nova reserva/modelo nem alterou a saída original |
| Backup antigo/adulterado | Geração antiga e dump alterado com manifesto reescrito recusados antes de tocar serviços ativos |
| Restore frio conjunto | Novos volumes PostgreSQL e Neo4j; ledger, editorial/Vault, banco/vetores/grafo, checkpoints e chaves recuperados; permaneceu congelado até abertura verificada |
| Acesso e história após restore | Owner continuou sem acesso à fonte financeira revogada; board leu exatamente o resultado original. Nova consulta respondeu três dias por semana e citou `politica-remoto:v2.md` |

Foram conferidas **108 provas assinadas** da execução PASS e 78 das duas tentativas falhas. Último estado PASS sem intenção pendente; modelo 9/16 reservas e negócio 3/64 unidades sintéticas. A segunda tentativa falha deixou uma intenção pendente, conservando o bloqueio; ela não foi declarada recuperada.

Regressões: **seis testes Python PASS**, **16 Node PASS**, TypeScript strict PASS e **um E2E governado sem modelo PASS em 30,22 s**. A última regressão é uma execução separada: [JUnit](regression.xml), [log](regression.log), [captura própria](regression-evidence/results.json). Não somar checkpoints como testes independentes.

## Consumo observado

| Tentativa | CLI concluídas / reservas | Tokens de entrada | Entrada em cache¹ | Tokens de saída |
|---|---:|---:|---:|---:|
| 1 — FAIL | 4 / 4 | 52.557 | 11.392 | 565 |
| 2 — FAIL | 6 / 6 | 76.699 | 40.960 | 777 |
| 3 — PASS | 9 / 9 | 117.788 | 96.640 | 1.129 |
| Total da rodada | 19 / 19 | 247.044 | 148.992 | 2.471 |

¹ Campo de cache reportado pelo provedor, mostrado separadamente; não é somado novamente à entrada. Não houve reserva sem registro de usage capturado nestas três execuções, nem evento inesperado de ferramenta. Isso não mede preço/faturamento. O bloqueio automático anterior não criou processo nem chamada e não é uma quarta execução de inferência.

No ensaio PASS, embeddings locais: 12 batches, 29 vetores, nenhum input truncado registrado. O corpus tem somente três releases fictícias; três respostas corretas com citações não estabelecem acurácia empresarial ou superioridade do modelo.

## Escopo implementado

- Publicação de conteúdo exato revisado: o board prepara uma release autenticada; LangGraph faz ingestão nativa e só depois solicita commit canônico ao TypeScript. Commit direto sem recibo nativo é recusado neste perfil.
- LightRAG usa PostgreSQL/pgvector, Neo4j, extração e respostas Terra reais e embeddings multilíngues ONNX de 384 dimensões. Não há extrator, vetor ou resposta simulados. Coordenação/roteamento dos especialistas permanece determinística e pequena.
- As projeções são vinculadas a fonte, versão e hashes aprovados; inventários lógicos de dados relacionais, vetores e grafo são conferidos. Caches não entram no certificado estável por fonte; entram no snapshot completo congelado.
- Histórico do assessoramento guarda a saída original e os snapshots usados. A publicação posterior não regenera a resposta; leitura exige os grants atuais. Fontes canônicas, projeções extraídas e resultados de trabalhos têm registros separados.
- Backup conjunto congela escritores, recusa trabalhadores ativos, finaliza os storages e reúne ledger empresarial, editorial/Vault, checkpoints PostgreSQL, banco de conhecimento, grafo Neo4j e chaves de aplicação cifradas. Um manifesto vincula todos os arquivos incluídos ao snapshot nativo.
- Autoridade Ed25519, fora do bundle, retém testemunho imutável do manifesto/head/inventário/snapshot. Esse testemunho não altera a sequência de operações e evita o problema circular de registrar um novo commit após copiar o próprio ledger.
- Antes de tocar os serviços ativos, o restore exige manifesto íntegro e testemunho no head atual. Depois, em volumes novos, a instalação permanece congelada até verificar inventários nativos, recibos locais e atualidade assinada.

Os processos separados e bancos da bancada são mecanismos de teste e limites das bibliotecas existentes; não são recomendação de microserviços por cliente. Mantidos instalação dedicada, cérebro lógico central, TypeScript empresarial, motores Python, equipes por capacidade e um único owner de workflow. Obsidian continua editor opcional. Não se reabre Graphon ou Paperclip como motor.

## Ensaios e negativos

[Tentativa 1](attempt-1.xml): FAIL em 99,68 s. Duas leituras paralelas disputaram a trava retida; a segunda excedeu sua espera de dez segundos. Quatro CLI reais concluídas. O perfil passou a configurar espera de 330 s e leases de 900 s; o padrão das outras fixtures continua dez segundos. Trata-se de uma adaptação da bancada, não solução comprovada de concorrência empresarial.

[Tentativa 2](attempt-2.xml): FAIL em 101,44 s, depois de ingestão, respostas e backup. Neo4j iniciado ainda não estava pronto para Bolt. Seis CLI reais concluídas. Corrigido o procedimento para esperar prontidão antes de reabrir o serviço. Nenhum FAIL foi convertido em PASS por revisão offline do grader.

As capturas negativas completas e seus usos de modelo estão em [attempt-1-evidence](attempt-1-evidence/results.json) e [attempt-2-evidence](attempt-2-evidence/results.json). O ensaio completo foi repetido após as adaptações. [Comandos e incidentes](COMMANDS.md), [ambiente e versões](environment.json), [manifesto de artefatos/código](manifest.json).

## Limites da decisão

Este perfil verifica todo o inventário registrado antes de atender operações normais e serializa confirmações enquanto faz inferência. Isso é conservador para integridade, mas pode bloquear consultas históricas quando o conhecimento está indisponível e cria fila global. Não é evidência de baixa latência ou capacidade empresarial; a primeira falha demonstra essa limitação.

A publicação com queda é coberta somente na janela após o staging nativo durável e antes do commit canônico. Não foi qualificada toda queda durante extração, atualização de múltiplas fontes ou coordenação distribuída. O stage usa uma projeção por release; crescimento e garbage collection não foram medidos.

O limite de 16 reservas por instalação é contagem de tentativas, não orçamento monetário ou garantia de saldo para todas as etapas de um trabalho. Reservas e tokens observados ficam registrados, inclusive nas tentativas falhas. Não há valor financeiro atribuível observado; autenticação Codex de bancada não homologa um contrato/API de inferência para o produto.

Chaves cifradas foram recuperadas, mas a KEK e a autoridade estão no mesmo host e continuam necessárias. Não há prova de KMS/HSM, restauração após perda do host, HA/PITR, RPO/RTO contratual, migração/upgrade, integridade de schema contra todas as adulterações, ou carga de uma grande empresa. O inventário lógico testado não é uma ferramenta universal de detecção de corrupção.

O serviço de embeddings ONNX e a autoridade permaneceram disponíveis na bancada durante a substituição dos volumes; pesos e autenticação Codex continuaram no host. O ensaio não reconstruiu essas dependências após perda total. As chaves recuperadas foram usadas pelos novos processos de aplicação/conhecimento para voltar a acessar os serviços.

O testemunho exige igualdade com o head atual: operações posteriores tornam aquele bundle insuficiente para abrir novamente. Não há replay geral de alterações posteriores nem autorização de descartar operações para voltar a um backup; sem geração/log recuperável e validado, a instalação fica bloqueada.

Identidades são tokens locais de fixture, sem SSO/MFA/TLS/cofre de produção. O teste não executa código arbitrário de agentes em sandbox empresarial. Conectores reais, ações externas reais, DLP e injeção em documentos não foram homologados. O guard deste ensaio somente restringe o corpus fictício e bloqueia as credenciais conhecidas.

Chief of Staff cognitivo, controlador A0–A4 completo, composição dinâmica ampla das equipes e arbitragem de modelos continuam requisitos e não estão implementados por este fluxo pequeno. A preferência por LangGraph foi preservada; nenhum resultado aqui prova que todos esses requisitos já estão resolvidos.

**Próximo gate recomendado:** separar inferência da seção crítica com admissão/recibo recuperáveis e fencing, provar renovação/expiração de leases e revogação durante inferência, depois medir concorrência e falhas com mais fontes. Em paralelo, qualificar provedor contratável com custo atribuível e recuperação externa de chaves/autoridade. Esses gates precisam passar antes da consolidação para produção.
