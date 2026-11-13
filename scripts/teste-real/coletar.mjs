// Números do teste real, lidos do banco do teste (só leitura). Grava relatorio.json ao lado do banco.
// Uso: node scripts/teste-real/coletar.mjs [caminho/do/aurora.db]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const file = process.argv[2] ?? join(root, "apps/api/data/teste-real/aurora.db");
const db = new DatabaseSync(file, { readOnly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const secs = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);

// O Chief na conversa: quantas decisões pelo modelo e quantas caíram nas regras (e por quê).
const chief = { model: 0, rules: 0, fallbacks: {} };
for (const e of all("select detail from events where kind = 'chief_decision'")) {
  const d = json(e.detail) ?? {};
  if (d.engine === "model") chief.model++;
  else chief.rules++;
  if (d.fallback) chief.fallbacks[d.fallback] = (chief.fallbacks[d.fallback] ?? 0) + 1;
}

const plans = all("select id, version, status, created_at, decided_at, job_id from work_plans order by created_at").map((p) => ({
  ...p,
  specs: all("select agent_id, status, error from plan_specs where plan_id = ? order by version, agent_id", p.id),
}));

const jobs = all("select id, status, created_at, error from jobs order by ordinal").map((job) => {
  const receipts = all("select slot, state, output, usage, created_at, updated_at from inference_receipts where job_id = ? order by ordinal", job.id);
  const bySlot = {};
  const tokens = {};
  const steps = {};
  for (const r of receipts) {
    const kind = r.slot.split(":")[0];
    bySlot[kind] = (bySlot[kind] ?? 0) + 1;
    for (const [k, v] of Object.entries(json(r.usage) ?? {})) if (typeof v === "number") tokens[k] = (tokens[k] ?? 0) + v;
    const m = /^(step|review):(\d+):(\d+)$/.exec(r.slot);
    if (m) {
      const s = (steps[m[2]] ??= { attempts: 0, decisions: [] });
      if (m[1] === "step") s.attempts = Math.max(s.attempts, Number(m[3]) + 1); // tentativas começam em 0
      else s.decisions.push(json(r.output)?.decision ?? r.state);
    }
  }
  const last = receipts.at(-1)?.updated_at;
  return { id: job.id, status: job.status, error: job.error, model_calls: receipts.length, by_slot: bySlot, tokens, steps, seconds: secs(job.created_at, last) };
});

const report = { generated_at: new Date().toISOString(), database: file, chief, plans, jobs };
const out = join(dirname(file), "relatorio.json");
writeFileSync(out, JSON.stringify(report, null, 2));

console.log(`Chief: ${chief.model} decisões pelo modelo, ${chief.rules} pelas regras`, chief.fallbacks);
for (const p of plans) console.log(`Plano ${p.id.slice(0, 8)} v${p.version} ${p.status}; diretores: ${p.specs.map((s) => s.status).join(", ") || "—"}`);
for (const j of jobs) {
  console.log(`Trabalho ${j.id.slice(0, 8)} ${j.status}: ${j.model_calls} chamadas`, j.by_slot, j.seconds != null ? `${j.seconds}s` : "");
  for (const [i, s] of Object.entries(j.steps)) console.log(`  etapa ${Number(i) + 1}: ${s.attempts} tentativa(s), revisão: ${s.decisions.join(" → ")}`);
}
console.log(`\nRelatório: ${out}`);
