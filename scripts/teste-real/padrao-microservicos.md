# Padrão de microserviços

Documento de referência da engenharia. Todo serviço novo segue este padrão; desvios precisam de
aprovação do diretor de engenharia, registrada no pull request.

## Estrutura do repositório

- Um serviço por repositório, em TypeScript (Node.js 24).
- Pastas: `src/domain` (regras, sem dependência de infraestrutura), `src/application` (casos de
  uso), `src/infrastructure` (banco, Kafka, HTTP externo), `src/http` (rotas), `test/`.
- `README.md` com: o que o serviço faz, como rodar localmente, variáveis de ambiente e contatos.

## API

- Contrato em OpenAPI 3.1 (`openapi.yaml`) escrito antes da implementação e revisado.
- REST com JSON; erros no formato `{ "error": { "code", "message" } }`.
- Versionamento no caminho (`/v1/...`). Mudança incompatível exige `/v2` e prazo de migração.
- Tempo real (WebSocket ou SSE) passa pelo gateway de borda, nunca exposto direto.

## Dados

- Cada serviço tem o próprio banco PostgreSQL; nenhum serviço lê o banco de outro.
- Migrações versionadas no repositório, aplicadas no deploy, sempre compatíveis com a versão
  anterior do serviço (expandir, migrar, contrair).
- Dados pessoais: coluna marcada no modelo, retenção definida e rotina de exclusão a pedido (LGPD).

## Eventos

- Comunicação assíncrona pelo Kafka. Tópicos no formato `<dominio>.<entidade>.<evento>`
  (ex.: `atendimento.conversa.encerrada`).
- Eventos em JSON com `schema_version`, `event_id` (idempotência) e `occurred_at`.
- Consumidores idempotentes; mensagens com erro vão para o tópico `<topico>.dlq`.

## Qualidade

- Testes unitários do domínio e testes de integração com PostgreSQL e Kafka em contêiner.
- CI no GitHub Actions: tipos, lint, testes e build da imagem em todo pull request.
- Cobertura mínima de 80% no domínio.

## Operação

- Contêiner com usuário não root; deploy por Helm no Kubernetes.
- Saúde em `/health/live` e `/health/ready`.
- Logs estruturados em JSON com `trace_id`; métricas Prometheus em `/metrics`.
- SLO definido no README (disponibilidade e latência p95) antes de ir a produção.
