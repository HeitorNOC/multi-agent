export interface CatalogAgent {
  id: string;
  title: string;
  kind: "director" | "specialist";
  parent?: string | null;
}

export interface DelegatedTeam {
  lead: string;
  specialists: string[];
  reason: string;
}

interface JobEvent {
  seq: number;
  node: string;
  at: string;
  detail: {
    capability?: string | null;
    roster?: string[];
    assignments?: { agent: string; task: string }[];
    tests?: { passed: boolean };
    decision?: { action: string };
    requester?: string;
    status?: string;
    approved?: string[];
    assignees?: Record<string, string>;
    telemetry?: { worker_run_id?: string };
  };
}

interface JobActivity {
  id: string;
  goal: string;
  worker_active: boolean;
  events: JobEvent[];
  plan?: { capabilities: string[] } | null;
}

export type AgentStatus =
  | "available"
  | "selected"
  | "running"
  | "done"
  | "paused";

export const agentStatusLabel: Record<AgentStatus, string> = {
  available: "Disponível",
  selected: "Aguardando execução",
  running: "Em execução",
  done: "Concluído",
  paused: "Interrompido",
};

export interface AgentActivity {
  status: AgentStatus;
  action: string;
  milestones: number | null;
  elapsedMs: number | null;
  estimate: { remainingMs: number; samples: number } | null;
}

const stageByEvent: Record<string, { action: string; milestones: number }> = {
  specialist_started: { action: "Buscando fontes", milestones: 0 },
  director_started: { action: "Preparando a revisão da equipe", milestones: 0 },
  retrieval_completed: { action: "Contexto recuperado", milestones: 1 },
  canonical_evidence_verified: {
    action: "Fontes originais conferidas",
    milestones: 1,
  },
  inference_requested: {
    action: "Aguardando resposta do modelo",
    milestones: 1,
  },
  inference_completed: { action: "Registrando resultado", milestones: 2 },
  specialist_completed: {
    action: "Achados entregues à diretoria",
    milestones: 3,
  },
  director_completed: { action: "Parecer entregue ao Chief", milestones: 3 },
};

function measure(events: JobEvent[]) {
  const records = new Map<string, { start: JobEvent | null; last: JobEvent }>();
  const attempt = events.findLast((event) => event.node === "worker_started");
  for (const event of events) {
    const id = event.detail.capability;
    if (!id || !Object.hasOwn(stageByEvent, event.node)) continue;
    const record = records.get(id);
    if (record && Date.parse(event.at) < Date.parse(record.last.at)) continue;
    if (event.node.endsWith("_started")) {
      records.set(id, { start: event, last: event });
      continue;
    }
    const run = event.detail.telemetry?.worker_run_id;
    const previousRun = record?.last.detail.telemetry?.worker_run_id;
    if (record && (!run || !previousRun || run === previousRun)) {
      record.last = event;
    } else if (stageByEvent[event.node].milestones === 3) {
      records.set(id, { start: null, last: event });
    }
  }
  return { attempt, records };
}

function duration(start: JobEvent, endMs: number) {
  const ms = endMs - Date.parse(start.at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function engineeringBranches(events: JobEvent[]) {
  const branches = new Map<string, string[]>();
  for (const { node, detail } of events) {
    if (node !== "engineering_delegation" || detail.status !== "reviewed" || !detail.requester) continue;
    const agents = (detail.approved ?? []).flatMap((task) => {
      const agent = detail.assignees?.[task];
      return agent ? [agent] : [];
    });
    if (agents.length) branches.set(detail.requester, agents);
  }
  return branches;
}

function engineeringActivity(events: JobEvent[], active: boolean, now: number) {
  const roster = events.findLast((event) => event.node === "engineering_chief")?.detail.roster;
  if (!roster) return null;
  const assignments = events.findLast((event) => event.node === "engineering_assign")?.detail.assignments ?? [];
  const tests = events.findLast((event) => event.node === "engineering_qa");
  const review = events.findLast((event) => event.node === "engineering_review");
  const decision = events.findLast((event) => event.node === "engineering_director")?.detail.decision;
  const progress = new Map<string, AgentActivity>();
  for (const id of ["technology_director", ...roster]) {
    const assigned = id === "technology_director" || assignments.some((item) => item.agent === id);
    const done = assigned && (decision?.action === "human_review" ||
      (id === "tech_lead" && !!review) ||
      (["backend_engineer", "qa_engineer"].includes(id) && !!tests));
    progress.set(id, {
      status: done ? "done" : assigned ? "selected" : "available",
      action: done ? (id === "technology_director" ? "Entrega encaminhada à revisão humana" : "Subtarefa entregue e conferida")
        : assigned ? "Subtarefa atribuída pela diretora" : "Autorizado pelo Chief · reserva",
      milestones: done ? 3 : assigned ? 0 : null,
      elapsedMs: null,
      estimate: null,
    });
  }
  for (const [parent, agents] of engineeringBranches(events)) {
    for (const id of agents) {
      const entries = events.filter(({ node, detail }) =>
        node === "engineering_delegation" && detail.requester === parent && detail.capability === id,
      );
      const start = entries.find(({ detail }) => detail.status === "started");
      const end = entries.find(({ detail }) => detail.status === "completed");
      progress.set(id, {
        status: end ? "done" : start ? (active ? "running" : "paused") : "selected",
        action: end ? "Entrega consolidada" : start ? "Subtarefa iniciada" : "Aprovado pelo Chief",
        milestones: end ? 3 : start ? 1 : 0,
        elapsedMs: start && (end || active) ? duration(start, end ? Date.parse(end.at) : now) : null,
        estimate: null,
      });
    }
  }
  return progress;
}

export function describeAgents(
  catalog: CatalogAgent[],
  jobs: JobActivity[],
  job: JobActivity | undefined,
  now: number,
) {
  const { attempt, records } = measure(job?.events ?? []);
  const history = new Map<string, number[]>();
  const selected = new Set(job?.plan?.capabilities);
  const engineering = engineeringActivity(job?.events ?? [], job?.worker_active ?? false, now);

  if (job?.worker_active) {
    for (const past of jobs) {
      if (past.id === job.id || past.goal !== job.goal) continue;
      for (const [id, { start, last }] of measure(past.events).records) {
        if (!start || stageByEvent[last.node].milestones !== 3) continue;
        const ms = duration(start, Date.parse(last.at));
        if (ms === null) continue;
        const samples = history.get(id) ?? [];
        if (samples.length < 10) samples.push(ms);
        history.set(id, samples);
      }
    }
  }

  return new Map(
    catalog.map(({ id }): [string, AgentActivity] => {
      const engineeringAgent = engineering?.get(id);
      if (engineeringAgent) return [id, engineeringAgent];
      const record = records.get(id);
      if (!record) {
        const assigned = selected.has(id);
        return [
          id,
          {
            status: assigned ? "selected" : "available",
            action: assigned
              ? "Designado pelo Chief"
              : "Sem participação neste trabalho",
            milestones: assigned ? 0 : null,
            elapsedMs: null,
            estimate: null,
          },
        ];
      }
      const { start, last } = record;
      const stage = stageByEvent[last.node];
      const done = stage.milestones === 3;
      const running =
        !done &&
        Boolean(
          job?.worker_active &&
            attempt &&
            start &&
            start.seq > attempt.seq &&
            Date.parse(start.at) >= Date.parse(attempt.at),
        );
      const elapsedMs = start
        ? duration(start, running ? now : Date.parse(last.at))
        : null;
      const samples = history.get(id) ?? [];
      samples.sort((a, b) => a - b);
      const middle = Math.floor(samples.length / 2);
      const typical =
        samples.length % 2
          ? samples[middle]
          : (samples[middle - 1] + samples[middle]) / 2;
      return [
        id,
        {
          status: done ? "done" : running ? "running" : "paused",
          action: stage.action,
          milestones: stage.milestones,
          elapsedMs,
          estimate:
            running && elapsedMs !== null && samples.length >= 3
              ? { remainingMs: typical - elapsedMs, samples: samples.length }
              : null,
        },
      ];
    }),
  );
}
