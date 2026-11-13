-- N6: recursos da empresa (bancos, filas, ambientes, repositórios, nuvem) que o CEO provisiona para
-- o time. Só descrições; credenciais ficam nos conectores, cifradas.
CREATE TABLE company_resources (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('database', 'queue', 'environment', 'repository', 'cloud', 'other')),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  ordinal      INTEGER NOT NULL
);
