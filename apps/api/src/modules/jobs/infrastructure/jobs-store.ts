/** Os repositórios do módulo de trabalhos, montados sobre o mesmo `Sql` (uma transação). */
import type { Clock } from "../../../shared/clock.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { AdmissionRegistry, EffectReceipts, InferenceReceipts, JobRepository, WorkQueue } from "../domain/repositories.ts";
import { SqlJobRepository } from "./sql-job-repository.ts";
import { SqlAdmissionRegistry, SqlEffectReceipts, SqlInferenceReceipts } from "./sql-receipts.ts";
import { SqlWorkQueue } from "./sql-work-queue.ts";

export interface JobsStore {
  jobs: JobRepository;
  queue: WorkQueue;
  admissions: AdmissionRegistry;
  effects: EffectReceipts;
  inferences: InferenceReceipts;
  events: EventLog;
}

export const jobsStore =
  (clock: Clock) =>
  (sql: Sql): JobsStore => ({
    jobs: new SqlJobRepository(sql),
    queue: new SqlWorkQueue(sql),
    admissions: new SqlAdmissionRegistry(sql),
    effects: new SqlEffectReceipts(sql),
    inferences: new SqlInferenceReceipts(sql, clock),
    events: new SqlEventLog(sql, clock),
  });
