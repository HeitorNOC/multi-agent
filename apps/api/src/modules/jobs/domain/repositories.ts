/**
 * O que o módulo de trabalhos precisa guardar, em interfaces pequenas, uma por responsabilidade.
 * As implementações ficam em `infrastructure/`; os casos de uso só conhecem estas interfaces.
 *
 * Verbos uniformes: `get` (pode não existir), `add` (novo), `save` (grava nova versão, com
 * controle otimista), `remove`, e consultas nomeadas pelo que devolvem.
 */
import type { AdmissionKey, JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Job, JobStatus } from "./job.ts";

export interface JobRepository {
  get(id: JobId): Promise<Job | undefined>;
  add(job: Job): Promise<Job>;
  /** Grava a nova versão. Falha com `conflict` se outra gravação mudou o trabalho antes. */
  save(job: Job): Promise<Job>;
  listByStatus(status: JobStatus): Promise<Job[]>;
  /** Do mais recente para o mais antigo. */
  listRecent(limit?: number): Promise<Job[]>;
  countByStatus(status: JobStatus): Promise<number>;
}

export type QueueKind = "new" | "resume";

export interface QueueEntry {
  readonly seq: number;
  readonly jobId: JobId;
  readonly kind: QueueKind;
  /** Usado em testes de recuperação: o worker cai logo depois do efeito. */
  readonly crashAfterEffect: boolean;
  readonly queuedAt: string;
}

export interface WorkQueue {
  add(entry: Omit<QueueEntry, "seq">): Promise<QueueEntry>;
  /** A próxima entrada, por ordem de chegada. */
  next(): Promise<QueueEntry | undefined>;
  /** Remove a entrada; `false` se ela já não estava na fila. */
  remove(entry: Pick<QueueEntry, "seq" | "jobId">): Promise<boolean>;
  depth(): Promise<{ total: number; newRequests: number }>;
}

/** Chaves de idempotência de admissão: a mesma chave nunca cria dois trabalhos. */
export interface AdmissionRegistry {
  get(key: AdmissionKey): Promise<JobId | undefined>;
  add(key: AdmissionKey, jobId: JobId): Promise<void>;
}

export interface EffectReceipt {
  readonly jobId: JobId;
  readonly hash: string;
  readonly receipt: Json;
}

/** No máximo um efeito por trabalho; pedir de novo devolve o mesmo recibo. */
export interface EffectReceipts {
  get(jobId: JobId): Promise<EffectReceipt | undefined>;
  add(receipt: EffectReceipt): Promise<void>;
}

export interface InferenceReceipt {
  readonly jobId: JobId;
  readonly slot: string;
  readonly inputSha: string;
  readonly state: "reserved" | "completed";
  readonly output: Json | null;
  readonly usage: Json | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Recibos de chamadas ao modelo: reservar antes, completar depois. Uma reserva sem recibo após
 * uma queda é resultado desconhecido e nunca é refeita automaticamente.
 */
export interface InferenceReceipts {
  /** Reserva o passo; se já existir, devolve o existente com `created: false`. */
  reserve(input: { jobId: JobId; slot: string; inputSha: string }): Promise<{ created: boolean; receipt: InferenceReceipt }>;
  /** Grava o recibo de uma reserva pendente; `false` se não havia reserva pendente. */
  complete(input: { jobId: JobId; slot: string; output: Json; usage: Json }): Promise<boolean>;
  /** Desfaz uma reserva pendente quando a chamada falhou SABIDAMENTE. */
  release(input: { jobId: JobId; slot: string }): Promise<boolean>;
  get(jobId: JobId, slot: string): Promise<InferenceReceipt | undefined>;
  list(jobId: JobId): Promise<InferenceReceipt[]>;
}
