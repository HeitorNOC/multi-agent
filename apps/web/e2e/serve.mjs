// Sobe a API real (com a interface já construída em `dist/`) para os testes de interface.
// Banco SQLite descartável, sem login (AURORA_AUTH=local) e sem modelo de busca por significado.
//
// Com AURORA_E2E_CHECKPOINT_DSN (PostgreSQL) e o Python do worker, liga também o trabalho aberto
// de verdade, com um modelo falso (nenhuma conta é usada): o teste de trabalho só roda assim.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "aurora-ui-"));
const python = join(root, "apps/runtime/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const checkpoint = process.env.AURORA_E2E_CHECKPOINT_DSN;
const work = !!checkpoint && existsSync(python);
writeFileSync(join(dir, "calls.log"), "");

Object.assign(process.env, {
  AURORA_PORT: process.env.AURORA_E2E_PORT ?? "4199",
  AURORA_SQLITE_PATH: join(dir, "aurora.db"),
  AURORA_WEB_DIR: join(root, "apps/web/dist"),
  AURORA_AUTH: "local",
  AURORA_EMBEDDINGS: "none",
  AURORA_TIMEZONE: "America/Sao_Paulo",
  ...(work
    ? {
        AURORA_CHECKPOINT_DSN: checkpoint,
        AURORA_WORKER_COMMAND: JSON.stringify([python, "-I", join(root, "apps/runtime/open_worker.py")]),
        AURORA_MODEL_PROVIDER: "claude",
        AURORA_MODEL_COMMAND: JSON.stringify([
          process.execPath,
          join(root, "apps/api/test/fixtures/fake-open-model.ts"),
          "ok:procurement_analyst,financial_planning_analyst",
          join(dir, "calls.log"),
        ]),
      }
    : {}),
});

const cleanup = () => rmSync(dir, { recursive: true, force: true });
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));

await import(new URL("../../api/src/main.ts", import.meta.url).href);
