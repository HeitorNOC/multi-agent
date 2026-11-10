# E3 — Cérebro: fontes e consulta com citação

Status (09/11/2026): entregue com busca lexical (BM25) e respostas extrativas; respostas redigidas por modelo são opcionais.

## O que faz

- **Enviar fontes** com título, dono, leitores e data de vigência. Formatos: `.md`, `.txt`, `.csv`, `.json` (UTF-8), até 5 MB. PDF e DOCX são recusados por enquanto.
- **Versões**: só o dono publica; conteúdo idêntico à última versão é recusado; duas versões enviadas ao mesmo tempo não se corrompem (uma entra, a outra recebe 409).
- **Perguntar**: a resposta cita os trechos usados; cada citação abre o arquivo original exatamente como foi enviado (servido como texto puro, em sandbox).
- **Revogar**: a fonte sai das respostas na hora; o histórico continua guardado.
- **Substituir**: uma fonte pode substituir outra do mesmo dono; enquanto a nova valer, a antiga sai das respostas. Revogar a nova devolve a antiga.

## O que entra numa resposta, nesta ordem

1. Acesso: o dono, os leitores listados ou `"*"` (todos da instalação). Quem não lê nem sabe que a fonte existe (404).
2. Fonte não revogada.
3. De cada fonte, a versão mais nova cuja vigência já começou.
4. Fontes substituídas por outra vigente ficam de fora.
5. Evidência mínima: o trecho precisa ter termos suficientes da pergunta, e trechos secundários precisam ter pelo menos metade da pontuação do melhor. Sem evidência, o Cérebro se abstém.

Conflitos entre fontes são resolvidos por esses metadados explícitos (vigência e substituição), não por palpite.

## Configuração

```json
{ "knowledge": { "answerer": { "engine": "model", "provider": "claude" }, "maxBytes": 5000000 } }
```

Sem `answerer`, as respostas são extrativas (frases das fontes, sem modelo). Com o modelo, a resposta só vale se todas as citações existirem entre os trechos enviados; senão, volta para a extrativa e mostra o motivo. O Chief of Staff e o Cérebro compartilham um limitador de chamadas (a cota da assinatura é uma só).

## Rotas

| Método e rota | Função |
|---|---|
| `GET /api/knowledge/sources` | fontes que o usuário pode ler, com estado (vigente, substituída, revogada, ainda não vigente) |
| `POST /api/knowledge/sources` | enviar (JSON com o arquivo em `content_base64`) |
| `GET /api/knowledge/sources/:id` | detalhe e versões |
| `POST /api/knowledge/sources/:id/versions` | nova versão |
| `POST /api/knowledge/sources/:id/revoke` | revogar |
| `GET /api/knowledge/sources/:id/versions/:v/original` | arquivo original |
| `POST /api/knowledge/query` | pergunta |

## Verificado

| Verificação | Resultado |
|---|---|
| Contrato do ledger (SQLite e PostgreSQL), incluindo bytes não UTF-8 | PASS nos dois |
| Serviço, índice, vigência, acesso, revogação, substituição, concorrência, respondedor por modelo | 20 PASS |
| HTTP com servidor real, SQLite e PostgreSQL | 6 PASS em cada |
| Migração de dados SQLite → PostgreSQL com fontes e bytes binários | PASS |
| Navegador (UI do Aurora): envio pelo formulário, pergunta, citação, original; desktop e 375 px | conferido |

Defeitos encontrados e corrigidos nesta etapa: cache do índice que ignorava a data de vigência; migração que comparava bytes como texto; título Markdown grudado na frase da resposta; citação de trecho só com termos genéricos em comum; formulário que mantinha o arquivo anterior.

## Limites

- Busca lexical: sinônimos e paráfrases não são encontrados ("reembolso" não acha "ressarcimento"). Um índice semântico (LightRAG ou pgvector) pode entrar pela interface `KnowledgeIndex`.
- O índice fica em memória e é refeito quando algo muda; adequado a centenas de documentos, não a grandes acervos.
- Não há leitura de PDF/DOCX nem OCR.
- Leitores são identidades em texto; sem identidade corporativa (E4/P04), o usuário local é `operador-local-demo`.
- A resposta redigida por modelo não foi exercitada com uma CLI real nesta etapa (só com CLI simulada).
