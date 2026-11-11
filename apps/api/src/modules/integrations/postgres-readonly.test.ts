// Banco somente leitura (N4): nomes validados, CSV, lista de tabelas liberadas e, com
// AURORA_TEST_POSTGRES_URL, a leitura de verdade (inclusive que escrever é impossível).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { AppError } from "../../shared/errors.ts";
import { cleanConfig, PostgresReadonlyAdapter, tableName, toCsv } from "./infrastructure/postgres-readonly.ts";
import { parseCsv, tableSummaries } from "../knowledge/domain/table.ts";

const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
};

test("nomes de tabela validados, CSV com aspas e configuração limpa", () => {
  assert.deepEqual(tableName("vendas.pedidos"), { schema: "vendas", table: "pedidos" });
  assert.deepEqual(tableName("pedidos"), { schema: "public", table: "pedidos" });
  for (const bad of ['pedidos"; drop table x; --', "a.b.c d", "1tabela", ""]) assert.equal(code(() => tableName(bad)), "invalid_table", bad);
  assert.equal(toCsv(["a", "b"], [{ a: "x;y", b: 'diz "oi"' }, { a: null, b: 2 }]), 'a;b\n"x;y";"diz ""oi"""\n;2\n');
  assert.deepEqual(cleanConfig({ tables: ["public.avaliacoes", "public.avaliacoes"], max_rows: 999999 }), { tables: ["public.avaliacoes"], max_rows: 5000 });
  assert.equal(code(() => cleanConfig({ tables: ["x; drop"] })), "invalid_table");
});

const url = process.env.AURORA_TEST_POSTGRES_URL;
const schema = "ro_" + randomBytes(4).toString("hex");
const credentials = { get: async () => ({ token: url! }), set: async () => undefined };

before(async () => {
  if (!url) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${schema}.avaliacoes (canal text, nota int, tempo_min numeric)`);
  await admin.query(`INSERT INTO ${schema}.avaliacoes VALUES ('WhatsApp', 5, 3), ('WhatsApp', 4, 5), ('E-mail', 2, 240)`);
  await admin.query(`CREATE TABLE ${schema}.segredos (x text)`);
  await admin.end();
});
after(async () => {
  if (!url) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test("PostgreSQL de verdade: lista só o liberado, lê como tabela calculável e não escreve", { skip: !url && "defina AURORA_TEST_POSTGRES_URL" }, async () => {
  const adapter = new PostgresReadonlyAdapter();
  const config = (await adapter.validate({ tables: [`${schema}.avaliacoes`] }, credentials)) as never;
  const { items } = await adapter.browse(config, credentials, {});
  assert.deepEqual(items.map((i) => i.id), [`${schema}.avaliacoes`]);
  const fetched = await adapter.fetch(config, credentials, `${schema}.avaliacoes`);
  const table = parseCsv(new TextDecoder().decode(fetched.bytes));
  assert.deepEqual(table.columns, ["canal", "nota", "tempo_min"]);
  assert.match(tableSummaries("avaliacoes", table).find((s) => s.section === "Por canal")!.text, /canal = WhatsApp: 2 linha\(s\); nota média 4,5/);
  assert.equal(await adapter.revision(config, credentials, `${schema}.avaliacoes`), fetched.revision);
  await assert.rejects(adapter.fetch(config, credentials, `${schema}.segredos`), (e: AppError) => e.code === "table_not_allowed");
  await assert.rejects(adapter.validate({ tables: [`${schema}.nao_existe`] }, credentials), (e: AppError) => e.code === "table_not_found");
  // A transação é somente leitura: nem um INSERT direto passaria por ela.
  const write = await (adapter as unknown as { read: (c: unknown, w: (cl: pg.Client) => Promise<unknown>) => Promise<unknown> })
    .read(credentials, (cl) => cl.query(`INSERT INTO ${schema}.segredos VALUES ('x')`))
    .then(() => "escreveu", (e: { code?: string }) => e.code);
  assert.equal(write, "25006", "read_only_sql_transaction");
});
