# Riscos que os testes não eliminam

Estes pontos fazem parte da decisão NO-GO desta versão, mesmo com os testes locais aprovados.

- Inventário de fontes é uma autoridade sintética independente do backup. Sua assinatura prova origem/integridade, não veracidade nem completude empresarial. O endpoint local de fixture não é um conector empresarial autenticado por mTLS/OAuth. O sistema real precisa de watermark/autenticidade/exclusões de cada fonte.
- Não existe transação distribuída atômica entre checagem de inventário, revogação, consulta e efeito. Antes de permitir efeitos reais, o plano e o destino devem aceitar fencing/idempotência de acordo com o contrato do provedor. A verificação antes de cada requisição reduz a janela, não a elimina.
- A conciliação histórica demonstrada mantém o proprietário com acesso às fontes públicas. O caso de proprietário desativado ou sem acesso às fontes ainda depende de contrato específico de governança/contabilidade que não exponha o conteúdo original; não foi testado nem aprovado por inferência.
- Revogação testada no cadastro da aplicação não é prova de revogação imediata por logout/desativação no IdP. Chaves JWKS são carregadas no startup; rotação e indisponibilidade do IdP exigem qualificação adicional.
- HTTPS, MFA/federação, cofre e recuperação de chaves não foram exercitados no deployment. A política de cookies HTTP é exceção explícita do cliente de teste no loopback; nunca configuração sugerida ao cliente empresarial.
- Backend de conhecimento usa credenciais técnicas de confiança e separação lógica por workspace. Aplicação autoriza antes de recuperar; isso não torna um usuário com acesso direto ao banco seguro. O deployment não pode fornecer essas credenciais a usuários/agentes arbitrários.
- Extração/embeddings continuam fixtures no teste integrado. A síntese real recebe contexto capturado dessa integração; o benchmark de embeddings reais é isolado. Não se pode somar os dois ensaios e afirmar ingestão/retrieval semântico nativo aprovado.
- Temporalidade g1/g2 é versionamento canônico, não memória bitemporal Graphiti ou resolução autorizada de contradições. Não se construiu substituto de Graphiti nesta bancada.
- Gateway de código é prova de componente. O antirreplay é local em memória e não sobrevive a restart; saída usa arquivo temporário e tem limite de leitura, mas não quota de disco do gateway; o tempo de execução não substitui um limite de bytes durante execução. Não expor esse harness a código externo real.
- Backup frio com quiescência e segredos retidos não qualifica PITR, desastre de vault, falha do diário externo, retenção do provedor, HA ou atualização de schema/versão.
- Custos financeiros são sintéticos no workflow. Uso Codex real é contagem de tokens da conta, sem fatura atribuível. Não se mediu margem, TCO ou custo empresarial mensal.
- O teste de carga usa oito fontes, cache e vetores sintéticos. Dimensão empresarial do dossiê continua alvo; capacidade real não foi demonstrada. Há somente duas capacidades fixas na fixture, sem implementação completa do Chief of Staff/controlador adaptativo/equipes dinâmicas/JARVIS.

Nenhum desses pontos demonstra que LangGraph/LightRAG/Keycloak não possam atender ao produto. Eles descrevem o que esta implementação ainda não provou e onde a próxima implantação precisa ter evidência específica.
