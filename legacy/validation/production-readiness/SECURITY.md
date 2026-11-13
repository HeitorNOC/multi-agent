# Identidade, sandbox e ferramentas

## Identidade e autorização

Reutilizar o SSO empresarial existente; Keycloak é candidato se for necessário um IdP próprio. Não desenvolver um IdP novo. O guia oficial de [produção Keycloak](https://www.keycloak.org/server/configuration-production) exige tratar TLS, exposição administrativa, disponibilidade e filas. Nenhuma integração SSO real foi instalada aqui.

Distinguir humano, runtime confiável, agente lógico, job de ferramenta e conector externo. Identidade precisa vincular instalação, principal, run/tarefa, audiência, escopos, policy epoch, validade e operação. Autoridade vem do servidor e dos grants vigentes, nunca do cargo escrito no prompt.

A prova local usou jose 6.2.12 existente na árvore auditada. Treze checks passaram: token assinado válido e rejeições de audiência/issuer/chave incorretos, expiração, alg none, instalação/run/escopo divergentes, URL externa de chave no header, jti revogado, política antiga e chave retirada. Não implementa login OIDC, distribuição JWKS, mTLS ou revogação distribuída de produção.

Credenciais de governança, banco, provedor de modelos e reconciliação não devem chegar ao código gerado ou ao modelo. Runtime confiável pode acessar saver; executor arbitrário não recebe esse acesso. Gateway injeta a credencial de ferramenta somente na operação autorizada. Aprovação vincula payload, destino, fonte/versão relevante, ferramenta/servidor/schema e política; alteração material exige revisão.

## RLS e armadilhas verificadas

No PostgreSQL, readers sem superuser/BYPASSRLS viram apenas suas fontes; uma conclusão derivada exigiu acesso a todas as fontes. Revogar grant a ocultou na próxima consulta. Papel de ingestão não conseguiu editar versão histórica ou assumir outro reader.

Também reproduzimos bypass do proprietário sem FORCE RLS e impersonação numa policy insegura baseada apenas em SET app.domain. GUC definido pelo chamador não é identidade autenticada. FORCE RLS submete o owner, mas superuser/BYPASSRLS continuam privilegiados, como explica a [documentação PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). Não expor uma conexão privilegiada ao agente e não assumir que a policy sozinha protege todas as operações.

Roles por leitor foram uma fixture, não proposta de criar milhões de roles. O desenho final deve mapear identidade verificável a autorização por transação e ter testes de pool, contexto residual, SQL injection, privilégios e transações longas durante revogação. Hash de conteúdo detecta alteração inconsistente, mas um administrador capaz de alterar conteúdo e hash também precisa de controles externos de auditoria.

## Sandbox executada

Foram usados seis contêineres descartáveis de uma imagem oficial já local, fixada por digest. Perfil: UID 65534, cap-drop ALL, no-new-privileges, seccomp padrão, root filesystem readonly, sem mounts do host/socket Docker, rede none, tmpfs limitado/noexec, memória 128 MiB, limite de 32 processos e quota de meia CPU.

Resultados observados: CapEff zero, NoNewPrivs=1, Seccomp=2; escrita em raiz negada; saída de rede negada; execução direta em tmpfs noexec negada; spawn extra negado; alocação acima do limite causou OOMKill; kill do contêiner com filho parou o contêiner; /tmp não foi compartilhado entre jobs. Todos os contêineres exclusivos foram removidos.

Isso prova controles nesse Docker Linux/VM local. Não é prova contra escape de kernel, side channel, browser comprometido ou ataques desconhecidos. O teste de noexec não impede que um interpretador leia um script como dado. Não houve montagem de segredo real nem tentativa de explorar infraestrutura externa.

Para código arbitrário ou fontes hostis, avaliar um sandbox pronto com isolamento mais forte, por exemplo [gVisor](https://gvisor.dev/docs/), ou microVMs/serviço apropriado. Não construir um hypervisor próprio. O Docker [explica seus limites](https://docs.docker.com/engine/security/) e [seccomp](https://docs.docker.com/engine/security/seccomp/); rootless é uma opção de redução de privilégios do daemon, não foi demonstrado nesta instalação.

Em produção: imagens mínimas assinadas/fixadas, SBOM e scan de dependências, sem privileged/host networking/Docker socket, filesystem por tarefa, limites de disco/PID/memória/CPU/tempo/output e encerramento de toda a árvore/cgroup. Aprovar o perfil por classe de ferramenta; não copiar bypass sandbox de demos.

## Rede, MCP e conteúdo hostil

A prova bloqueou toda rede. Um conector que precisa de rede exige outra qualificação: egress via proxy/broker com destinos permitidos, bloqueio de metadata/link-local/loopback interno indevido, revalidação de DNS e redirects, TLS e orçamento por operação. URLs não são livremente escolhidas pelo LLM.

Reutilizar implementação MCP e respeitar suas [boas práticas oficiais](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices). Validar audiência/escopo, não repassar indiscriminadamente tokens, fixar identidade e versão do servidor/ferramenta, inspecionar resultados e restringir filesystem. Atualização de descritor de ferramenta não pode ampliar silenciosamente o que foi aprovado.

Quarentenar anexos e parsers/OCR em sandbox, com limites para arquivos compactados, tamanho, expansões e conteúdo ativo. Instruções encontradas numa fonte não podem autorizar envio, exportação ou novo plugin. Ferramentas de gravação usam chave de intenção vinculada a payload estável, recibo e reconciliação. As garantias do provedor real precisam ser demonstradas; um UNIQUE local não cobre uma API externa sem idempotência.

## Pendências de segurança

SSO real, mTLS/JWKS/rotação distribuída, sessão/CSRF/segurança web, SSRF do gateway final, sandbox de browser, allowlist de egress, extração hostil/OCR, scans CVE/SBOM, secrets manager/KMS, retenção/exclusão de traces e auditoria externa não foram homologados nesta rodada. Documentos, prompts, checkpoints e logs devem ser tratados como dados potencialmente confidenciais, com acesso e retenção próprios.
