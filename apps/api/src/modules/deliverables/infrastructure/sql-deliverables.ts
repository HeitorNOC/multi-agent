/** Repositórios SQL das entregas (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { ActorId, JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Deliverable, DeliverableId, DeliverableStatus } from "../domain/deliverable.ts";
import type { DeliverableRepository, DeliverableVersion, Reopening } from "../domain/repositories.ts";

type DeliverableRow = {
  id: string;
  title: string;
  status: string;
  current_version: number | string;
  created_at: string;
  updated_at: string;
  decided_by: string | null;
  decision_note: string | null;
};
type VersionRow = { deliverable_id: string; version: number | string; job_id: string; content: string; created_at: string };
type ReopeningRow = { job_id: string; deliverable_id: string; from_version: number | string; feedback: string; requested_by: string; created_at: string };

const toDeliverable = (r: DeliverableRow): Deliverable => ({
  id: r.id as DeliverableId,
  title: r.title,
  status: r.status as DeliverableStatus,
  currentVersion: Number(r.current_version),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  decidedBy: r.decided_by as ActorId | null,
  decisionNote: r.decision_note,
});
const toVersion = (r: VersionRow): DeliverableVersion => ({
  deliverableId: r.deliverable_id as DeliverableId,
  version: Number(r.version),
  jobId: r.job_id as JobId,
  content: JSON.parse(r.content) as Json,
  createdAt: r.created_at,
});
const toReopening = (r: ReopeningRow): Reopening => ({
  jobId: r.job_id as JobId,
  deliverableId: r.deliverable_id as DeliverableId,
  fromVersion: Number(r.from_version),
  feedback: r.feedback,
  requestedBy: r.requested_by as ActorId,
  createdAt: r.created_at,
});

export class SqlDeliverables implements DeliverableRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: DeliverableId) {
    const row = await this.sql.one<DeliverableRow>("SELECT * FROM deliverables WHERE id = $1", [id]);
    return row && toDeliverable(row);
  }

  async add(d: Deliverable) {
    await this.sql.run(
      `INSERT INTO deliverables (id, title, status, current_version, created_at, updated_at, decided_by, decision_note, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM deliverables))`,
      [d.id, d.title, d.status, d.currentVersion, d.createdAt, d.updatedAt, d.decidedBy, d.decisionNote],
    );
  }

  async save(d: Deliverable) {
    await this.sql.run("UPDATE deliverables SET status = $2, current_version = $3, updated_at = $4, decided_by = $5, decision_note = $6 WHERE id = $1", [
      d.id,
      d.status,
      d.currentVersion,
      d.updatedAt,
      d.decidedBy,
      d.decisionNote,
    ]);
  }

  /** Da atualizada mais recentemente para a mais antiga. */
  async list() {
    return (await this.sql.all<DeliverableRow>("SELECT * FROM deliverables ORDER BY updated_at DESC, ordinal DESC")).map(toDeliverable);
  }

  async addVersion(v: DeliverableVersion) {
    await this.sql.run("INSERT INTO deliverable_versions (deliverable_id, version, job_id, content, created_at) VALUES ($1, $2, $3, $4, $5)", [
      v.deliverableId,
      v.version,
      v.jobId,
      JSON.stringify(v.content),
      v.createdAt,
    ]);
  }

  /** Da mais nova para a mais antiga. */
  async versions(id: DeliverableId) {
    return (await this.sql.all<VersionRow>("SELECT * FROM deliverable_versions WHERE deliverable_id = $1 ORDER BY version DESC", [id])).map(toVersion);
  }

  async versionByJob(jobId: JobId) {
    const row = await this.sql.one<VersionRow>("SELECT * FROM deliverable_versions WHERE job_id = $1", [jobId]);
    return row && toVersion(row);
  }

  async addReopening(r: Reopening) {
    await this.sql.run(
      "INSERT INTO deliverable_reopenings (job_id, deliverable_id, from_version, feedback, requested_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [r.jobId, r.deliverableId, r.fromVersion, r.feedback, r.requestedBy, r.createdAt],
    );
  }

  async reopeningFor(jobId: JobId) {
    const row = await this.sql.one<ReopeningRow>("SELECT * FROM deliverable_reopenings WHERE job_id = $1", [jobId]);
    return row && toReopening(row);
  }

  async reopenings(id: DeliverableId) {
    return (await this.sql.all<ReopeningRow>("SELECT * FROM deliverable_reopenings WHERE deliverable_id = $1 ORDER BY from_version", [id])).map(toReopening);
  }
}

export interface DeliverablesStore {
  deliverables: DeliverableRepository;
  events: EventLog;
}

export const deliverablesStore =
  (clock: Clock) =>
  (sql: Sql): DeliverablesStore => ({ deliverables: new SqlDeliverables(sql), events: new SqlEventLog(sql, clock) });
