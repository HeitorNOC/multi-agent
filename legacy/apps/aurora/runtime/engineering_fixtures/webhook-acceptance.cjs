"use strict";

const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { initialize, ingest } = require("./webhook.cjs");

test("webhook deduplicates repeated deliveries and preserves tenant scope", async () => {
  const path = "/tmp/webhook.sqlite";
  let db = new DatabaseSync(path);
  initialize(db);
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/webhook");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = ingest(db, JSON.parse(Buffer.concat(chunks).toString()));
      const status = { accepted: 202, duplicate: 200, conflict: 409 }[result];
      assert.ok(status, `unexpected result: ${result}`);
      response.writeHead(status).end();
    } catch {
      response.writeHead(500).end();
    }
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/webhook`;
    const event = { tenantId: "a", eventId: "event-1", payload: '{"text":"hello"}' };
    const send = async (value) => (await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    })).status;
    const count = () => db.prepare("SELECT count(*) AS n FROM effects").get().n;
    assert.deepEqual((await Promise.all([send(event), send(event)])).sort(), [200, 202]);
    assert.equal(count(), 1);
    console.log("CHECK duplicate: HTTP 202 then 200 across two deliveries; one stored effect");
    assert.equal(await send({ ...event, payload: "different" }), 409);
    assert.equal(db.prepare("SELECT payload FROM effects").get().payload, event.payload);
    console.log("CHECK conflict: HTTP 409 for changed payload; original unchanged");
    assert.equal(await send({ ...event, tenantId: "b" }), 202);
    console.log("CHECK tenant: same event ID in another tenant independently accepted");
    db.close();
    db = new DatabaseSync(path);
    initialize(db);
    assert.equal(await send(event), 200);
    assert.equal(count(), 2);
    console.log("CHECK reopen: duplicate still recognized after reopening the SQLite file");
    db.exec("CREATE TRIGGER reject_effect BEFORE INSERT ON effects WHEN NEW.event_id = 'fail' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
    assert.equal(await send({ ...event, eventId: "fail" }), 500);
    assert.equal(count(), 2);
    db.exec("DROP TRIGGER reject_effect");
    assert.equal(await send({ ...event, eventId: "fail" }), 202);
    assert.equal(count(), 3);
    console.log("CHECK rollback: injected write failure returned HTTP 500 with no effect; retry accepted exactly once");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
