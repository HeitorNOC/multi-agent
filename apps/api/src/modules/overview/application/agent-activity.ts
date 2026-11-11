/**
 * Lista operacional dos agentes (como na v1): para cada agente do time, o que está fazendo agora,
 * em qual trabalho, quantos marcos já cumpriu e há quanto tempo.
 *
 * Modelo de leitura, sem tabela própria. Junta o plano de cada trabalho (quem o Chief designou)
 * com os recibos de chamada ao modelo (`specialist:<id>` reservado = pesquisando; completo =
 * achados entregues). Marcos de cada especialista: designado → pesquisa iniciada → achados
 * entregues. Os do Chief: plano → especialistas → parecer.
 *
 * Tempo restante: mediana de pelo menos três participações anteriores concluídas do mesmo
 * agente, menos o tempo já decorrido. Com menos histórico, não estima.
 */
import type { Clock } from "../../../shared/clock.ts";
import type { Sql } from "../../../platform/database/database.ts";

export interface AgentActivityDeps {
  sql: Sql;
  clock: Clock;
}

export type ActivityStatus = "idle" | "assigned" | "running" | "waiting" | "done" | "blocked";

export interface ActivityJob {
  id: string;
  goal: string;
  status: string;
}

export interface AgentActivity {
  id: string;
  name: string;
  title: string;
  area: string;
  reports_to: string | null;
  status: ActivityStatus;
  activity: string;
  job: ActivityJob | null;
  milestones: { done: number; total: number };
  started_at: string | null;
  elapsed_ms: number | null;
  remaining_ms: number | null;
}

export interface ChiefActivity {
  status: ActivityStatus;
  activity: string;
  job: ActivityJob | null;
  milestones: { done: number; total: number };
}

/** Quantos trabalhos recentes entram na conta. */
const RECENT_JOBS = 60;
/** Participação concluída aparece como "concluiu" por este tempo. */
const DONE_WINDOW_MS = 24 * 3600_000;
/** Mínimo de participações anteriores para estimar o tempo restante. */
const MIN_HISTORY = 3;

const ACTIVE = new Set(["queued", "running"]);
const STUCK = new Set(["failed", "interrupted", "recovery_required"]);
const ENDED = new Set(["rejected", "closed_unknown"]);

type JobRow = { id: string; goal: string; status: string; plan: unknown; created_at: string };
type ReceiptRow = { job_id: string; slot: string; state: string; output?: unknown; created_at: string; updated_at: string };

/** Decisão gravada numa revisão de etapa (texto JSON no SQLite, objeto no PostgreSQL). */
const decisionOf = (output: unknown) => {
  const o = typeof output === "string" ? (JSON.parse(output) as { decision?: unknown }) : (output as { decision?: unknown } | null);
  return o?.decision;
};

type Step = { title: string; owner: string; reviewer: string };
const planSteps = (plan: unknown): Step[] | null => {
  const p = typeof plan === "string" ? (JSON.parse(plan) as unknown) : plan;
  const steps = (p as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps) ? (steps as Step[]) : null;
};

/**
 * Trabalho em etapas (N3): quem está entregando ou revisando qual etapa. Marcos: designado →
 * trabalhando numa etapa → todas as suas etapas aceitas.
 */
function stepActivity(agentId: string, job: JobRow, steps: Step[], receipts: ReceiptRow[], now: number) {
  const mine = steps.map((s, i) => ({ s, i })).filter((x) => x.s.owner === agentId || x.s.reviewer === agentId);
  if (!mine.length) return null;
  const ofJob = receipts.filter((r) => r.job_id === job.id);
  const accepted = (i: number) => ofJob.some((r) => r.slot.startsWith(`review:${i}:`) && r.state === "completed" && decisionOf(r.output) === "accept");
  for (const { s, i } of mine) {
    const prefix = s.owner === agentId ? "step" : "review";
    const live = ofJob.find((r) => r.slot.startsWith(`${prefix}:${i}:`) && r.state === "reserved");
    if (live)
      return {
        status: "running" as const,
        activity: `${prefix === "step" ? "Trabalhando na" : "Revisando a"} etapa ${i + 1}: ${s.title}`,
        milestones: { done: 2, total: 3 },
        started_at: live.created_at,
        elapsed_ms: now - Date.parse(live.created_at),
      };
  }
  const owned = mine.filter((x) => x.s.owner === agentId);
  if (owned.length && owned.every((x) => accepted(x.i)))
    return { status: (job.status === "awaiting_approval" ? "waiting" : "done") as "waiting" | "done", activity: `Etapa(s) ${owned.map((x) => x.i + 1).join(", ")} aceita(s) na revisão`, milestones: { done: 3, total: 3 }, started_at: null, elapsed_ms: null };
  const next = owned.find((x) => !accepted(x.i)) ?? mine[0]!;
  if (STUCK.has(job.status)) return { status: "blocked" as const, activity: `Trabalho parado na etapa ${next.i + 1}`, milestones: { done: 1, total: 3 }, started_at: null, elapsed_ms: null };
  return { status: "assigned" as const, activity: `Na fila: etapa ${next.i + 1} — ${next.s.title}`, milestones: { done: 1, total: 3 }, started_at: null, elapsed_ms: null };
}

const planAgents = (plan: unknown): string[] => {
  const p = typeof plan === "string" ? (JSON.parse(plan) as unknown) : plan;
  const agents = (p as { agents?: unknown } | null)?.agents;
  return Array.isArray(agents) ? agents.filter((a): a is string => typeof a === "string") : [];
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Qual trabalho importa agora para quem participou de vários: andando > travado > aguardando > concluído recente. */
function rank(status: string, createdAt: string, now: number) {
  if (ACTIVE.has(status)) return 4;
  if (STUCK.has(status)) return 3;
  if (status === "awaiting_approval") return 2;
  if (status === "completed" && now - Date.parse(createdAt) < DONE_WINDOW_MS) return 1;
  return 0;
}

export async function agentActivity(deps: AgentActivityDeps): Promise<{ chief: ChiefActivity; agents: AgentActivity[] }> {
  const now = Date.parse(deps.clock.now());
  const [team, jobs, history] = await Promise.all([
    deps.sql.all<{ id: string; name: string; title: string; area: string; reports_to: string | null }>(
      "SELECT id, name, title, area, reports_to FROM agents WHERE status = 'active' ORDER BY ordinal",
    ),
    deps.sql.all<JobRow>(`SELECT id, goal, status, plan, created_at FROM jobs ORDER BY ordinal DESC LIMIT ${RECENT_JOBS}`),
    deps.sql.all<ReceiptRow>(
      "SELECT job_id, slot, state, created_at, updated_at FROM inference_receipts WHERE state = 'completed' AND slot LIKE 'specialist:%' ORDER BY ordinal DESC LIMIT 1000",
    ),
  ]);
  const ids = jobs.map((j) => j.id);
  const receipts = ids.length
    ? await deps.sql.all<ReceiptRow>(
        `SELECT job_id, slot, state, output, created_at, updated_at FROM inference_receipts WHERE job_id IN (${ids.map((_, i) => `$${i + 1}`).join(", ")})`,
        ids,
      )
    : [];
  const receipt = new Map(receipts.map((r) => [`${r.job_id}|${r.slot}`, r]));
  const durations = new Map<string, number[]>();
  for (const r of history) {
    const list = durations.get(r.slot) ?? [];
    list.push(Date.parse(r.updated_at) - Date.parse(r.created_at));
    durations.set(r.slot, list);
  }

  // Para cada agente, o trabalho mais relevante entre os recentes em que foi designado.
  const current = new Map<string, JobRow>();
  for (const j of jobs) {
    const r = rank(j.status, j.created_at, now);
    if (r === 0) continue;
    for (const a of planAgents(j.plan)) {
      const prev = current.get(a);
      if (!prev || rank(prev.status, prev.created_at, now) < r) current.set(a, j);
    }
  }

  const agents = team.map((a): AgentActivity => {
    const base = { id: a.id, name: a.name, title: a.title, area: a.area, reports_to: a.reports_to };
    const j = current.get(a.id);
    if (!j) return { ...base, status: "idle", activity: "Sem participação em trabalhos agora", job: null, milestones: { done: 0, total: 3 }, started_at: null, elapsed_ms: null, remaining_ms: null };
    const job = { id: j.id, goal: j.goal, status: j.status };
    const steps = planSteps(j.plan);
    if (steps) {
      const st = stepActivity(a.id, j, steps, receipts, now);
      if (st) return { ...base, job, remaining_ms: null, ...st };
    }
    const r = receipt.get(`${j.id}|specialist:${a.id}`);
    const elapsed = r ? (r.state === "completed" ? Date.parse(r.updated_at) : now) - Date.parse(r.created_at) : null;
    // Só estima enquanto pesquisa; a participação atual ainda não está no histórico (não concluiu).
    const past = (durations.get(`specialist:${a.id}`) ?? []).slice(0, 50);
    const remaining = r?.state === "reserved" && past.length >= MIN_HISTORY ? Math.max(0, median(past) - elapsed!) : null;
    const timing = { started_at: r?.created_at ?? null, elapsed_ms: elapsed, remaining_ms: remaining };
    if (r?.state === "completed") {
      const waiting = j.status === "awaiting_approval";
      return { ...base, ...timing, job, status: waiting ? "waiting" : "done", activity: waiting ? "Achados entregues · o parecer aguarda você" : "Achados entregues ao Chief of Staff", milestones: { done: 3, total: 3 } };
    }
    if (r) {
      if (STUCK.has(j.status)) return { ...base, ...timing, job, status: "blocked", activity: "Pesquisa interrompida · veja o trabalho", milestones: { done: 1, total: 3 } };
      return { ...base, ...timing, job, status: "running", activity: "Pesquisando no Cérebro e redigindo os achados", milestones: { done: 2, total: 3 } };
    }
    if (STUCK.has(j.status)) return { ...base, ...timing, job, status: "blocked", activity: "Trabalho parado antes da sua vez", milestones: { done: 1, total: 3 } };
    if (ENDED.has(j.status) || j.status === "completed" || j.status === "awaiting_approval")
      return { ...base, ...timing, job, status: "done", activity: "Designado, sem achados neste trabalho", milestones: { done: 1, total: 3 } };
    return { ...base, ...timing, job, status: "assigned", activity: "Designado pelo Chief of Staff · na fila", milestones: { done: 1, total: 3 } };
  });

  return { chief: chiefActivity(jobs, receipt, now), agents };
}

function chiefActivity(jobs: JobRow[], receipt: Map<string, ReceiptRow>, now: number): ChiefActivity {
  const j = [...jobs].sort((a, b) => rank(b.status, b.created_at, now) - rank(a.status, a.created_at, now))[0];
  if (!j || rank(j.status, j.created_at, now) === 0) return { status: "idle", activity: "Pronto para um novo pedido", job: null, milestones: { done: 0, total: 3 } };
  const job = { id: j.id, goal: j.goal, status: j.status };
  const agents = planAgents(j.plan);
  const delivered = agents.filter((a) => receipt.get(`${j.id}|specialist:${a}`)?.state === "completed").length;
  const plan = receipt.get(`${j.id}|plan`);
  const synthesis = receipt.get(`${j.id}|synthesis`);
  const done = (plan?.state === "completed" || agents.length ? 1 : 0) + (agents.length && delivered === agents.length ? 1 : 0) + (synthesis?.state === "completed" ? 1 : 0);
  const milestones = { done, total: 3 };
  if (j.status === "awaiting_approval") return { status: "waiting", activity: "Parecer pronto · aguardando sua aprovação", job, milestones };
  if (j.status === "completed") return { status: "done", activity: "Entregou o último trabalho", job, milestones };
  if (STUCK.has(j.status)) return { status: "blocked", activity: "Trabalho parado · veja a recuperação", job, milestones };
  if (j.status === "queued") return { status: "assigned", activity: "Pedido na fila", job, milestones };
  if (!agents.length) return { status: "running", activity: "Montando o plano e escolhendo os especialistas", job, milestones };
  if (synthesis) return { status: "running", activity: "Consolidando os achados no parecer", job, milestones };
  return { status: "running", activity: `Coordenando ${agents.length} especialista(s) · ${delivered} entregue(s)`, job, milestones };
}
