// Rotas do Cérebro via `inject`: envio, consulta com citação, original pela citação, limites.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { InjectOptions } from "fastify";
import { manualClock } from "../../../shared/clock.ts";
import { ActorId } from "../../../shared/ids.ts";
import { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { createHttpApp } from "../../../platform/http/app.ts";
import { fresh, type TestDatabase } from "../../../../test/support/databases.ts";
import { ExtractiveAnswerer } from "../application/answerers.ts";
import { KnowledgeSearch } from "../application/knowledge-search.ts";
import { Bm25Index } from "../infrastructure/bm25-index.ts";
import { knowledgeStore } from "../infrastructure/sql-knowledge.ts";
import { knowledgeHttp } from "./routes.ts";

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

async function setup() {
  const d: TestDatabase = await fresh("sqlite");
  opened.push(d);
  const clock = manualClock("2026-03-01T12:00:00.000Z");
  const uow = new UnitOfWork(d.db, knowledgeStore(clock));
  const deps = { uow, clock, search: new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p)), answerer: new ExtractiveAnswerer(), maxBytes: 100_000 };
  const app = await createHttpApp({
    origin: () => "http://127.0.0.1:4100",
    actor: () => ActorId.parse("ana"),
    modules: [knowledgeHttp(deps, { uploadLimit: 200_000 })],
  });
  opened.push({ close: () => app.close() });
  return (opts: InjectOptions) => app.inject({ ...opts, headers: { host: "127.0.0.1:4100", ...opts.headers } });
}

const TEXT = "# Reembolso\n\nDespesas de viagem são reembolsadas em até 10 dias úteis.";
const body = (extra: object = {}) => ({
  title: "Reembolso",
  filename: "reembolso.md",
  media_type: "text/markdown",
  content_base64: Buffer.from(TEXT).toString("base64"),
  ...extra,
});

test("enviar, perguntar e abrir o original pela citação", async () => {
  const call = await setup();
  const created = await call({ method: "POST", url: "/api/knowledge/sources", payload: body() });
  assert.equal(created.statusCode, 201);
  const answer = (await call({ method: "POST", url: "/api/knowledge/query", payload: { question: "prazo de reembolso de despesas de viagem" } })).json();
  assert.equal(answer.abstained, false);
  const original = await call({ method: "GET", url: answer.citations[0].url });
  assert.deepEqual([original.statusCode, original.body, original.headers["content-type"]], [200, TEXT, "text/plain; charset=utf-8"]);
  assert.equal((await call({ method: "GET", url: "/api/knowledge/sources" })).json().sources.length, 1);
});

test("só as rotas de envio aceitam corpo grande; validações viram 400", async () => {
  const call = await setup();
  const big = "x".repeat(50_000);
  const upload = await call({ method: "POST", url: "/api/knowledge/sources", payload: body({ content_base64: Buffer.from(big).toString("base64") }) });
  assert.equal(upload.statusCode, 201, "envio aceita até o limite próprio");
  const query = await call({ method: "POST", url: "/api/knowledge/query", payload: { question: "x", pad: big } });
  assert.equal(query.statusCode, 413, "consulta mantém o limite padrão");
  const cases: [object, string][] = [
    [body({ title: "" }), "invalid_request"],
    [body({ extra: 1 }), "invalid_request"],
    [body({ readers: [] }), "invalid_request"],
    [body({ valid_from: "ontem" }), "invalid_request"],
    [body({ media_type: "application/pdf" }), "unsupported_media_type"],
  ];
  for (const [payload, code] of cases)
    assert.equal((await call({ method: "POST", url: "/api/knowledge/sources", payload })).json().code, code, JSON.stringify(payload).slice(0, 60));
  assert.equal((await call({ method: "GET", url: "/api/knowledge/sources/x/versions/0/original" })).statusCode, 400);
});
