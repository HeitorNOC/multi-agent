-- Cérebro por área e origem do conteúdo.
-- `area`: área da empresa a que a fonte pertence (as do catálogo de agentes, ou `general`).
-- `origin`: `file` (arquivo enviado) ou `text` (texto escrito direto no Aurora).
ALTER TABLE knowledge_sources ADD COLUMN area TEXT NOT NULL DEFAULT 'general';
ALTER TABLE knowledge_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'file';
