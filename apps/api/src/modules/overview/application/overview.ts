/**
 * Visão geral do Command Center: um modelo de leitura que agrega os módulos (sem escrever nada).
 *
 * - O que precisa de decisão: pareceres aguardando aprovação, entregas para revisar e casos na
 *   central de recuperação.
 * - O que está andando e o que deu errado (inclusive rotinas que desistiram).
 * - Consumo do modelo por dia (chamadas e tokens) e por uso: trabalhos, conversa e Cérebro, a
 *   partir da trilha de eventos — que já registra provedor, uso e por que o modelo não foi usado.
 * - Atividade recente.
 */
import type { Clock } from "../../../shared/clock.ts";
import type { Sql } from "../../../platform/database/database.ts";

export interface OverviewDeps {
  sql: Sql;
  clock: Clock;
  timeZone: string;
  /** Quantos dias o gráfico de consumo cobre. */
  days?: number;
}

type Count = { key: string; n: number | string };
type EventRow = { stream: string; kind: string; detail: string; occurred_at: string };

export type UsageArea = "work" | "chief" | "knowledge";

interface UsageDay {
  date: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

const counts = (rows: Count[]) => Object.fromEntries(rows.map((r) => [r.key, Number(r.n)])) as Record<string, number>;

/** Data local (AAAA-MM-DD) de um instante, no fuso da instalação. */
function localDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const tokens = (usage: unknown) => {
  const u = (usage ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  return { input: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"), output: n("output_tokens") };
};

/** Recusas do provedor que o gestor precisa ver (cota, CLI ausente, tempo esgotado). */
const PROVIDER_PROBLEMS = new Set(["quota_exhausted", "executable_unavailable", "timeout", "nonzero_exit", "provider_reported_error"]);

export async function overview(deps: OverviewDeps) {
  const { sql, timeZone } = deps;
  const now = new Date(deps.clock.now());
  const days = deps.days ?? 7;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const [jobs, deliverables, recentDone, team, sources, connections, routines, gaveUp] = await Promise.all([
    sql.all<Count>("SELECT status AS key, COUNT(*) AS n FROM jobs GROUP BY status"),
    sql.all<Count>("SELECT status AS key, COUNT(*) AS n FROM deliverables GROUP BY status"),
    sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'effect_receipt' AND occurred_at >= $1", [since]),
    sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'"),
    sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM knowledge_sources WHERE revoked_at IS NULL"),
    sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM connections WHERE status = 'active'"),
    sql.all<{ id: string; name: string; next_run_at: string }>(
      "SELECT id, name, next_run_at FROM routines WHERE enabled = 1 AND archived = 0 AND next_run_at IS NOT NULL ORDER BY next_run_at LIMIT 5",
    ),
    sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM routine_runs WHERE status = 'gave_up' AND updated_at >= $1", [since]),
  ]);
  const j = counts(jobs);
  const d = counts(deliverables);

  // Pendências com links, para a lista "Para decidir".
  const [approvals, reviews, recovery] = await Promise.all([
    sql.all<{ id: string; goal: string; created_at: string }>("SELECT id, goal, created_at FROM jobs WHERE status = 'awaiting_approval' ORDER BY ordinal DESC LIMIT 10"),
    sql.all<{ id: string; title: string; updated_at: string; current_version: number | string }>(
      "SELECT id, title, updated_at, current_version FROM deliverables WHERE status = 'in_review' ORDER BY updated_at DESC LIMIT 10",
    ),
    sql.all<{ id: string; goal: string; created_at: string }>("SELECT id, goal, created_at FROM jobs WHERE status = 'recovery_required' ORDER BY ordinal DESC LIMIT 10"),
  ]);

  // Consumo do modelo a partir da trilha.
  const usageEvents = await sql.all<EventRow>(
    `SELECT stream, kind, detail, occurred_at FROM events
      WHERE occurred_at >= $1 AND kind IN ('inference_completed', 'inference_failed', 'chief_decision', 'knowledge_query')`,
    [since],
  );
  const byDay = new Map<string, UsageDay>();
  for (let i = days - 1; i >= 0; i--) {
    const date = localDay(new Date(now.getTime() - i * 86_400_000).toISOString(), timeZone);
    byDay.set(date, { date, calls: 0, input_tokens: 0, output_tokens: 0 });
  }
  const byArea: Record<UsageArea, { calls: number; tokens: number; fallbacks: number }> = {
    work: { calls: 0, tokens: 0, fallbacks: 0 },
    chief: { calls: 0, tokens: 0, fallbacks: 0 },
    knowledge: { calls: 0, tokens: 0, fallbacks: 0 },
  };
  const problems = new Map<string, { code: string; count: number; last_at: string }>();
  const providers = new Set<string>();
  const noteProblem = (code: unknown, at: string) => {
    if (typeof code !== "string" || !PROVIDER_PROBLEMS.has(code)) return;
    const p = problems.get(code) ?? { code, count: 0, last_at: at };
    p.count++;
    if (at > p.last_at) p.last_at = at;
    problems.set(code, p);
  };
  for (const e of usageEvents) {
    const detail = JSON.parse(e.detail) as { engine?: string; usage?: unknown; provider?: string; fallback?: string; code?: string };
    const area: UsageArea = e.kind === "chief_decision" ? "chief" : e.kind === "knowledge_query" ? "knowledge" : "work";
    if (e.kind === "inference_failed") {
      noteProblem(detail.code, e.occurred_at);
      continue;
    }
    if (detail.fallback) {
      byArea[area].fallbacks++;
      noteProblem(detail.fallback, e.occurred_at);
    }
    const usedModel = e.kind === "inference_completed" || detail.engine === "model";
    if (!usedModel) continue;
    if (detail.provider) providers.add(detail.provider);
    const t = tokens(detail.usage);
    byArea[area].calls++;
    byArea[area].tokens += t.input + t.output;
    const day = byDay.get(localDay(e.occurred_at, timeZone));
    if (day) {
      day.calls++;
      day.input_tokens += t.input;
      day.output_tokens += t.output;
    }
  }

  // Atividade recente: o que o gestor reconhece como acontecimento.
  const activity = await sql.all<EventRow>(
    `SELECT stream, kind, detail, occurred_at FROM events
      WHERE kind IN ('admission', 'review_ready', 'human_approved', 'human_rejected', 'effect_receipt', 'deliverable_created',
                     'deliverable_revised', 'deliverable_accepted', 'deliverable_changes_requested', 'routine_fired', 'inference_unknown',
                     'knowledge_source_created', 'agent_hired', 'action_blocked', 'file_imported', 'deliverable_exported')
      ORDER BY seq DESC LIMIT 15`,
  );

  const attention = (j.failed ?? 0) + (j.interrupted ?? 0) + (j.recovery_required ?? 0) + Number(gaveUp?.n ?? 0);
  return {
    generated_at: now.toISOString(),
    time_zone: timeZone,
    days,
    kpis: {
      waiting_you: (j.awaiting_approval ?? 0) + (d.in_review ?? 0) + (j.recovery_required ?? 0),
      in_progress: (j.queued ?? 0) + (j.running ?? 0) + (d.changes_requested ?? 0),
      attention,
      delivered: Number(recentDone?.n ?? 0),
    },
    jobs: j,
    deliverables: d,
    company: { team: Number(team?.n ?? 0), sources: Number(sources?.n ?? 0), connections: Number(connections?.n ?? 0) },
    decide: {
      approvals: approvals.map((r) => ({ id: r.id, title: r.goal, at: r.created_at })),
      reviews: reviews.map((r) => ({ id: r.id, title: r.title, at: r.updated_at, version: Number(r.current_version) })),
      recovery: recovery.map((r) => ({ id: r.id, title: r.goal, at: r.created_at })),
    },
    routines: { next: routines, gave_up: Number(gaveUp?.n ?? 0) },
    usage: { days: [...byDay.values()], by_area: byArea, providers: [...providers], problems: [...problems.values()] },
    activity: activity.map((e) => ({ stream: e.stream, kind: e.kind, at: e.occurred_at, detail: JSON.parse(e.detail) as unknown })),
  };
}
