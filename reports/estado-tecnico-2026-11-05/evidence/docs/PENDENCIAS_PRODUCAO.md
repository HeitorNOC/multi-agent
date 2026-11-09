# Pendências de implementação e homologação

Status: backlog aberto, não nova fase de investigação. Responsáveis abaixo são papéis técnicos, sem atribuir pessoas inexistentes. Criticidade indica risco/aceite; não é uma certificação quantitativa de probabilidade.

| ID | Prioridade / responsável | Trabalho e evidência de aceite | Momento que bloqueia |
|---|---|---|---|
| P01 | Crítica — runtime e domínio | Recuperar as janelas de intenção → commit local → confirmação retida do novo `read_commit`; injetar quedas em cada fronteira, reiniciar e provar ausência de resposta/efeito duplicado ou aceite obsoleto | Confiar em recuperação do produto/piloto; não bloqueia esqueleto e UI de M1 |
| P02 | Crítica — governança | Encerramento específico de inferência sem recibo, evidência vinculada e revisores independentes; manter consumo/reservas, impedir reutilizar intenção e não tratar unknown como sucesso | Retomada/encerramento operacional dessa categoria; sem mecanismo, trabalho permanece bloqueado |
| P03 | Alta — runtime | Heartbeat automático e reação à falha, expiração e fencing; testar processos concorrentes, desconexão e revogação durante inferência contra o produto | Trabalhos longos/confiabilidade do piloto |
| P04 | Crítica — identidade e segurança | IdP/SSO conforme cliente, MFA/federação quando exigidos, TLS, grants em cada fronteira, JWKS/rotação/revogação, segredo sem propagação ao código não confiável; testes de identidade restrita | Dados empresariais, acesso remoto e instalação real |
| P05 | Crítica — ferramentas e segurança | Gateway MCP/APIs, permissões por alvo/payload/tempo, sandbox por classe de código, idempotência e conciliação de efeitos, cancelamento e aprovação exata; execução adversarial controlada | Ferramentas/efeitos externos reais e código arbitrário |
| P06 | Alta — modelos e finanças | Provedor contratável independente de conta pessoal obrigatória; reservas/limites atribuíveis por trabalho, ingestão/retries/falhas, tokens e gasto monetário verificáveis; exaustão concorrente | Orçamento comercial e uso produtivo faturável |
| P07 | Crítica — dados e operações | KEK/autoridade/secrets recuperáveis fora do host, anti-rollback, restore de dados/índices/ACL/diário e in-flight/unknown; perda de host, RPO/RTO e replay/PITR conforme escopo | Homologação de recuperação e produção |
| P08 | Alta — qualidade de conhecimento | Corpus representativo, fatos contraditórios/retificações, temporalidade, exclusões/revogações, citações, abstenção, injeção e sigilo; não depender de Graphiti para história reprovada | Respostas empresariais confiáveis no escopo contratado |
| P09 | Alta — dados e conectores | Conectores reais com versão/watermark/completude, exclusão e revogação; falha não reabre fonte obsoleta | Cada integração real habilitada |
| P10 | Alta — operações e desempenho | Perfis de empresa grande, carga progressiva, filas/backpressure, quotas e SLO; medir sucesso seguro, p50/p95, custo/entrega, falhas e recuperação | Capacidade/SLO anunciados e produção |
| P11 | Alta — arquitetura e domínio | Chief of Staff, controlador A0–A4 e equipes dinâmicas completos com razões auditáveis; agentes permanentes aprovados e temporários limitados | Aceite do escopo completo do produto; M1 continua incremental |
| P12 | Alta — experiência do produto | Centro de comando JARVIS/3D operacional, navegação entre organização/trabalhos/agentes/fontes/ferramentas; dados reais do backend e acessibilidade operacional | Aceite da experiência completa; não adiar interface inteira até M3 |
| P13 | Alta — engenharia de dados | Migrations do ledger para PostgreSQL, compatibilidade de versões, upgrade/rollback seguro e configuração de instalação; ativar perfil novo sem invalidar inventário assinado | Migração/upgrade e deployment do produto |
| P14 | Alta — distribuição e comercial | Revisão de licenças, ativos de terceiros, condições de modelos/OEM/distribuição e telemetria; inventário de dependências com versões e avisos | Distribuição/contratação comercial |

## Critérios da decisão final de produção

Liberar uma instalação exige evidência no código/versão e ambiente que serão implantados, escopo de dados/ações autorizado, riscos residuais registrados, operação/monitoramento e recuperação executáveis, critérios de qualidade/capacidade/custo atendidos e aprovação de publicação. Não transferir automaticamente PASS da bancada para o produto, nem da instalação de um cliente para outro perfil.

Enquanto isso, o desenvolvimento segue com dados sintéticos e efeitos simulados. Ferramentas sem gate ficam desabilitadas; resultados desconhecidos ficam explicitamente bloqueados; a interface mostra limitações e não promete um resultado que o backend não confirmou. Nenhuma pendência deste documento reabre por si só uma comparação ampla de motores.
