/** Dependências comuns dos casos de uso de trabalhos, injetadas pela composição em `main.ts`. */
import type { Clock } from "../../../shared/clock.ts";
import type { JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import type { Job } from "../domain/job.ts";
import type { BoundReview } from "../domain/review.ts";
import type { JobsStore } from "../infrastructure/jobs-store.ts";
import type { WorkPolicy } from "./policy.ts";
import type { QueueLimits } from "./queue-limits.ts";

/** O que os casos de uso precisam saber dos processos de worker em execução. */
export interface ActiveWorkers {
  isActive(jobId: JobId): boolean;
  count(): number;
}

/**
 * O efeito aprovado de verdade (por exemplo, gerar a entrega). Roda uma única vez, dentro da
 * transação que grava o recibo: ou existem os dois, ou nenhum. O que devolver entra no recibo.
 */
export interface EffectDelivery {
  deliver(input: { job: Job; review: BoundReview }, tx: Transaction): Promise<Record<string, Json>>;
}

export interface JobsDeps {
  uow: UnitOfWork<JobsStore>;
  policy: WorkPolicy;
  limits: QueueLimits;
  clock: Clock;
  workers: ActiveWorkers;
  /** Sem ele, o efeito é só simulado (recibo sem destino). */
  delivery?: EffectDelivery;
}
