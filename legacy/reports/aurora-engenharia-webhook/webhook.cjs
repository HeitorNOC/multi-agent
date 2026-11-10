"use strict";

function initialize(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      tenant_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (tenant_id, event_id)
    );
  `);
}

function ingest(db, { tenantId, eventId, payload }) {
  let active = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    active = true;
    const result = db.prepare(
      "INSERT INTO effects (tenant_id, event_id, payload) VALUES (?, ?, ?) ON CONFLICT(tenant_id, event_id) DO NOTHING"
    ).run(tenantId, eventId, payload);

    let status;
    if (result.changes === 1 || result.changes === 1n) {
      status = "accepted";
    } else {
      const row = db.prepare(
        "SELECT payload FROM effects WHERE tenant_id = ? AND event_id = ?"
      ).get(tenantId, eventId);
      if (!row) throw new Error("Existing effect not found");
      status = row.payload === payload ? "duplicate" : "conflict";
    }

    db.exec("COMMIT");
    active = false;
    return status;
  } catch (error) {
    if (active) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
    }
    throw error;
  }
}

module.exports = { initialize, ingest };
