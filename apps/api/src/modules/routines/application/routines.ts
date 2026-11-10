/**
 * Casos de uso das rotinas e o disparo dos horários (`tick`).
 *
 * `tick` é idempotente e seguro de rodar de novo a qualquer momento (inclusive logo depois de um
 * reinício): um horário só vira trabalho se ainda não tiver execução, e a execução é gravada na
 * mesma transação da admissão.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { AppError, ensure, notFound } from "../../../shared/errors.ts";
import type { ActorId, JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { JobStatus } from "../../jobs/domain/job.ts";
import type { RoutinesStore } from "../infrastructure/sql-routines.ts";
import { afterFailure, validateRoutineText, type Routine, type RoutineId, type RoutineRun } from "../domain/routine.ts";
import { describeSchedule, nextRun, parseSchedule, upcomingRuns, type Schedule } from "../domain/schedule.ts";

/** Admite o trabalho; `onAdmitted` roda na transação da admissão. Recusas esperadas lançam `AppError`. */
export type AdmitRoutineJob = (goal: string, onAdmitted: (jobId: JobId, tx: Transaction) => Promise<void>) => Promise<JobId>;

export interface RoutinesDeps {
  uow: UnitOfWork<RoutinesStore>;
  clock: Clock;
  /** Fuso da instalação (IANA), usado nos horários de parede. */
  timeZone: string;
  admit: AdmitRoutineJob;
  jobStatus(jobId: JobId): Promise<JobStatus | undefined>;
}

const ALL = stream.routines("all");
/** Teto de horários percorridos ao recuperar uma parada longa (só o mais recente dispara). */
const MAX_CATCH_UP = 100_000;
/** Recusas que a rotina trata com nova tentativa; o resto é falha real e sobe. */
const isRefusal = (e: unknown): e is AppError => e instanceof AppError && (e.kind === "invalid" || e.kind === "rate_limited" || e.kind === "conflict");

export interface RoutineInput {
  name: string;
  goal: string;
  schedule: Schedule;
  enabled?: boolean;
}

export async function createRoutine(deps: RoutinesDeps, actor: ActorId, input: RoutineInput) {
  const { name, goal } = validateRoutineText(input.name, input.goal);
  const schedule = parseSchedule(input.schedule);
  const now = deps.clock.now();
  const enabled = input.enabled ?? true;
  const routine: Routine = {
    id: randomUUID() as RoutineId,
    name,
    goal,
    schedule,
    enabled,
    archived: false,
    nextRunAt: enabled ? nextRun(schedule, new Date(now), deps.timeZone).toISOString() : null,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };
  await deps.uow.run(async (s) => {
    await s.routines.add(routine);
    await s.events.append(ALL, { kind: "routine_created", detail: { routine: routine.id, actor } });
  });
  return viewRoutine(deps, routine.id);
}

export async function changeRoutine(deps: RoutinesDeps, actor: ActorId, id: RoutineId, changes: Partial<RoutineInput>) {
  await deps.uow.run(async (s) => {
    const current = await load(s, id);
    const text = validateRoutineText(changes.name ?? current.name, changes.goal ?? current.goal);
    const schedule = changes.schedule ? parseSchedule(changes.schedule) : current.schedule;
    const enabled = changes.enabled ?? current.enabled;
    const now = deps.clock.now();
    // Agenda nova ou reativação: o próximo horário conta a partir de agora (nada atrasado dispara).
    const reschedule = !!changes.schedule || (enabled && !current.enabled);
    const nextRunAt = !enabled ? null : reschedule || !current.nextRunAt ? nextRun(schedule, new Date(now), deps.timeZone).toISOString() : current.nextRunAt;
    await s.routines.save({ ...current, ...text, schedule, enabled, nextRunAt, updatedAt: now });
    await s.events.append(ALL, { kind: "routine_updated", detail: { routine: id, actor, fields: Object.keys(changes) } as Json });
  });
  return viewRoutine(deps, id);
}

export async function archiveRoutine(deps: RoutinesDeps, actor: ActorId, id: RoutineId) {
  await deps.uow.run(async (s) => {
    const current = await load(s, id);
    if (current.archived) return;
    await s.routines.save({ ...current, archived: true, enabled: false, nextRunAt: null, updatedAt: deps.clock.now() });
    await s.events.append(ALL, { kind: "routine_archived", detail: { routine: id, actor } });
  });
  return { archived: true };
}

/** Dispara agora, fora da agenda. A agenda continua igual. */
export async function runNow(deps: RoutinesDeps, actor: ActorId, id: RoutineId) {
  const routine = await load(deps.uow.read, id);
  ensure(!routine.archived, () => notFound("routine_not_found", "Rotina não encontrada"));
  const { run } = await fire(deps, routine, deps.clock.now(), "manual", 0);
  await deps.uow.run((s) => s.events.append(ALL, { kind: "routine_run_now", detail: { routine: id, actor } }));
  return runView(deps, run);
}

/**
 * Uma rodada do agendador: dispara o horário vencido mais recente de cada rotina ativa, avança a
 * agenda e refaz as tentativas vencidas. Devolve quantos trabalhos foram admitidos.
 */
export async function tick(deps: RoutinesDeps): Promise<{ admitted: number; retried: number }> {
  const now = new Date(deps.clock.now());
  let admitted = 0;
  let retried = 0;
  for (const routine of await deps.uow.read.routines.due(now.toISOString())) {
    let slot = new Date(routine.nextRunAt!);
    let missed = 0;
    for (let next = nextRun(routine.schedule, slot, deps.timeZone); next <= now && missed < MAX_CATCH_UP; next = nextRun(routine.schedule, slot, deps.timeZone)) {
      slot = next;
      missed++;
    }
    const { run, fresh } = await fire(deps, routine, slot.toISOString(), "schedule", missed);
    if (fresh && run.status === "admitted") admitted++;
    await deps.uow.run(async (s) => {
      const current = await s.routines.get(routine.id);
      // Só avança se ninguém mudou a rotina nesse meio-tempo.
      if (current && current.enabled && current.nextRunAt === routine.nextRunAt)
        await s.routines.save({ ...current, nextRunAt: nextRun(current.schedule, now, deps.timeZone).toISOString(), updatedAt: now.toISOString() });
    });
  }
  for (const run of await deps.uow.read.runs.retryDue(now.toISOString())) {
    await retry(deps, run);
    retried++;
  }
  return { admitted, retried };
}

/**
 * Cria a execução do horário e admite o trabalho, juntos. Se o horário já tiver execução, devolve-a
 * com `fresh: false` (é o que impede duplicar depois de um reinício).
 */
async function fire(deps: RoutinesDeps, routine: Routine, slot: string, trigger: RoutineRun["trigger"], missed: number): Promise<{ run: RoutineRun; fresh: boolean }> {
  const existing = await deps.uow.read.runs.get(routine.id, slot);
  if (existing) return { run: existing, fresh: false };
  const now = deps.clock.now();
  const base: RoutineRun = { routineId: routine.id, slot, trigger, status: "admitted", jobId: null, attempts: 1, nextAttemptAt: null, lastError: null, missed, createdAt: now, updatedAt: now };
  try {
    let run = base;
    await deps.admit(routine.goal, async (jobId, tx) => {
      const s = deps.uow.join(tx);
      // Outra rodada pode ter disparado este horário entre a leitura acima e esta transação;
      // aqui dentro a conferência é definitiva (as transações são serializadas). Abortar desfaz o trabalho.
      if (await s.runs.get(routine.id, slot)) throw new AppError("conflict", "slot_already_fired", "Horário já disparado");
      run = { ...base, jobId };
      await s.runs.add(run);
      await s.events.append(stream.routines(routine.id), { kind: "routine_fired", detail: { slot, trigger, job: jobId, missed } });
    });
    return { run, fresh: true };
  } catch (error) {
    if (!isRefusal(error)) throw error;
    // A admissão não aconteceu: registra a execução para tentar de novo, sem trabalho.
    return deps.uow.run(async (s) => {
      const raced = await s.runs.get(routine.id, slot);
      if (raced) return { run: raced, fresh: false };
      const run: RoutineRun = { ...base, ...afterFailure({ attempts: 0 }, error.message, new Date(now)) };
      await s.runs.add(run);
      await s.events.append(stream.routines(routine.id), { kind: "routine_refused", detail: { slot, reason: error.code, attempts: run.attempts } });
      return { run, fresh: true };
    });
  }
}

async function retry(deps: RoutinesDeps, run: RoutineRun) {
  const routine = await deps.uow.read.routines.get(run.routineId);
  const now = deps.clock.now();
  if (!routine || !routine.enabled || routine.archived) {
    await deps.uow.run((s) => s.runs.save({ ...run, status: "gave_up", nextAttemptAt: null, lastError: "Rotina pausada ou arquivada", updatedAt: now }));
    return;
  }
  try {
    await deps.admit(routine.goal, async (jobId, tx) => {
      const s = deps.uow.join(tx);
      const current = await s.runs.get(run.routineId, run.slot);
      // Outra rodada já resolveu esta execução: aborta a admissão.
      if (!current || current.status !== "retrying") throw new AppError("conflict", "run_already_handled", "Execução já tratada");
      await s.runs.save({ ...current, status: "admitted", jobId, attempts: current.attempts + 1, nextAttemptAt: null, updatedAt: now });
      await s.events.append(stream.routines(run.routineId), { kind: "routine_fired", detail: { slot: run.slot, trigger: run.trigger, job: jobId, attempt: current.attempts + 1 } });
    });
  } catch (error) {
    if (!isRefusal(error)) throw error;
    if (error.code === "run_already_handled") return;
    await deps.uow.run(async (s) => {
      const current = await s.runs.get(run.routineId, run.slot);
      if (!current || current.status !== "retrying") return;
      await s.runs.save({ ...current, ...afterFailure(current, error.message, new Date(now)), updatedAt: now });
      await s.events.append(stream.routines(run.routineId), { kind: "routine_refused", detail: { slot: run.slot, reason: error.code, attempts: current.attempts + 1 } });
    });
  }
}

async function load(s: RoutinesStore, id: RoutineId) {
  const r = await s.routines.get(id);
  ensure(r, () => notFound("routine_not_found", "Rotina não encontrada"));
  return r;
}

async function runView(deps: RoutinesDeps, r: RoutineRun) {
  return {
    slot: r.slot,
    trigger: r.trigger,
    status: r.status,
    job_id: r.jobId,
    job_status: r.jobId ? ((await deps.jobStatus(r.jobId)) ?? null) : null,
    attempts: r.attempts,
    next_attempt_at: r.nextAttemptAt,
    last_error: r.lastError,
    missed: r.missed,
    created_at: r.createdAt,
  };
}

function summary(deps: RoutinesDeps, r: Routine) {
  return {
    id: r.id,
    name: r.name,
    goal: r.goal,
    schedule: r.schedule,
    schedule_label: describeSchedule(r.schedule),
    enabled: r.enabled,
    next_run_at: r.nextRunAt,
    upcoming: r.enabled ? upcomingRuns(r.schedule, new Date(deps.clock.now()), deps.timeZone).map((d) => d.toISOString()) : [],
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export async function listRoutines(deps: RoutinesDeps) {
  const routines = await deps.uow.read.routines.list();
  return {
    time_zone: deps.timeZone,
    routines: await Promise.all(
      routines.map(async (r) => {
        const [last] = await deps.uow.read.runs.list(r.id, 1);
        return { ...summary(deps, r), last_run: last ? await runView(deps, last) : null };
      }),
    ),
  };
}

export async function viewRoutine(deps: RoutinesDeps, id: RoutineId) {
  const r = await load(deps.uow.read, id);
  ensure(!r.archived, () => notFound("routine_not_found", "Rotina não encontrada"));
  const runs = await deps.uow.read.runs.list(id);
  return { ...summary(deps, r), time_zone: deps.timeZone, runs: await Promise.all(runs.map((run) => runView(deps, run))) };
}
