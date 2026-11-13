# Observabilidade e recuperação governada — 05/11/2026

**Resultado: PASS nos novos contratos locais e nos dois fluxos Aurora repetidos. Produção continua NO-GO.** A proposta foi incorporada com instrumentação antes do ensaio, publicação durável de eventos, separação entre recuperação conhecida e encerramento unknown e preservação do requisito JARVIS/3D.

Painel da nova sessão: http://127.0.0.1:60937 . A campanha e o incidente estão aguardando aprovação. Nenhuma proposta desta rodada foi aprovada e nenhum efeito externo foi executado.

## Alterações implementadas

- `validation/langgraph-retained-flow/inference_recovery.ts`: valida admissão, plano, input, recibo e delta exato do inventário; recupera as três janelas de read_commit com duas identidades independentes e fencing. Não chama `inference_run`.
- `retained.ts`, `business.ts` e autoridade assinada: novos tipos de recuperação, votos vinculados e replay consistente. O contexto das novas intenções inclui ID/hash/capacidade da inferência.
- `Inference.closeUnknown`, provedor de controle e serviço nativo: marcador terminal sem resposta semântica; execução ativa ou resultado conhecido não pode ser convertido em unknown. O mesmo ID não volta a executar.
- Fechamento empresarial de unknown: mantém reserva e contabiliza uma unidade, encerra o trabalho como `closed_unknown`, cria tombstone e exige nova intenção explícita. O cache de admissão também respeita o encerramento.
- `demo/telemetry.ts`: ID/hash estáveis por evento, deduplicação, migração dos registros legados e projeção de leitura sem prompts/documentos. Aprovação, proposta, recibo e seus eventos críticos compartilham a transação local.
- `demo-enterprise/telemetry.py`: outbox persistida antes do envio, confirmação do ID exato, reenvio de pendências e artefatos restritos com hashes por trabalho.
- Worker Aurora: registra contextos e originais conferidos, entradas/saídas, fatos e checkpoints observados; consulta o texto canônico das fontes já permitidas e confere versão/hash/projeção. Não recebe o gabarito da política.
- UI: painel Trilha de evidências e `GET /api/jobs/{id}/trace`. O endpoint observa; não agenda nem aprova trabalhos.

## Recuperação dos quatro casos vermelhos

O arquivo histórico `validation/investment-gate/RESULTS.md`, seus FAIL/JUnit e o relatório de transferência anterior foram preservados. Novos testes exercitam os mesmos tipos de queda com o procedimento governado agora implementado; não se alterou um log antigo para chamá-lo de PASS.

| Caso | Aceite observado |
| --- | --- |
| Intenção antes do commit, saída 77 | Recibo do provedor conferido; leitura recuperada uma vez; um débito; executor antigo recusado |
| Commit empresarial antes do recibo local, saída 82 | Delta reconstruído e conferido contra o prefixo; sem duplicar leitura/cobrança |
| Recibo local antes da confirmação retida, saída 83 | Recibo e inventário conciliados com duas identidades; instalação volta a ficar atual |
| Inferência sem recibo, saída 80 do provedor | Três retries não regeneram; encerramento governado unknown sem resultado inventado, reserva mantida e intenção antiga bloqueada |

Os três primeiros foram testados com restart, restore em outro PostgreSQL/volume, queda da confirmação após o commit local, recusa de delta adulterado e recusa de backup antigo. Unknown foi testado sem queda da confirmação, após commit local e depois do marcador terminal no provedor antes do commit local. Repetir a confirmação mantém o resultado original e exige o segundo revisor original.

Execução ativa e resultado conhecido foram recusados como alvos de encerramento unknown. Não houve nova inferência para recuperar ou encerrar os casos. A nova intenção explícita após um encerramento pôde executar normalmente.

**Suíte final:** dez testes PASS em 131,57 s. `recovery-final.xml` / `recovery-final.log`.

Escopo: TypeScript/SQLite, autoridade Ed25519, PostgreSQL, processos reais e provedor de inferência sintético, sem LLM. Identidades e grants são de laboratório. A descoberta de unknown exige candidato único; múltiplos candidatos e migração de intenções antigas sem contexto de inferência continuam pendentes. O procedimento ainda precisa ser exposto/integrado à central humana do MVP, cujo ledger próprio continua sendo `journey.sqlite`.

## Regressões e testes de eventos

| Verificação final | Resultado | Limite |
| --- | --- | --- |
| Contratos Node | 30 PASS, aproximadamente 1,53 s | Inclui políticas, editorial/provas, eventos e testes HTTP controlados |
| Contratos anteriores de inferência/governança e unidades de autoridade/testemunho | 7 PASS, 43,37 s | Zero LLM; exports antigos preservados |
| Outbox, conferência canônica e embeddings | 5 PASS, 0,50 s | Ack perdido/restart, escopo por trabalho, fonte alterada/ausente/versão/projeção e pooling |
| TypeScript strict | PASS, logs vazios | API/UI e módulos empresariais alterados |

O teste HTTP de efeito usa worker de controle explicitamente sem LangGraph/LLM: aprovação exata → saída 88 após recibo → restart da API → retomada e replay com o mesmo recibo e somente um efeito inicial. A timeline tem uma aprovação e distingue recibos reaproveitados. Esse teste qualifica a alteração transacional da API; não é uma nova prova de qualidade semântica ou checkpoint LangGraph.

O teste de publicação simula resposta perdida após o commit remoto. O evento persiste pendente na outbox, é reenviado com o mesmo ID após restart e não duplica. Conteúdo/trabalho diferentes com o mesmo ID são recusados. Rollback da operação desfaz também seu evento. A projeção não copia campos de prompt/token/conteúdo/saída.

## Aurora nativo repetido

16 documentos vigentes, uma versão histórica fora do retrieval e o mesmo catálogo de 21 agentes. LightRAG, ONNX/PG/Neo4j, LangGraph/PostgreSQL e Codex Terra são reais. Documentos continuam sendo curtos e fictícios; não há benchmark de carga empresarial.

| Fluxo | Equipe | Resultado |
| --- | --- | --- |
| Campanha — primeira tentativa instrumentada | Chief propôs dez agentes; nenhum time executou | Plano corretamente rejeitado pela política de máximo oito |
| Incidente | Tecnologia + segurança; Jurídico + conformidade; quatro agentes e 17 não selecionados | PASS, aguardando aprovação |
| Campanha — repetição | Marketing + campanhas; Operações + suprimentos; Finanças + controladoria; Jurídico + conformidade; oito agentes e 13 não selecionados | PASS, aguardando aprovação |

A tentativa de dez agentes foi preservada no mesmo ledger e em `native-evidence/first-scenarios-failed.json`. Não houve truncamento silencioso da equipe nem relaxamento da política. O prompt foi explicitado para contar diretores e especialistas; com quatro times, um especialista por diretor é o máximo viável. A declaração numérica do modelo não concede autorização: a política continua contando os IDs reais.

A campanha repetida passou no gabarito original: saldo livre **3.000**, demanda conjunta **11.000**, falta **8.000**, margem **26,24%** contra mínimo **28%**, caixa livre **R$130 mil**, verba **R$180 mil**, lacuna **R$50 mil**, suprimento não confirmado e alegação ambiental sem suporte.

O incidente manteve **1.200 contatos potenciais**, exfiltração não confirmada e **65 minutos** restantes. Não acessou um CRM real nem realizou contenção/comunicação. Ambos os fluxos foram retomados sem novas inferências e ficaram na aprovação humana. Selecionados, agentes concluídos e slots correspondem; não selecionados não fizeram chamadas.

O verificador offline conferiu **12 handoffs exatos**: oito na campanha e quatro no incidente, entre especialistas/diretores/síntese. Conferiu todos os hashes de artefatos/fatos/fragmentos referidos, fonte canônica e ausência de eventos pendentes na outbox. A conferência compara os objetos efetivamente recebidos nos prompts, não apenas o que um evento afirma ter entregue.

Isso prova transporte/proveniência e o acerto dos dois casos estruturados. Não prova preservação semântica de toda frase nem verdade universal. A perda original entre retrieval e consolidações não foi isolada retrospectivamente; a adaptação forneceu os originais aprovados e a nova trilha permite inspecionar cada entrada/saída. Não se concluiu que o defeito era exclusivamente do LightRAG ou do modelo.

## Contabilidade e assinaturas

Nova rodada: **33 reservas / 33 chamadas concluídas**, dentro do teto próprio de 40: 16 ingestões + uma proposta rejeitada + seis chamadas do incidente + dez da campanha. Foram **499.216 tokens de entrada**, dos quais **246.016 em cache**, e **34.229 de saída**. Cache não é somado outra vez à entrada. Custo monetário comercial não foi observado.

As 55 reservas Aurora anteriores continuam históricas, incluindo uma desconhecida. Total Aurora conhecido entre esses blocos: **88 reservas**; não se declarou que tudo ocorreu dentro do teto antigo de 64. A nova rodada e o novo teto foram explicitados antes da execução.

Foram verificadas 38 assinaturas da autoridade no ensaio nativo e 2.147 assinaturas nas 30 instalações/tentativas de recuperação desta etapa, incluindo negativos intermediários. Os 30 registros não são 30 testes finais distintos: há repetições durante correções. A contagem dos testes finais está nos JUnit e logs citados acima.

## Falhas e adaptações preservadas

1. Bootstrap do teste adicionou o segundo revisor depois do inventário assinado: abertura recusada corretamente. Corrigido para configurar a identidade antes do bootstrap. Primeira falha preservada.
2. Recuperação unknown expôs replay de create pelo cache após tombstone. Corrigido o caminho de cache; requalificação passou.
3. Primeira execução de unidades de outbox não conseguiu criar o diretório temporário padrão do sandbox. Repetida com basetemp explícito no workspace; cinco testes passaram. O erro de ambiente não foi tratado como teste do comportamento.
4. Primeira campanha propôs dez agentes e foi recusada. O roteiro de teste também assumia plano não nulo ao comparar equipes; corrigido para conservar o FAIL sem mascará-lo com TypeError. Repetição adotou o incidente já concluído, sem gastá-lo novamente.
5. A captura final do navegador foi bloqueada pela revisão automática por limite de uso. A UI e a navegação das fontes já haviam sido inspecionadas por screenshot e árvore de acessibilidade. Não foi usada outra via para contornar o bloqueio.

Logs/JUnit iniciais foram mantidos; credenciais efêmeras de fixture presentes em traceback foram redigidas nas cópias públicas, com originais restritos em `.state/diagnostics`. Não há prompts, DSNs ou tokens da sessão no export público da trilha.

## Limites de decisão

Os quatro tipos de falha receberam procedimentos e passaram no novo envelope de protocolo. Isso altera a evidência de viabilidade desse núcleo; não equivale a homologação geral do produto. Permanecem integração da recuperação no domínio/central humana da aplicação, casos múltiplos/migração, SSO/ACL, sandbox/MCP, conectores, PostgreSQL empresarial, custo faturável, carga representativa, DR externo, upgrades e A4 completo.

A trilha é local, com spans/IDs próprios e polling. Não foi instalado collector, broker ou tracing distribuído. Os serviços iniciados preservam o código carregado no start; ajustes posteriores de diagnóstico/transação da API foram verificados pela regressão HTTP com worker controlado, sem repetir toda a ingestão/LLM. O manifesto registra os arquivos atuais, não declara que toda combinação de processo em memória seja uma release homologada.

**Recomendação:** continuar o desenvolvimento delimitado, integrando os procedimentos de recuperação e a trilha ao produto. Manter os motores e os requisitos arquiteturais, inclusive 3D. Produção segue NO-GO até qualificar a instalação e o escopo real. Evidências: `verification.json`, `manifest.json`, `native-evidence/verified.json`, `native-evidence/scenarios.json`, JUnit/logs e [plano incorporado](../../docs/PLANO_OBSERVABILIDADE.md).
