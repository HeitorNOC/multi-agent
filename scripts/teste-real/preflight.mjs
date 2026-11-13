// Checagem do ambiente do teste real (docs/TESTE_REAL_WEBCHAT.md). Não muda nada.
// Uso: node scripts/teste-real/preflight.mjs [--probe]   (--probe faz uma chamada mínima ao modelo)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const win = process.platform === "win32";
const python = join(root, "apps/runtime/.venv", win ? "Scripts/python.exe" : "bin/python");
const results = [];
/** `info` aparece sempre; `hint` (o que fazer) só quando falha. */
const check = (name, ok, hint = "", info = "") => results.push({ name, ok, note: ok ? info : hint });
// Sem shell: a mesma forma como a API chama a CLI (o shell do Windows estragaria o JSON do schema).
const run = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: "utf8", timeout: 120_000, windowsHide: true });

check("Node 24 ou mais", Number(process.versions.node.split(".")[0]) >= 24, "atualize o Node", `atual: ${process.versions.node}`);
check("Interface construída (apps/web/dist)", existsSync(join(root, "apps/web/dist/index.html")), "rode npm run build");

const cli = run("claude", ["--version"]);
check("CLI do Claude instalada", cli.status === 0, "instale o Claude Code e faça login", (cli.stdout ?? "").trim());

check("Ambiente Python do worker", existsSync(python), "rode npm run setup:runtime");
if (existsSync(python)) {
  const imp = run(python, ["-I", "-c", "import langgraph, psycopg; from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver; print('ok')"]);
  check("Dependências do worker (LangGraph + psycopg)", imp.status === 0, imp.status === 0 ? "" : (imp.stderr || "").trim().split("\n").pop());
}

// Sem AURORA_CHECKPOINT_DSN, o PostgreSQL portátil do teste (scripts/teste-real/postgres.ps1).
const dsn = process.env.AURORA_CHECKPOINT_DSN ?? "postgresql://postgres@127.0.0.1:5433/aurora_checkpoints";
{
  const pg = createRequire(join(root, "apps/api/package.json"))("pg");
  const client = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query("select current_database() as db, version() as v");
    check("PostgreSQL dos checkpoints acessível", true, "", `${rows[0].db} · ${rows[0].v.split(",")[0]}`);
  } catch (error) {
    check("PostgreSQL dos checkpoints acessível", false, `${error.message || error.code} — suba com ./scripts/teste-real/postgres.ps1`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--probe")) {
  const schema = JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] });
  const probe = run("claude", ["-p", "--output-format", "json", "--json-schema", schema, "--tools", "", "--no-session-persistence", "--strict-mcp-config"], "Responda com ok = true.");
  let ok = false;
  let why = (probe.stderr || probe.error?.message || "sem saída").trim();
  try {
    const out = JSON.parse(probe.stdout);
    ok = probe.status === 0 && !out.is_error;
    if (typeof out.result === "string") why = out.result;
  } catch {}
  check("Modelo responde pela CLI (--probe)", ok, `${why.slice(0, 200)} — abra um terminal, rode claude e faça login (/login)`);
}

for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} item(ns) pendente(s).` : "\nTudo pronto. Suba com ./scripts/teste-real/iniciar.ps1");
process.exit(failed ? 1 : 0);
