# AgentScope como motor + OpenAgents para colaboração

Data: 2026-11-03. Etapa executada depois da reavaliação Paperclip. **Reaproveitamento conjunto com camada própria demonstrado; homologação da plataforma completa ainda NÃO concedida.**

## Fontes e ambientes

- AgentScope: `9668b4c90c70cc214e1b7bb65dec2a6e70b90010`, pacote do clone 2.0.12.dev0, Python 3.12.14. SDK real: Agent, Toolkit, ToolBase, TeamMember e TeamPipeline. É snapshot de desenvolvimento, não release comercial certificado.
- OpenAgents: `6a330c789c321bdce5856578b7c47c2539ea7fc6`, Python 3.12.14. FastAPI e rotas /v1/events reais, fixtures SQLite oficiais. Autenticação por token legado de workspace.
- Processos e venvs separados, JSON por stdin/stdout. A API OpenAgents foi chamada por TestClient ASGI, sem serviço TCP remoto. Essa prova não valida implantação distribuída ou PostgreSQL.
- Nenhuma alteração funcional nos clones. O carregamento do SDK OpenAgents regenerou três arquivos egg-info; diff preservado e apenas esses metadados restaurados. Nossa probe AgentScope anterior ganhou guard `if __name__ == '__main__'` para reutilização das ferramentas sem executar o CLI no import.

## Arquitetura exercitada

Camada própria recebe um pedido de capacidades, aplica política sintética e registra run/intenção em SQLite. Worker AgentScope cria uma equipe limitada com especialistas de vendas e campanhas, consulta as duas fontes autorizadas e devolve resultado correlacionado. A camada persiste o resultado antes de publicar no OpenAgents. O workspace transporta colaboração; não escolhe estratégia, orçamento ou contratações.

O Chief of Staff faz delegação/síntese dentro das capacidades previamente escolhidas. A seleção A3, motivo e limites são fixtures explícitas; NÃO provam controlador adaptativo A0–A4, planejamento inteligente ou qualidade de LLM. Modelos determinísticos não fazem chamadas pagas. Conhecimento desta etapa é a ferramenta sintética previamente auditada; LightRAG não participa desta integração específica.

A ferramenta protegida continua evitando o caminho rápido de autoautorização read-only do AgentScope; autoriza por empresa/escopo no hook e novamente dentro de call. Bloquear um pedido no worker também não substitui autenticação de produção.

## Testes executados

`evidence/integration.xml` e `integration.log`: **6 PASS em 26,87 s**. O primeiro conjunto tinha 5 PASS em 18,58 s, preservado em arquivos `integration-first.*`; acrescentamos o caso de perda do acknowledgement e uma sentinela que falha se o motor for reexecutado no replay.

| Cenário | Evidência observada |
|---|---|
| Motor → colaboração → reconstrução da camada | Dois especialistas; 32 eventos; duas fontes com empresa/versão; correlação enterprise_run_id preservada; um evento após replay confirmado; token inválido 401; mudança de payload com mesmo run rejeitada |
| Empresa B solicita fontes de A | DENIED antes de iniciar o motor e sem publicação |
| Falta escopo knowledge:read | DENIED antes de iniciar o motor e sem publicação |
| Publicação recebe 401 e é repetida após reconstrução | Resultado persistido reaproveitado; publicação final aceita; um evento; não exige repetir execução cognitiva |
| Estado de execução incerto após reconstrução | Replay automático bloqueado, exige revisão; simulação de estado persistido, não kill de processo real |
| Resposta perdida após commit do evento | Dois eventos com o mesmo event_id de negócio; teste passa porque confirma a falha de semântica stronger-than-at-least-once |

`evidence/joint.json` contém resultado, tipos de evento e fontes. `evidence/delivery-ambiguity.json` registra a limitação, sem escondê-la no total de testes verdes. Não somar estes seis com os testes upstream anteriores como se fossem cobertura integral. Os anteriores continuam em `../REPORT.md` (AgentScope 31 PASS/22 SKIP/162 subtestes; OpenAgents 92 PASS).

## Decisão técnica

**AgentScope: prosseguir como candidato de motor, reutilizando o SDK com nossa camada.** A integração externa foi executada. Ainda falta confrontar com LangGraph como único dono da execução e testar estado durável, interrupção, falha, limites financeiros e cérebro real no mesmo fluxo. Não empilhar os dois motores por padrão.

**OpenAgents: prosseguir condicionalmente como componente de colaboração.** Sua API real recebeu e retornou resultados sem impor sua UI ou outro controlador de negócio. O modelo de entrega observado exige inbox/outbox e deduplicação durável pelo identificador do evento em cada consumidor. O metadata event_id NÃO é chave idempotente imposta pelo servidor. O harness atual só evita repetições depois que recebe acknowledgement; NÃO resolve a janela entre commit remoto e registro local. Uma solução de produção precisa explicitar esse contrato; não foi implementada nesta prova.

**Paperclip: impossibilidade sem fork não confirmada.** Consulte `../paperclip-recheck/REPORT.md`: a integração, custo sintético e parada remota passaram. Sua manutenção ou retirada deve considerar complexidade e governança, sem fundamentar descarte em uma impossibilidade que os testes contradizem.

Não há evidência para aprovar OpenCompany ou Eigent como substitutos nesta etapa; os resultados anteriores continuam disponíveis. Não selecionamos plataforma inteira por uma lista de funcionalidades.

## Requisitos preservados e gates restantes

| Requisito do dossiê | Estado nesta etapa |
|---|---|
| Deployment dedicado por cliente, mesmo código, isolamento de dados/segredos/logs/orçamento | Mantido como obrigatório; não demonstrado por fixture de workspace ou companies |
| Cérebro central persistente, híbrido/semântico, fontes/versões/proveniência/tempo/ACL | Fontes/versionamento sintéticos neste teste; LightRAG real apenas na reavaliação separada; Graphiti continua candidato; cérebro completo aberto |
| Chief of Staff, controlador adaptativo e control plane com autoridades distintas | Separação definida e fixture limitada; algoritmo A0–A4 e governança completa abertos |
| Equipes por capacidade, colaboração transversal, permanentes com aprovação, temporários limitados | Duas capacidades e colaboração demonstradas; ciclo completo de contratação/limites ainda aberto |
| UI JARVIS funcional própria React/TS/Three.js | Preservada, não construída antes de qualificar backend |
| Camada empresarial própria TS; Python para IA; sem NestJS e sem infraestrutura desnecessária | Preservado; Python aqui é harness de auditoria, não decisão de reescrever a camada empresarial |
| HITL, autorização server-side e identidade | Negações sintéticas/token legado demonstrados; identidade granular de produção, aprovações e efeitos externos abertos |
| Orçamento, reserva e conciliação, cancelamento, recuperação e idempotência | Evidência parcial em provas separadas; perda de ack mostra lacuna real; Budget Stop e custo parcial não qualificados |
| Backup, retomada sob falhas, sandbox, MCP/APIs autorizados, observabilidade | Não qualificados em conjunto; testes e exigências anteriores continuam vigentes |
| Reuso sem reimplementar bibliotecas e sem fork extenso | SDK e API reutilizados; camada de contrato própria pequena fora dos clones |

Não aprovamos instalação, compra, publicação nem despesas. Não introduzimos Temporal/Kafka/Redis ou microserviços novos no produto. O worker é isolamento de ambientes da prova, não topologia de produção escolhida.

## Próximo gate de engenharia

Antes de escolher a base definitiva, executar um único cenário empresarial com identidade real de teste, cérebro LightRAG via Knowledge API com ACL, autorização de efeito, reserva/conciliação financeira, parada e retomada sob falhas e inbox/outbox. Comparar AgentScope e LangGraph sob o mesmo contrato, sem dois coordenadores concorrentes. OpenAgents deve permanecer dependência opcional até demonstrar benefício suficiente em colaboração e contrato de entrega. Isso é trabalho restante de qualificação, não aprovação automática nem autorização para implementar todo o produto.

## Reprodução

Na raiz do workspace:

```powershell
$env:DO_NOT_TRACK='1'
$env:AUTH_MODE='workspace_token'
$env:ANALYTICS_ENABLED='false'
& validation/openagents/.venv/Scripts/python.exe -X utf8 -m pytest validation/engine-collaboration/test_integration.py -q --junitxml=validation/engine-collaboration/evidence/integration.xml
```

São necessários os dois venvs previamente instalados e registrados em `../manifest.json`. Os testes exigiram subprocessos fora do sandbox restrito. Não exigem credenciais de provedor. O warning pytest-asyncio sobre fixture_loop_scope é de configuração do ambiente; não foi suprimido nos logs.


## Comparação seguinte dos motores

A etapa autorizada seguinte foi concluída: 17 testes PASS com LangGraph e AgentScope sob contrato comum, LightRAG e eventos OpenAgents reais. A preferência provisória é LangGraph como dono do workflow no caminho auditado; AgentScope continua viável. Veja [parecer comparativo](../motor-comparison/REPORT.md). Essa comparação não concede aprovação para produção.
