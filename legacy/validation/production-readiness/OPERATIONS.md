# Operação por cliente e qualificação de capacidade

## Implantação dedicada

Mesmo código-base, instalação separada por empresa, com banco, índices/grafo, objetos, secrets, credenciais de provedores, logs, budgets e backups isolados. A existência de company_id/workspace/group_id não substitui esse isolamento operacional. O cérebro é lógico e central por instalação; não é um cadastro público multi-tenant.

Organizar inicialmente em poucos blocos lógicos: aplicação/governança e JARVIS, runtime confiável Python/LangGraph, Knowledge API com bibliotecas prontas, persistência e workers de ingestão/ferramentas. Fronteira lógica não exige um microserviço. UI e camada empresarial seguem candidatas TypeScript/React; o Python de teste não mudou essa decisão nem impôs NestJS.

Para piloto, configuração menor com as mesmas fronteiras de autorização e contratos. Para empresa grande, dimensionar replicas/pools/filas, HA e storage segundo medidas e SLA. Não inserir Kubernetes, Kafka, Temporal ou Redis por antecipação. Se forem necessários, a decisão deve apontar o requisito que não foi atendido por componentes e transações existentes.

Reutilizar SSO, secrets/KMS, backup e observabilidade disponíveis no cliente quando adequados. Não criar IdP, cofre, motor de grafo, banco vetorial ou hypervisor próprios. Os exemplos de bibliotecas/serviços no parecer são candidatos; nenhum foi contratado ou integralmente homologado.

## Banco, durabilidade e consistência

PostgreSQL 16.15 real, imagem local fixada por digest, com fsync/full_page_writes/synchronous_commit ligados. Dezenove verificações SQL passaram: grants e RLS, proveniência, hash, versões, owner/FORCE RLS, contexto inseguro por GUC, publicação de geração, reserva concorrente, perda abrupta e restauração lógica.

Um SIGKILL no servidor durante uma transação deixou os dados confirmados e descartou a linha não confirmada após recovery WAL. Um pg_dump/pg_restore local manteve dados e policy: reader_sales continuou vendo uma fonte, e snapshot ativo permaneceu g1. O restore foi em outro banco no mesmo cluster, com roles já existentes. Isso não certifica restore de cluster/roles/secrets, PITR, failover, disco danificado ou toda a instalação.

O saver PostgreSQL nativo 3.2.0 do LangGraph, no mesmo SHA do motor auditado, foi exercitado com role sem superuser/BYPASSRLS. Processo inicial persistiu checkpoint e interrupt; banco sofreu SIGKILL/restart; processo novo retomou e concluiu. A etapa de evidência foi chamada uma vez. A credencial desse runtime confiável não deve ir para o sandbox que executa código arbitrário.

Falhas preservadas: event loop Proactor incompatível com psycopg assíncrono no Windows, depois timeouts de endereço desatualizado após reinício. A prova passou usando SelectorEventLoop e redescoberta da porta efêmera; as portas observadas passaram de 54084 para 54094. São adaptações do ambiente/driver da prova, sem fork do motor.

Uma interrupção temporária do sistema de revisão impediu uma execução; a nova tentativa pelo fluxo normal foi permitida. Depois o Docker Desktop estava parado; foi restabelecido pela CLI existente e a prova foi executada. Não classificar esses eventos como falhas arquiteturais do LangGraph. Logs e tentativas anteriores estão preservados.

## Backup do cérebro inteiro

Definir um ponto consistente envolvendo catálogo/ACL/versionamento, objetos originais, manifesto da geração ativa, vetores/grafo/episódios, checkpoint/run ledger, custos/outbox/inbox e referências de secrets. Recuperar apenas o PostgreSQL canônico não reconcilia automaticamente índices ou efeitos em APIs externas.

[Dump lógico](https://www.postgresql.org/docs/current/backup-dump.html) e [PITR](https://www.postgresql.org/docs/current/continuous-archiving.html) são estratégias diferentes: PITR requer backup base e sequência WAL apropriada. Provar restauração num ambiente limpo e isolado, incluindo papéis, extensões, configuração, chaves e versões. Criptografar e testar recuperação das chaves de backup.

Após restore, manter o sistema em recovery_required até verificar manifests, permissões e obrigações externas. Um backup antigo não pode autorizar reenvio de e-mail/pagamento já efetuado. Recibos e idempotência do provedor precisam sobreviver à restauração ou ser consultáveis. Salvar exemplos de origem e resultados verificáveis para testar reconstrução sem confiar apenas em contagem de linhas.

## Workers, concorrência e recuperação

Uma autoridade dispara o run; LangGraph governa suas etapas. Evitar cron/governança/runtime disparando a mesma intenção de forma independente. Registrar lease/geração do dono, heartbeats, estado pendente, cancelamento e fences. Retentativas são limitadas e classificadas: reexecutar leitura pode ter custo, reexecutar efeito sem idempotência pode ser irreversível.

Orçamento e capacidade precisam ser reservados antes do fan-out. Aplicar limites de chamadas/modelo, TPM/RPM, conexões, memória, fila e participantes, com backpressure e rejeição controlada. Uma grande quantidade de agentes cadastrados não implica executá-los simultaneamente. Especialistas são por capacidade e tarefa; contratação permanente e temporários seguem a policy definida no dossiê.

O LightRAG usa mecanismos de locks/Manager para multiprocessing. Isso não homologou writers em hosts independentes. Definir owner/fence por índice ou outro modelo oficialmente suportado e ensaiar concorrência antes de escalar ingestão horizontalmente.

A prova OpenAgents anterior demonstrou transporte duplicado e inbox persistente com uma aplicação do resultado, inclusive após restart. O contrato continua exigindo identidade de evento, payload/digest, outbox, inbox e tratamento de mensagens fora de ordem. Não transformar cada tool-call em issue organizacional.

## Observabilidade e resposta a incidente

Correlacionar instalação/empresa/tarefa/run/agente/chamada/provedor/fonte/versão/snapshot/policy, com estados honestos: aceito, executando, aguardando aprovação, pendente de efeito, concluído, falho, cancelado e incerto. Medir conclusão correta/segura, p50/p95, custo por entrega aceita, retries, intervenções, filas, idade de ingestão, drift de índices, atraso de backup e diferenças de conciliação.

Logs, prompts, snippets, screenshots e checkpoints podem conter dados confidenciais. Redigir secrets/PII, limitar acesso e retenção, proteger exportações e evitar telemetria externa não aprovada. Hashes locais ajudam a detectar divergência, mas não garantem auditoria imutável contra administrador privilegiado. Avaliar trilha externa/WORM e assinatura conforme o risco.

Runbooks: custo acima do limite, chave vazada, provedor indisponível, fila travada, perda de lock, grafo corrompido, ACL revogada, backup inconsistente, migração incompatível e incidente de segurança. Deve haver parada global/por ferramenta e escalonamento humano sem exigir intervenção por prompt.

## Escala: hipótese não é capacidade comprovada

A referência de desenho usa 2 mil usuários, 100 workflows ativos, 10 mil tarefas/dia e um milhão de documentos. O stress hipotético usa 10 mil usuários, 500 workflows ativos, 50 mil tarefas/dia e dez milhões de documentos. Esses valores vêm de hipóteses nossas após a orientação do usuário, não de medições.

Ensaios propostos: primeiro corpus representativo pequeno, depois 1 mil/10 mil/100 mil fontes e concorrência 5/10/25, chegando ao alvo conforme os gargalos forem conhecidos. Separar teste de backend com modelos simulados de medição com provedor real. Misturar ingestão/consulta, fontes densamente conectadas, ACLs, atualização e recuperação; não testar só documentos uniformes ou cache quente.

Precisam ser acordados com o cliente: SLA, região, janelas, retenção, RPO/RTO e critérios de qualidade. Como ponto inicial de discussão, ensaiar RPO de até 15 min e RTO de até 4 h; não são compromissos aceitos ou já atingidos. Medir reconhecimento/progresso e resposta de conhecimento separadamente da conclusão de tarefas deliberativas ou da espera humana.

Alta disponibilidade e capacidade de uma grande empresa só podem ser afirmadas após testes na topologia real, incluindo limites dos provedores, failover, disaster recovery e janela de upgrades. Nenhum teste desta rodada demonstrou esses alvos de escala.

## Suprimentos e atualização

Fixar fonte/versão/digest de aplicativo, adapters, modelos/configurações, embeddings, tokenizer, schema e índice. Produzir SBOM, scan CVE, revisão de licença/ativos e verificação de proveniência. Reexecutar testes de contrato e migração de checkpoint/índice em staging antes de atualizar. Não adotar latest ou contornar um gate de compatibilidade para fazer o serviço subir.

O PostgreSQL testado não incluía pgvector/AGE. O backend final do cérebro e a integração temporal Graphiti ainda precisam ser escolhidos e ensaiados. Externamente, tarifas/modelos podem mudar: conservar rate cards datados e revalidar deprecações, acesso, processamento de dados e condições contratuais antes de uso comercial.
