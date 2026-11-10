/** Admissões idempotentes, recibos de efeito e recibos de inferência, sobre o mesmo `Sql`. */
import type { Clock } from "../../../shared/clock.ts";
import type { AdmissionKey, JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Sql } from "../../../platform/database/database.ts";
import type {
  AdmissionRegistry,
  EffectReceipt,
  EffectReceipts,
  InferenceReceipt,
  InferenceReceipts,
} from "../domain/repositories.ts";

export class SqlAdmissionRegistry implements AdmissionRegistry {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async get(key: AdmissionKey) {
    const row = await this.sql.one<{ job_id: string }>("SELECT job_id FROM admissions WHERE key = $1", [key]);
    return row ? (row.job_id as JobId) : undefined;
  }
  async add(key: AdmissionKey, jobId: JobId) {
    await this.sql.run("INSERT INTO admissions (key, job_id) VALUES ($1, $2)", [key, jobId]);
  }
}

export class SqlEffectReceipts implements EffectReceipts {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async get(jobId: JobId) {
    const row = await this.sql.one<{ hash: string; receipt: string }>("SELECT hash, receipt FROM effect_receipts WHERE job_id = $1", [jobId]);
    return row && { jobId, hash: row.hash, receipt: JSON.parse(row.receipt) as Json };
  }
  async add(r: EffectReceipt) {
    await this.sql.run("INSERT INTO effect_receipts (job_id, hash, receipt) VALUES ($1, $2, $3)", [r.jobId, r.hash, JSON.stringify(r.receipt)]);
  }
}

type InferenceRow = {
  job_id: string;
  slot: string;
  input_sha: string;
  state: string;
  output: string | null;
  usage: string | null;
  created_at: string;
  updated_at: string;
};

const toInference = (r: InferenceRow): InferenceReceipt => ({
  jobId: r.job_id as JobId,
  slot: r.slot,
  inputSha: r.input_sha,
  state: r.state as InferenceReceipt["state"],
  output: r.output === null ? null : (JSON.parse(r.output) as Json),
  usage: r.usage === null ? null : (JSON.parse(r.usage) as Json),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SqlInferenceReceipts implements InferenceReceipts {
  private readonly sql: Sql;
  private readonly clock: Clock;
  constructor(sql: Sql, clock: Clock) {
    this.sql = sql;
    this.clock = clock;
  }

  async reserve(input: { jobId: JobId; slot: string; inputSha: string }) {
    const now = this.clock.now();
    const created = await this.sql.run(
      `INSERT INTO inference_receipts (job_id, slot, input_sha, state, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, 'reserved', $4, $4, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM inference_receipts))
       ON CONFLICT (job_id, slot) DO NOTHING`,
      [input.jobId, input.slot, input.inputSha, now],
    );
    return { created: created > 0, receipt: (await this.get(input.jobId, input.slot))! };
  }

  async complete(input: { jobId: JobId; slot: string; output: Json; usage: Json }) {
    const changed = await this.sql.run(
      "UPDATE inference_receipts SET state = 'completed', output = $1, usage = $2, updated_at = $3 WHERE job_id = $4 AND slot = $5 AND state = 'reserved'",
      [JSON.stringify(input.output), JSON.stringify(input.usage), this.clock.now(), input.jobId, input.slot],
    );
    return changed > 0;
  }

  async release(input: { jobId: JobId; slot: string }) {
    return (await this.sql.run("DELETE FROM inference_receipts WHERE job_id = $1 AND slot = $2 AND state = 'reserved'", [input.jobId, input.slot])) > 0;
  }

  async get(jobId: JobId, slot: string) {
    const row = await this.sql.one<InferenceRow>("SELECT * FROM inference_receipts WHERE job_id = $1 AND slot = $2", [jobId, slot]);
    return row && toInference(row);
  }

  async list(jobId: JobId) {
    return (await this.sql.all<InferenceRow>("SELECT * FROM inference_receipts WHERE job_id = $1 ORDER BY ordinal", [jobId])).map(toInference);
  }
}
