/** O que o módulo de entregas guarda. Implementação em `infrastructure/`. */
import type { ActorId, JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Deliverable, DeliverableId } from "./deliverable.ts";

export interface DeliverableVersion {
  readonly deliverableId: DeliverableId;
  readonly version: number;
  readonly jobId: JobId;
  readonly content: Json;
  readonly createdAt: string;
}

export interface Reopening {
  readonly jobId: JobId;
  readonly deliverableId: DeliverableId;
  readonly fromVersion: number;
  readonly feedback: string;
  readonly requestedBy: ActorId;
  readonly createdAt: string;
}

export interface DeliverableRepository {
  get(id: DeliverableId): Promise<Deliverable | undefined>;
  add(deliverable: Deliverable): Promise<void>;
  save(deliverable: Deliverable): Promise<void>;
  /** Da atualizada mais recentemente para a mais antiga. */
  list(): Promise<Deliverable[]>;
  addVersion(version: DeliverableVersion): Promise<void>;
  /** Da mais nova para a mais antiga. */
  versions(id: DeliverableId): Promise<DeliverableVersion[]>;
  versionByJob(jobId: JobId): Promise<DeliverableVersion | undefined>;
  addReopening(reopening: Reopening): Promise<void>;
  reopeningFor(jobId: JobId): Promise<Reopening | undefined>;
  reopenings(id: DeliverableId): Promise<Reopening[]>;
}
