/** Repositórios SQL das rotinas (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { ActorId, JobId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { RoutineRepository, RunRepository } from "../domain/repositories.ts";
import type { Routine, RoutineId, RoutineRun, RunStatus } from "../domain/routine.ts";
import type { Schedule } from "../domain/schedule.ts";

type RoutineRow = {
  id: string;
  name: string;
  goal: string;
  schedule: string;
  enabled: number | string;
  archived: number | string;
  next_run_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type RunRow = {
  routine_id: string;
  slot: string;
  origin: string;
  status: string;
  job_id: string | null;
  attempts: number | string;
  next_attempt_at: string | null;
  last_error: string | null;
  missed: number | string;
  created_at: string;
  updated_at: string;
};

const toRoutine = (r: RoutineRow): Routine => ({
  id: r.id as RoutineId,
  name: r.name,
  goal: r.goal,
  schedule: JSON.parse(r.schedule) as Schedule,
  enabled: Number(r.enabled) === 1,
  archived: Number(r.archived) === 1,
  nextRunAt: r.next_run_at,
  createdBy: r.created_by as ActorId,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toRun = (r: RunRow): RoutineRun => ({
  routineId: r.routine_id as RoutineId,
  slot: r.slot,
  trigger: r.origin as RoutineRun["trigger"],
  status: r.status as RunStatus,
  jobId: r.job_id as JobId | null,
  attempts: Number(r.attempts),
  nextAttemptAt: r.next_attempt_at,
  lastError: r.last_error,
  missed: Number(r.missed),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SqlRoutineRepository implements RoutineRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: RoutineId) {
    const row = await this.sql.one<RoutineRow>("SELECT * FROM routines WHERE id = $1", [id]);
    return row && toRoutine(row);
  }

  async add(r: Routine) {
    await this.sql.run(
      `INSERT INTO routines (id, name, goal, schedule, enabled, archived, next_run_at, created_by, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM routines))`,
      [r.id, r.name, r.goal, JSON.stringify(r.schedule), r.enabled ? 1 : 0, r.archived ? 1 : 0, r.nextRunAt, r.createdBy, r.createdAt, r.updatedAt],
    );
  }

  async save(r: Routine) {
    await this.sql.run(
      "UPDATE routines SET name = $2, goal = $3, schedule = $4, enabled = $5, archived = $6, next_run_at = $7, updated_at = $8 WHERE id = $1",
      [r.id, r.name, r.goal, JSON.stringify(r.schedule), r.enabled ? 1 : 0, r.archived ? 1 : 0, r.nextRunAt, r.updatedAt],
    );
  }

  async list() {
    return (await this.sql.all<RoutineRow>("SELECT * FROM routines WHERE archived = 0 ORDER BY ordinal")).map(toRoutine);
  }

  async due(now: string) {
    const rows = await this.sql.all<RoutineRow>(
      "SELECT * FROM routines WHERE enabled = 1 AND archived = 0 AND next_run_at IS NOT NULL AND next_run_at <= $1 ORDER BY next_run_at",
      [now],
    );
    return rows.map(toRoutine);
  }
}

export class SqlRunRepository implements RunRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(routineId: RoutineId, slot: string) {
    const row = await this.sql.one<RunRow>("SELECT * FROM routine_runs WHERE routine_id = $1 AND slot = $2", [routineId, slot]);
    return row && toRun(row);
  }

  async add(r: RoutineRun) {
    await this.sql.run(
      `INSERT INTO routine_runs (routine_id, slot, origin, status, job_id, attempts, next_attempt_at, last_error, missed, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [r.routineId, r.slot, r.trigger, r.status, r.jobId, r.attempts, r.nextAttemptAt, r.lastError, r.missed, r.createdAt, r.updatedAt],
    );
  }

  async save(r: RoutineRun) {
    await this.sql.run(
      "UPDATE routine_runs SET status = $3, job_id = $4, attempts = $5, next_attempt_at = $6, last_error = $7, updated_at = $8 WHERE routine_id = $1 AND slot = $2",
      [r.routineId, r.slot, r.status, r.jobId, r.attempts, r.nextAttemptAt, r.lastError, r.updatedAt],
    );
  }

  async list(routineId: RoutineId, limit = 50) {
    const rows = await this.sql.all<RunRow>("SELECT * FROM routine_runs WHERE routine_id = $1 ORDER BY slot DESC LIMIT $2", [routineId, limit]);
    return rows.map(toRun);
  }

  async retryDue(now: string) {
    const rows = await this.sql.all<RunRow>("SELECT * FROM routine_runs WHERE status = 'retrying' AND next_attempt_at <= $1 ORDER BY next_attempt_at", [now]);
    return rows.map(toRun);
  }
}

export interface RoutinesStore {
  routines: RoutineRepository;
  runs: RunRepository;
  events: EventLog;
}

export const routinesStore =
  (clock: Clock) =>
  (sql: Sql): RoutinesStore => ({ routines: new SqlRoutineRepository(sql), runs: new SqlRunRepository(sql), events: new SqlEventLog(sql, clock) });
