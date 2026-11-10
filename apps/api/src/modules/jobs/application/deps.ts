/** Dependências comuns dos casos de uso de trabalhos, injetadas pela composição em `main.ts`. */
import type { Clock } from "../../../shared/clock.ts";
import type { JobId } from "../../../shared/ids.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import type { JobsStore } from "../infrastructure/jobs-store.ts";
import type { WorkPolicy } from "./policy.ts";
import type { QueueLimits } from "./queue-limits.ts";

/** O que os casos de uso precisam saber dos processos de worker em execução. */
export interface ActiveWorkers {
  isActive(jobId: JobId): boolean;
  count(): number;
}

export interface JobsDeps {
  uow: UnitOfWork<JobsStore>;
  policy: WorkPolicy;
  limits: QueueLimits;
  clock: Clock;
  workers: ActiveWorkers;
}
