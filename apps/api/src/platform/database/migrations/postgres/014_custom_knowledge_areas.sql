-- Áreas do Cérebro criadas pela empresa (além de "Geral" e das áreas do catálogo de agentes).
CREATE TABLE knowledge_areas (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
