"use strict";

function initialize(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      tenant_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
}

function ingest(db, { tenantId, eventId, payload }) {
  db.prepare("INSERT INTO effects VALUES (?, ?, ?)").run(tenantId, eventId, payload);
  return "accepted";
}

module.exports = { initialize, ingest };
