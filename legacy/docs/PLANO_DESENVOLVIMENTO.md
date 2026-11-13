# Plano de desenvolvimento do produto

**Perfil inicial de operação:** uma máquina por instalação. A recuperação local integra o aceite desse perfil. Recuperação entre máquinas e custódia externa para perda total do host entram como melhorias futuras.

**Recorte posterior autorizado:** usuário adiou login corporativo e pediu algo palpável; foi construída a [demonstração operável](../demo/README.md) de vendas/estoque, com [prova de execução e retomada](../demo/RESULTS.md). É uma entrega vertical delimitada, ainda dependente da bancada, sem autorização geral de produção. Keycloak/OpenFGA ficam fora desta prioridade. Os requisitos arquiteturais permanecem; a demo não representa todo M1/M2.

**Condição posterior do usuário:** executar primeiro o [gate de viabilidade e revisão do NO-GO](REVISAO_NO_GO.md). Este plano fica como sequência de construção após a decisão; sua existência não prova que o investimento amplo já foi aprovado tecnicamente.

**Próxima atividade: construir a primeira jornada funcional.** A seleção ampla de ferramentas terminou; os testes agora acompanham as funcionalidades. Este plano não exige mais uma prova de conceito isolada antes de iniciar a aplicação.

## M1 — Primeira versão utilizável em desenvolvimento

Entrega demonstrável: gestor entra no centro de comando, publica conhecimento revisado, solicita um trabalho, acompanha a equipe e recebe resultado com fontes e histórico. Dados sintéticos, instalação de teste única e ações externas simuladas.

Implementar em sequência:

1. **Base executável do produto.** Criar estrutura própria da aplicação: interface React/TypeScript, API empresarial TypeScript e runtime Python/LangGraph, contratos explícitos, configuração por instalação e dependências fixadas. Comando documentado para iniciar e verificar saúde. Manter a bancada como referência; não mover dumps, tokens de teste, `.venv` ou `vendor` inteiro para a distribuição.
2. **Empresa, identidade e domínio persistente.** Instalação dedicada, membros/papéis/grants e migrations PostgreSQL para fontes, versões, trabalhos, planos e auditoria. Identidade de desenvolvimento explicitamente limitada ao ambiente local; não apresentar tokens de fixture como autenticação empresarial concluída.
3. **Conhecimento na interface.** Importar fonte, visualizar conteúdo, revisar conteúdo exato, publicar versão e acompanhar ingestão LightRAG; mostrar pendência/falha honestamente. Exibir fonte, versão, vigência/publicação e grants. Obsidian opcional, sem obrigar aplicativo.
4. **Trabalho de ponta a ponta.** Pedido humano → Chief of Staff inicial → plano do controlador com estratégia e motivo → capacidades necessárias → execução LangGraph → resultado persistido com fontes. Demonstrar pelo menos um trabalho com dois especialistas colaborando; exemplos de capacidades não viram cargos fixos no domínio.
5. **Acompanhamento e governança.** Status e etapas reais, equipe/capacidades, custo observado ou explicitamente indisponível, aprovação vinculada ao plano/payload e histórico original. Uma ação simulada aprovada produz um único recibo; interface distingue aceito, em execução, bloqueado, unknown e concluído.
6. **Grafo operacional inicial.** Navegar entre trabalho, plano, especialistas e fontes, com estado persistido. O modelo permite a evolução JARVIS/3D prevista em M3 sem inventar um grafo decorativo desconectado do backend.

Aceite de M1: a jornada é operável pela interface, usa API/runtime próprios, persiste após restart e exibe citações/versões; usuário sem grant não acessa fonte ou resultado; alteração posterior da fonte não regenera o histórico; status não transforma ack em conclusão; modos simulados são visíveis. A integração pode reutilizar os adaptadores ensaiados, claramente identificados como de desenvolvimento. Não chamar M1 de produto pronto para produção nem de controlador A4 completo.

## M2 — Robustez integrada ao produto e piloto restrito

Implementar recuperação das janelas de `read_commit`, encerramento governado de inferência unknown, heartbeat automático, cancelamento e tratamento de falhas. Portar e executar os testes pertinentes contra os serviços do produto; aprovar um harness isolado não basta.

Integrar IdP, identidade por operação, limites de orçamento e provedor contratável com consumo atribuível. Evoluir reservas por trabalho e política de escalonamento de modelos. Migrar credenciais e autoridades retidas para mecanismos operacionais recuperáveis. Só conectar sistemas/dados reais mediante autorização e critérios específicos do [backlog de produção](PENDENCIAS_PRODUCAO.md).

Aceite: piloto restrito apenas quando identidade, dados, ações e recuperação do seu escopo passarem nos critérios correspondentes. Se um conector não estiver homologado, fica indisponível no piloto; isso não bloqueia construir outras telas ou capacidades seguras.

## M3 — Plataforma empresarial completa e homologação

Completar Chief of Staff e controlador A0–A4, catálogo e composição dinâmica, equipes transversais, políticas para agentes permanentes/temporários, gateway MCP/APIs e executores isolados. Evoluir JARVIS com visualização 3D funcional e observabilidade das decisões.

Validar corpus e concorrência representativos, adversidades, limites/backpressure, qualidade, revogação, custos reais, upgrade, recuperação e operação no perfil alvo. Licenças/ativos e condições de distribuição entram no aceite comercial. Não adotar números de capacidade ou datas de produção sem as medidas e o perfil-alvo.

## Política de trabalho a partir daqui

- Entregas verticais utilizáveis, com critérios de aceite e evidência no código do produto. Preservar todos os [requisitos](ARQUITETURA_BASE.md); adiar uma capacidade não significa removê-la.
- Primeiro marco de revisão: demonstração de M1; primeira tarefa concreta: estrutura executável e fluxo de trabalho persistido. Sem cronograma fictício em semanas antes de existir uma base medida.
- Cada mudança tem validação proporcional ao risco. Não executar novamente todas as chamadas de modelo para uma edição de tela/documentação; repetir integração quando contrato, motor, schema, segurança ou recuperação afetados exigirem.
- Dúvida local de implementação é resolvida no desenvolvimento. Reabrir pesquisa apenas para impedimento concreto, registrando requisito, falha, alternativa limitada e efeito na entrega.
- Gates de produção não são todos pré-condições de M1. Privilégios, dados reais e efeitos externos só entram quando seus gates e autorizações estiverem atendidos.
