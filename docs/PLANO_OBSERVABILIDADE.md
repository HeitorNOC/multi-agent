# Incorporação da proposta de observabilidade e orquestração

Data: 05/11/2026. Autorização: usuário aprovou seguir as recomendações da revisão da proposta Word. Este plano incorpora as quatro adaptações; o arquivo Word recebido permanece preservado como referência. Não é homologação de produção.

## Responsabilidades preservadas

LangGraph continua sendo o único owner do workflow. A API TypeScript aplica política, aprovação e recibos. LightRAG fornece recuperação e projeções de conhecimento; o texto canônico continua distinguível do contexto recuperado. Telemetria e sua interface são projeções de leitura, sem atribuir agentes, executar ferramentas ou avançar o grafo.

R01–R21 permanecem obrigatórios. A experiência JARVIS/3D continua requisito futuro, com construção progressiva a partir da interface 2D acessível. Não foi convertida em item opcional. Keycloak/OpenFGA continuam adiados no recorte local autorizado; não se removeu a necessidade de identidade/ACL para dados reais.

## Quatro adaptações adotadas

1. Instrumentar a trilha antes da repetição semântica Aurora. A captura deve distinguir entrada recuperada, original canônico conferido, entrada/saída de especialistas e diretores e entrada/saída da síntese. Corrigir o componente responsável sem enviar o gabarito ao modelo.
2. Publicar eventos com identidade estável, persistência antes de envio, confirmação exata e deduplicação. Alterações locais de estado e seus eventos críticos devem compartilhar a transação. Uma resposta perdida depois do commit não pode gerar outro evento lógico no replay.
3. Separar recuperação com recibo conhecido de encerramento como desconhecido. O segundo exige duas identidades independentes, evidência vinculada, retenção do consumo/reserva e marcador terminal que impeça reexecução. Não exigir a recuperação de um resultado perdido como condição fictícia de sucesso.
4. Manter 3D no requisito final e evoluir a interface a partir de eventos reais. As referências visuais não constituem prova da arquitetura dos sistemas retratados.

## Entrega de engenharia desta rodada

| Bloco | Implementação | Aceite |
| --- | --- | --- |
| Recuperação de leitura | Conciliação TypeScript de `business_read_commit`, validação de recibo/input/inventário, duas identidades, fencing e auditoria | Três janelas de queda, restart/restore em novo PostgreSQL, queda da própria conciliação, sem nova inferência nem cobrança duplicada |
| Unknown | Provedor emite marcador terminal sem resultado; camada empresarial encerra como `closed_unknown` com duas identidades | Recusa encerramento de execução ativa/resultado conhecido, não devolve reserva, não readmite intenção antiga e permite nova intenção explícita |
| Eventos | `demo/telemetry.ts`, eventos com ID/hash, projeção de leitura e transações compartilhadas com estado | Replay exato após restart, conflito de conteúdo recusado, rollback conjunto e projeção sem prompt/documento |
| Outbox | `demo-enterprise/telemetry.py`, fila local persistida e artefatos restritos com hashes | Ack perdido não duplica evento; restart envia pendências; isolamento por trabalho |
| Evidência canônica | Contexto LightRAG mais leitura de originais curtos autorizados; confere versão/hash/projeção | Alteração/ausência de fonte é recusada; cenário original repetido com o mesmo gabarito |
| Interface | Trilha de evidências e `GET /api/jobs/{id}/trace` | Exibe etapas/fontes/registros efetivos; nenhum comando de workflow nesse endpoint |

A qualificação de recuperação usa o protocolo empresarial de `validation/langgraph-business-flow` e infraestrutura real local, com provedor sintético explicitamente sem qualidade LLM. A [central humana posterior](../validation/human-recovery/RESULTS.md) agora expõe essas operações pela API e pela interface, com duas sessões locais e journal persistido. A aplicação continua com `journey.sqlite`; os slots diretos de LLM ainda precisam ser vinculados à admissão/recibo estáveis do protocolo. Não transferir automaticamente o PASS ao domínio inteiro da aplicação.

## Contratos e limites

As novas intenções de read_commit vinculam ID de inferência, hash do input e capacidade ao contexto retido. Intenções históricas que não possuem esse contexto não são reinterpretadas nem reassinadas automaticamente. Migração de uma instalação antiga exige procedimento específico.

A recuperação aceita apenas um delta local qualificado em relação ao prefixo assinado. Mudança não relacionada, histórico antigo, recibo divergente ou acesso de revisor inválido mantém o bloqueio. A descoberta sem seleção exige um único candidato inequívoco; a central posterior implementou seleção explícita para múltiplos desconhecidos. Uma operação retida pendente bloqueia a próxima; evidência antiga deve ser inspecionada novamente.

O fechamento de unknown é conservador: mantém a reserva e consome a unidade do trabalho sem inventar resposta. O marcador do provedor não contém `semantic` e não vira um recibo de inferência concluída. A API recusa replay da criação também pelo caminho de cache. Reinício após o marcador do provedor e após o commit local deve ser idempotente.

Eventos de negócio críticos compartilham o SQLite local com sua mudança de estado. O worker grava o evento na outbox antes de enviar e só marca entregue após o ID exato ser confirmado. Repetição com mesmo ID e conteúdo é aceita; mesmo ID com outro conteúdo/trabalho é recusado. O ID/hash não é assinatura externa nem transação distribuída com checkpoint ou provedor.

O endpoint de trace publica metadados e hashes, não prompts, documentos ou respostas completas. Os artefatos detalhados permanecem privados na sessão, contendo apenas o corpus fictício autorizado nesta rodada. A timeline legada ainda possui conteúdo do fixture: retenção, redaction e ACL empresariais completas continuam pendentes antes de dados reais.

A trilha local inclui instalação/trabalho, evento/horários, execução do worker, slots, checkpoints observados, referências de fonte/versão/hash/projeção, fragmentos e artefatos/fatos. Spans são identificadores locais; não há collector ou tracing distribuído/OpenTelemetry homologado. IDs de provider e tasks que não foram observados não são fabricados.

A leitura canônica desta rodada usa documentos fictícios curtos inteiros, após conferir hash e projeção das fontes já permitidas ao agente. Não é estratégia de carregar indiscriminadamente um acervo empresarial no prompt. Para documentos extensos, ainda serão necessários cobertura seletiva, referências e limites medidos.

Registrar fatos e conferir handoffs exatos prova transporte e proveniência, não implica correção universal ou preservação semântica de cada frase. Não usar autoconfiança do modelo como probabilidade calibrada de verdade.

## Critérios de decisão e próximos incrementos

Os FAIL históricos permanecem nos arquivos originais. Novas execuções, falhas intermediárias, adaptações e hashes ficam em `validation/observability-recovery/`, em destinos novos. Resultados da rodada e limites estão no `RESULTS.md` correspondente.

Após a integração da central, seguem vinculação das demais categorias/slots do domínio ao protocolo, migração empresarial PostgreSQL, identidade e política por operação, gateway/sandbox/conectores, telemetria operacional isolada, custos monetários, corpus/carga representativos e DR externo. O controlador A0–A4 completo também permanece pendente.

Uma interface mais informativa não requalifica produção. O GO seguinte deve citar versão, ambiente, dados/ações permitidos e critérios efetivamente atendidos.

## Central humana incorporada posteriormente

As operações do protocolo conectado agora podem ser inspecionadas, propostas e confirmadas pela API/interface, com sessões locais independentes, escopo por instalação, grants atuais e journal de envio. A inspeção mostra metadados de fonte/input/recibo e a justificativa registrada; a segunda identidade não confirma apenas um hash sem contexto. Há seleção explícita para múltiplos unknown e proteção contra restauração antiga.

Ver [guia](../validation/human-recovery/README.md) e [resultado](../validation/human-recovery/RESULTS.md). O perfil operacional usa provedor controlado e zero LLM. A sessão Aurora anterior foi preservada; a vinculação de seus slots diretos de modelos ao protocolo ainda não foi implementada. Tracing distribuído, JARVIS/3D e demais gates empresariais continuam no plano.
