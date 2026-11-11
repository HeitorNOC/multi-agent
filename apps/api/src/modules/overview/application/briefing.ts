/**
 * Situação da empresa para o Chief of Staff (e o Jarvis): o que espera o gestor, o que está
 * andando e quem do time trabalha agora. Modelo de leitura, sem escrita, listas curtas.
 */
import type { CompanyBriefing } from "../../conversations/domain/chief-of-staff.ts";
import { agentActivity, type AgentActivityDeps } from "./agent-activity.ts";

const LIMIT = 5;

export async function companyBriefing(deps: AgentActivityDeps): Promise<CompanyBriefing> {
  const { sql, clock } = deps;
  const since = new Date(Date.parse(clock.now()) - 7 * 86_400_000).toISOString();
  const [approvals, reviews, recovery, running, gaveUp, activity, plans] = await Promise.all([
    sql.all<{ id: string; goal: string }>(`SELECT id, goal FROM jobs WHERE status = 'awaiting_approval' ORDER BY ordinal DESC LIMIT ${LIMIT}`),
    sql.all<{ id: string; title: string }>(`SELECT id, title FROM deliverables WHERE status = 'in_review' ORDER BY updated_at DESC LIMIT ${LIMIT}`),
    sql.all<{ id: string; goal: string }>(`SELECT id, goal FROM jobs WHERE status = 'recovery_required' ORDER BY ordinal DESC LIMIT ${LIMIT}`),
    sql.all<{ id: string; goal: string; plan: unknown }>(`SELECT id, goal, plan FROM jobs WHERE status IN ('queued', 'running') ORDER BY ordinal DESC LIMIT ${LIMIT}`),
    sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM routine_runs WHERE status = 'gave_up' AND updated_at >= $1", [since]),
    agentActivity(deps),
    sql.all<{ id: string; brief: string }>(`SELECT id, brief FROM work_plans WHERE status = 'proposed' ORDER BY updated_at DESC LIMIT ${LIMIT}`),
  ]);
  const names = new Map(activity.agents.map((a) => [a.id, a.name]));
  const planAgents = (plan: unknown): string[] => {
    const p = typeof plan === "string" ? (JSON.parse(plan) as { agents?: unknown }) : (plan as { agents?: unknown } | null);
    return Array.isArray(p?.agents) ? p.agents.filter((a): a is string => typeof a === "string") : [];
  };
  return {
    approvals,
    plans: plans.map((p) => ({ id: p.id, objective: (JSON.parse(p.brief) as { objective: string }).objective })),
    reviews,
    recovery,
    running: running.map((j) => ({ id: j.id, goal: j.goal, agents: planAgents(j.plan).map((a) => names.get(a) ?? a) })),
    team: {
      working: activity.agents.filter((a) => a.status === "running" || a.status === "assigned").map((a) => `${a.name} · ${a.title}`),
      size: activity.agents.length,
    },
    routines_gave_up: Number(gaveUp?.n ?? 0),
  };
}
