// Ponta a ponta: uma instalação real em SQLite é parada, migrada pela CLI e continua em PostgreSQL.
// Precisa de AURORA_TEST_POSTGRES_URL; sem ela, é ignorado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fakeBackend, newStateDir, startApi, waitFor, job, type Api } from "./harness.ts";

const url = process.env.AURORA_TEST_POSTGRES_URL;
const cli = fileURLToPath(new URL("../ledger/migrate-cli.ts", import.meta.url));
const schema = "e2e_" + randomBytes(5).toString("hex");

let backend: Awaited<ReturnType<typeof fakeBackend>>;
const running: Api[] = [];
before(async () => {
  backend = await fakeBackend();
});
after(async () => {
  await Promise.all(running.map((a) => a.stop("SIGKILL")));
  await backend.close();
  if (url) {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test("instalação SQLite migrada pela CLI continua em PostgreSQL: mesmo trabalho, aprovação e efeito", { skip: url ? false : "defina AURORA_TEST_POSTGRES_URL" }, async () => {
  const state = newStateDir();
  const start = async (ledger: object) => {
    const api = await startApi({ state, backend: backend.url, workerMode: "journey", extraConfig: { ledger } });
    running.push(api);
    return api;
  };

  // 1. A instalação roda em SQLite e deixa um trabalho aguardando aprovação.
  const sqlite = await start({ driver: "sqlite" });
  const id = (await sqlite.post("/api/jobs")).body.id;
  const before = await waitFor(async () => {
    const j = await job(sqlite, id);
    return j?.status === "awaiting_approval" && j;
  }, "parecer pronto");
  await sqlite.stop("SIGKILL");

  // 2. A CLI recusa se pedirmos algo inválido, simula sem gravar e depois migra de verdade.
  const args = ["--state", state, "--url", url!, "--installation", "test-install", "--schema", schema];
  const run = (...extra: string[]) => execFileSync(process.execPath, [cli, ...args, ...extra], { encoding: "utf8" });
  assert.match(run("--dry-run"), /Simulação concluída \(nada foi gravado\)/);
  const out = run();
  assert.match(out, /Migração concluída/);
  assert.match(out, /jobs\s+1 linhas/);
  assert.throws(() => run(), /não está vazio/, "uma segunda migração não sobrescreve");

  // 3. O mesmo diretório de estado agora sobe em PostgreSQL e enxerga o mesmo trabalho.
  const postgres = await start({ driver: "postgres", connectionString: url, schema });
  const after = await job(postgres, id);
  assert.equal(after.status, "awaiting_approval");
  assert.equal(after.review.hash, before.review.hash);
  assert.deepEqual(after.events.map((e: any) => e.node), before.events.map((e: any) => e.node), "a trilha chegou intacta");

  // 4. E o fluxo continua: aprovar, executar o efeito uma vez e concluir.
  const approved = await postgres.post(`/api/jobs/${id}/approve`, { hash: before.review.hash });
  assert.equal(approved.status, 202);
  const done = await waitFor(async () => {
    const j = await job(postgres, id);
    return j?.status === "completed" && j;
  }, "concluído em PostgreSQL");
  assert.equal(done.receipt.hash, before.review.hash);
  assert.equal(done.events.filter((e: any) => e.node === "effect_receipt").length, 1);
});
