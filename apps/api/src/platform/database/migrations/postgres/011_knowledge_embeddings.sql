-- Busca por significado: vetor (embedding) de cada trecho, por modelo.
-- A chave é o hash do texto que foi vetorizado (título, seção e trecho): trechos iguais não são
-- recalculados, e trocar o modelo não mistura vetores de modelos diferentes.
CREATE TABLE knowledge_embeddings (
  model        TEXT NOT NULL,
  content_key  TEXT NOT NULL,
  dims         INTEGER NOT NULL,
  vector       BYTEA NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (model, content_key)
);
