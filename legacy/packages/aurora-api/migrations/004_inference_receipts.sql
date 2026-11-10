-- Recibos de inferência do caminho aberto: reserva antes da chamada, recibo depois.
CREATE TABLE IF NOT EXISTS inference_receipts (
  job        TEXT NOT NULL,
  slot       TEXT NOT NULL,
  input_sha  TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('reserved', 'completed')),
  output     TEXT,
  usage      TEXT,
  created    TEXT NOT NULL,
  updated    TEXT NOT NULL,
  ordinal    BIGSERIAL,
  PRIMARY KEY (job, slot)
);
