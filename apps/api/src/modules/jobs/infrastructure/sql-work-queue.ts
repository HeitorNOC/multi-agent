import type { JobId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import type { QueueEntry, QueueKind, WorkQueue } from "../domain/repositories.ts";

type QueueRow = { seq: number | string; job_id: string; kind: string; crash_after_effect: number | string; queued_at: string };

const toEntry = (r: QueueRow): QueueEntry => ({
  seq: Number(r.seq),
  jobId: r.job_id as JobId,
  kind: r.kind as QueueKind,
  crashAfterEffect: Number(r.crash_after_effect) === 1,
  queuedAt: r.queued_at,
});

export class SqlWorkQueue implements WorkQueue {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async add(entry: Omit<QueueEntry, "seq">) {
    const row = await this.sql.one<{ seq: number | string }>(
      "INSERT INTO job_queue (job_id, kind, crash_after_effect, queued_at) VALUES ($1, $2, $3, $4) RETURNING seq",
      [entry.jobId, entry.kind, entry.crashAfterEffect ? 1 : 0, entry.queuedAt],
    );
    return { ...entry, seq: Number(row!.seq) };
  }

  async next() {
    const row = await this.sql.one<QueueRow>("SELECT * FROM job_queue ORDER BY seq LIMIT 1");
    return row && toEntry(row);
  }

  async remove(entry: Pick<QueueEntry, "seq" | "jobId">) {
    return (await this.sql.run("DELETE FROM job_queue WHERE seq = $1 AND job_id = $2", [entry.seq, entry.jobId])) > 0;
  }

  async depth() {
    const row = await this.sql.one<{ total: number | string; fresh: number | string | null }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN kind = 'new' THEN 1 ELSE 0 END) AS fresh FROM job_queue",
    );
    return { total: Number(row?.total ?? 0), newRequests: Number(row?.fresh ?? 0) };
  }
}
