import { conflict } from "../../../shared/errors.ts";
import type { JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Sql } from "../../../platform/database/database.ts";
import type { Job, JobStatus, Review } from "../domain/job.ts";
import type { JobRepository } from "../domain/repositories.ts";

type JobRow = {
  id: string;
  goal: string;
  attachments: string | null;
  status: string;
  preset: string | null;
  plan: string | null;
  review: string | null;
  approval: string | null;
  receipt: string | null;
  error: string | null;
  created_at: string;
  version: number | string;
};

const parse = <T>(text: string | null) => (text === null ? null : (JSON.parse(text) as T));
const text = (value: Json | null) => (value === null ? null : JSON.stringify(value));

function toJob(r: JobRow): Job {
  return {
    id: r.id as JobId,
    goal: r.goal,
    attachments: r.attachments ? (JSON.parse(r.attachments) as string[]) : [],
    status: r.status as JobStatus,
    preset: parse<Json>(r.preset),
    plan: parse<Json>(r.plan),
    review: parse<Review>(r.review),
    approval: r.approval,
    receipt: parse<Json>(r.receipt),
    error: r.error,
    createdAt: r.created_at,
    version: Number(r.version),
  };
}

export class SqlJobRepository implements JobRepository {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: JobId) {
    const row = await this.sql.one<JobRow>("SELECT * FROM jobs WHERE id = $1", [id]);
    return row && toJob(row);
  }

  async add(job: Job) {
    await this.sql.run(
      `INSERT INTO jobs (id, goal, status, plan, review, approval, receipt, error, created_at, attachments, preset, ordinal, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM jobs), 1)`,
      [job.id, job.goal, job.status, text(job.plan), text(job.review), job.approval, text(job.receipt), job.error, job.createdAt, JSON.stringify(job.attachments), text(job.preset)],
    );
    return { ...job, version: 1 };
  }

  async save(job: Job) {
    const changed = await this.sql.run(
      `UPDATE jobs SET status = $1, plan = $2, review = $3, approval = $4, receipt = $5, error = $6, version = version + 1
       WHERE id = $7 AND version = $8`,
      [job.status, text(job.plan), text(job.review), job.approval, text(job.receipt), job.error, job.id, job.version],
    );
    if (!changed) throw conflict("concurrent_update", "O trabalho mudou enquanto era alterado; recarregue");
    return { ...job, version: job.version + 1 };
  }

  async listByStatus(status: JobStatus) {
    return (await this.sql.all<JobRow>("SELECT * FROM jobs WHERE status = $1 ORDER BY ordinal", [status])).map(toJob);
  }

  async listRecent(limit = 200) {
    return (await this.sql.all<JobRow>("SELECT * FROM jobs ORDER BY ordinal DESC LIMIT $1", [limit])).map(toJob);
  }

  async countByStatus(status: JobStatus) {
    const row = await this.sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM jobs WHERE status = $1", [status]);
    return Number(row?.n ?? 0);
  }
}
