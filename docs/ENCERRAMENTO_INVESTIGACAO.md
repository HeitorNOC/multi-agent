# Encerramento da investigação e transição para desenvolvimento

**Revisão posterior, 05/11/2026:** o usuário condicionou o início do produto à confirmação de viabilidade e investimento. A comparação ampla continua encerrada; a recomendação de iniciar imediatamente M1 é substituída pelo [gate final de viabilidade](REVISAO_NO_GO.md). O texto abaixo preserva a decisão anterior e suas evidências.

Data: 05/11/2026. Decisão registrada a partir da instrução do usuário para encerrar a investigação após autorizar a transição para o desenvolvimento do produto. As últimas execuções técnicas referenciadas são de 04/11/2026.

## Decisão

**GO para iniciar o desenvolvimento do produto, com dados sintéticos e efeitos simulados no ambiente de desenvolvimento. NO-GO para publicação em produção nesta versão.** O NO-GO não bloqueia construir interface, API, domínio empresarial e runtime integrado.

A investigação ampla de alternativas está encerrada. A direção de construção é camada empresarial própria em TypeScript, LangGraph como único owner de workflow e LightRAG para conhecimento, preservando os requisitos do [dossiê](../poc/DOSSIER.md). As pendências passam a ser trabalho de implementação e homologação associado às entregas, em vez de uma fila ilimitada de ensaios antes de começar o produto.

Não se declarou que a arquitetura inteira está comprovada para produção, que o produto já existe, ou que todas as ferramentas descartadas são universalmente incapazes. A conclusão é suficiente para investir no desenvolvimento nesta direção, com limites conhecidos e critérios de saída explícitos.

## Evidências que sustentam começar

| Evidência existente | Conclusão permitida |
|---|---|
| [Fluxo empresarial TypeScript + LangGraph](../validation/langgraph-business-flow/RESULTS.md) | Coordenação, aprovação exata, identidade de execução, orçamento sintético e efeitos idempotentes funcionaram nos cenários testados |
| [Autoridade assinada e restore](../validation/langgraph-retained-flow/RESULTS.md) | Vínculo do ledger à autoridade, recusa de versões antigas e recuperação em novo PostgreSQL demonstrados no recorte |
| [Conciliação governada](../validation/governed-recovery/RESULTS.md) | Dupla revisão e recibo externo recuperaram categorias específicas sem repetir efeitos; não é conciliação universal |
| [Cérebro nativo com restore conjunto](../validation/brain-recovery/RESULTS.md) | LightRAG, ONNX, PostgreSQL/pgvector e Neo4j reais integrados à camada própria; preservação de fontes, histórico e ACL demonstrada em corpus pequeno |
| [Inferência fora da seção crítica](../validation/detached-inference/RESULTS.md) | E2E controlado PASS em 14,36 s e requalificação nativa com cold restore PASS em 251,42 s; renovação/expiração/revogação controladas e recibos recuperáveis |
| [Conferência da última rodada](../validation/detached-inference/verification.json) | 188 provas controladas, 117 nativas e 198 da regressão governada verificadas; nove chamadas reais Terra, todas com usage capturado |

Os 63 arquivos do manifesto da última rodada foram reconferidos no fechamento, sem divergência. A captura de integridade e os hashes dos documentos de transição estão em [BASELINE.json](BASELINE.json). Nenhum teste integrado ou modelo novo foi executado apenas para encerrar a fase. Resultados e falhas anteriores não foram apagados nem reclassificados.

## Disposição dos componentes e alternativas

| Componente | Direção atual |
|---|---|
| Camada empresarial própria | Construir o domínio e a interface específicos do produto, reaproveitando contratos e testes da bancada; não copiar o harness como backend de produção |
| LangGraph | Escolhido pelo usuário e mantido como único owner de workflow; sem motor concorrente |
| LightRAG + PostgreSQL/pgvector + Neo4j | Base de desenvolvimento do conhecimento no perfil já ensaiado; escala, upgrade e operação empresarial pendentes |
| Graphiti | Fora do caminho obrigatório inicial; história anterior à retificação não foi aprovada como autoridade exclusiva |
| Paperclip | Fora da fundação escolhida. A [reavaliação](../validation/paperclip-recheck/REPORT.md) não sustenta alegar impossibilidade universal; não será reintroduzido no desenvolvimento por padrão |
| OpenAgents, AgentScope, Eigent, OpenCompany e demais comparados | Referências ou componentes opcionais, sem adoção implícita nem novo owner de execução |
| Graphon | Comparação encerrada; usuário preferiu continuar com LangGraph |
| Glean e ServiceNow | Pesquisa documental preservada, sem instâncias de teste ou contrato; nenhuma dependência comercial criada |
| Obsidian | Editor opcional; não é banco, autoridade de permissões nem requisito para o cliente usar o produto |
| Codex/Terra | Adaptador autorizado de bancada. Não é dependência obrigatória da conta pessoal do cliente nem contrato de inferência homologado para o produto |

## Mudança de fase e limites

A próxima atividade é a primeira entrega descrita no [plano de desenvolvimento](PLANO_DESENVOLVIMENTO.md), começando pela base executável do produto e uma jornada humana de ponta a ponta. O [backlog de produção](PENDENCIAS_PRODUCAO.md) define o que deve bloquear uma funcionalidade sensível, o piloto ou a publicação; não exige completar todo o produto antes de escrever sua primeira interface.

Uma pesquisa dirigida pode ser reaberta por falha reproduzível de requisito, incompatibilidade, licença, vulnerabilidade aplicável ou necessidade comercial concreta. Popularidade, novidade e preferência abstrata por stack não reabrem a seleção inteira. Registrar problema, evidência, opções limitadas e decisão no contexto da entrega.

Continuam fora do escopo deste encerramento: produção, VPS/cliente real, compras, contratação de provedores, publicação de código, acesso a segredos ou documentos reais e mensagens externas. Nenhuma dessas ações foi realizada. Este encerramento é decisão de fase; não é certificação de segurança ou aceite de uma instalação empresarial.
