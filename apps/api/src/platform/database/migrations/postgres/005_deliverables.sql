-- Entregas, suas versões e as reaberturas pedidas pelo gestor (módulo deliverables).
CREATE TABLE deliverables (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('in_review', 'accepted', 'changes_requested')),
  current_version  INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  decided_by       TEXT,
  decision_note    TEXT,
  ordinal          BIGINT NOT NULL UNIQUE
);

CREATE TABLE deliverable_versions (
  deliverable_id  TEXT NOT NULL REFERENCES deliverables (id),
  version         INTEGER NOT NULL,
  -- Cada trabalho gera no máximo uma versão.
  job_id          TEXT NOT NULL UNIQUE,
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (deliverable_id, version)
);

-- Trabalho aberto para revisar uma entrega (o efeito dele vira a próxima versão).
CREATE TABLE deliverable_reopenings (
  job_id          TEXT PRIMARY KEY,
  deliverable_id  TEXT NOT NULL REFERENCES deliverables (id),
  from_version    INTEGER NOT NULL,
  feedback        TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
