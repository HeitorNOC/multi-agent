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
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare(
      "SELECT payload FROM effects WHERE tenant_id = ? AND event_id = ?"
    ).get(tenantId, eventId);

    let result;
    if (existing) {
      result = existing.payload === payload ? "duplicate" : "conflict";
    } else {
      db.prepare(
        "INSERT INTO effects (tenant_id, event_id, payload) VALUES (?, ?, ?)"
      ).run(tenantId, eventId, payload);
      result = "accepted";
    }

    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  }
}

module.exports = { initialize, ingest };
