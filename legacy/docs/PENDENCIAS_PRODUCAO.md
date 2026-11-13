# Pendências de implementação e homologação

**Admissão de aprovações sob saturação:** [reserva qualificada no laboratório](../validation/aurora-queue/RESERVE.md) protege vagas da fila sem mudar a ordem dos trabalhos aceitos. P10 segue para metas, carga e limites com o provedor e o conector do piloto de host único.

**Carga contínua e uso atribuível:** [ensaio local de 90 s](../validation/aurora-queue/SUSTAINED.md) com dois workers concluiu todos os 46 aceitos e recusou 50 por capacidade após corrigir deadlock na inicialização do checkpointer. Aprovações compartilharam a fila e também tiveram 429. P10 segue para metas e carga no perfil real. P06 tem dois equivalentes de custo direto histórico, com faturamento por trabalho ainda indisponível.

**Backup operacional local:** [restauração do PostgreSQL em volume novo](../validation/aurora-local-restart/BACKUP.md) passou com perda injetada de checkpoints e conhecimento, preservando os diários e o Neo4j. O procedimento bloqueia cópia incompatível com o estado local e lista pedidos ausentes. A recuperação operacional de danos simultâneos nos demais armazenamentos segue em aberto no P07.

**Retomada local operacional:** [ensaio com parada completa do launcher](../validation/aurora-local-restart/RESULTS.md) verificou reabertura da mesma instalação e dos mesmos volumes, sem reindexar. A retomada automática requer parada confirmada. P07 segue para operação de backup e recuperação local diante de danos no armazenamento.

**Escopo inicial decidido pelo usuário:** uma máquina por instalação. Recuperação entre máquinas, cofre externo para esse cenário e retenção de admissões fora do host ficam no backlog futuro. O aceite da versão inicial considera a recuperação local após falhas de processo e a restauração dos dados no mesmo host.

**Recuperação da instalação:** [prova de reconstrução no mesmo computador](../validation/aurora-host-restore/RESULTS.md). No [ensaio entre backups](../validation/aurora-host-restore/RESULTS.md#perda-entre-backups), três de sete pedidos confirmados ficaram fora da cópia recuperada. A geração antiga foi bloqueada quando a autoridade avançou. O aceite local precisa explicitar a janela recuperável e o procedimento diante de uma cópia antiga.

**Concorrência local posterior:** [comparação com um e dois workers](../validation/aurora-queue/CONCURRENCY.md) comprovou o limite e o isolamento por trabalho em um host. P10 segue para carga prolongada e metas do ambiente alvo. A aprovação de produção ainda exige qualificação de recuperação do host, orçamento, integrações e operação.

**Fila durável posterior:** [P10 avançou no laboratório](../validation/aurora-queue/RESULTS.md) com admissão persistida, recusa por capacidade, retomada da fila após queda da API e medição de oito trabalhos completos. Permanecem concorrência de execução, orçamento por trabalho, recuperação do launcher completo e ensaio sustentado no ambiente de destino.

**Homologação local posterior:** [quatro provas no Aurora](../validation/aurora-qualification/RESULTS.md). P07 tem evidência de restauração em volumes novos com autoridade sobrevivente. P10 tem medidas de replay e de admissão serializada, com fila durável e capacidade empresarial ainda pendentes. P06 tem consumo e latência medidos na conta ChatGPT, com custo faturado em aberto. P09 segue para conectores do ambiente alvo após PASS dos motores de dados no laboratório.

**Slots diretos do Aurora:** o caminho de planejamento, especialistas, diretores e síntese agora usa [admissão assinada, recibos e revisão por duas identidades](../validation/aurora-model-slots/RESULTS.md). P01/P02 estão atendidos nesse recorte do MVP local. P03 recebeu verificação por executor para chamadas diretas. Resta qualificar supervisão e fencing em múltiplos processos e hosts, recuperação completa, e as demais fronteiras de produção abaixo. Os 33 slots concluídos das sessões anteriores foram inventariados em leitura e continuam ligados às instalações de origem.

**Entrega posterior de integração:** a [central humana](../validation/human-recovery/RESULTS.md) agora aciona o protocolo conectado com inspeção, duas identidades e journal. P01/P02 ainda incluem vincular os slots diretos de LLM da demo a admissões/recibos estáveis, migração dos casos antigos e qualificação empresarial. Isso não representa cobertura universal de todos os unknown do produto.

**Central humana posterior:** [API e interface integradas](../validation/human-recovery/RESULTS.md) ao protocolo conectado, incluindo seleção de casos e duas revisões. P01/P02 seguem para as categorias/slots diretos de LLM ainda não vinculados, migração e qualificação empresarial; não se afirma que todo unknown da aplicação já possa ser encerrado pela ponte.

**Atualização posterior:** os procedimentos read_commit/unknown foram implementados e passaram em [nova qualificação local](../validation/observability-recovery/RESULTS.md), incluindo dez casos de quedas/restore/recusas. P01/P02 agora exigem integrar esses procedimentos ao domínio e à central humana do produto, ampliar casos múltiplos/migração e qualificar a instalação alvo. Isso não altera os FAIL históricos nem fecha a homologação empresarial. [Plano incorporado](PLANO_OBSERVABILIDADE.md).

Status: backlog aberto, não nova fase de investigação. Responsáveis abaixo são papéis técnicos, sem atribuir pessoas inexistentes. Criticidade indica risco/aceite; não é uma certificação quantitativa de probabilidade.

| ID | Prioridade / responsável | Trabalho e evidência de aceite | Momento que bloqueia |
|---|---|---|---|
| P01 | Crítica — runtime e domínio | Recuperar as janelas de intenção → commit local → confirmação retida do novo `read_commit`; injetar quedas em cada fronteira, reiniciar e provar ausência de resposta/efeito duplicado ou aceite obsoleto | Confiar em recuperação do produto/piloto; não bloqueia esqueleto e UI de M1 |
| P02 | Crítica — governança | Encerramento específico de inferência sem recibo, evidência vinculada e revisores independentes; manter consumo/reservas, impedir reutilizar intenção e não tratar unknown como sucesso | Retomada/encerramento operacional dessa categoria; sem mecanismo, trabalho permanece bloqueado |
| P03 | Alta — runtime | Heartbeat automático e reação à falha, expiração e fencing; testar processos concorrentes, desconexão e revogação durante inferência contra o produto | Trabalhos longos/confiabilidade do piloto |
| P04 | Crítica — identidade e segurança | IdP/SSO conforme cliente, MFA/federação quando exigidos, TLS, grants em cada fronteira, JWKS/rotação/revogação, segredo sem propagação ao código não confiável; testes de identidade restrita | Dados empresariais, acesso remoto e instalação real |
| P05 | Crítica — ferramentas e segurança | Gateway MCP/APIs, permissões por alvo/payload/tempo, sandbox por classe de código, idempotência e conciliação de efeitos, cancelamento e aprovação exata; execução adversarial controlada | Ferramentas/efeitos externos reais e código arbitrário |
| P06 | Alta — modelos e finanças | Provedor contratável independente de conta pessoal obrigatória; reservas/limites atribuíveis por trabalho, ingestão/retries/falhas, tokens e gasto monetário verificáveis; exaustão concorrente | Orçamento comercial e uso produtivo faturável |
| P07 | Crítica — dados e operações | Backup verificável e restauração de dados, índices, permissões, diário, autoridade e chaves no mesmo host. Medir janela de perda e tempo de retorno, preservar recibos e bloquear rollback inseguro | Homologação da recuperação local |
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
