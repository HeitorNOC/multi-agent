import type { DatabaseSync } from "node:sqlite";

export type QueueKind = "new" | "resume";

export function queueLimits(capacity?: number, reserve?: number) {
  const queueCapacity = capacity ?? 0;
  if (
    !Number.isInteger(queueCapacity) ||
    queueCapacity < 0 ||
    queueCapacity > 1000
  )
    throw Error("Capacidade de fila inválida");
  const resumeReserve = reserve ?? 0;
  if (
    !Number.isInteger(resumeReserve) ||
    resumeReserve < 0 ||
    resumeReserve >= Math.max(1, queueCapacity)
  ) {
    throw Error("Reserva de retomadas inválida");
  }
  const newCapacity = queueCapacity - resumeReserve;

  return { queueCapacity, resumeReserve, newCapacity };
}

export class QueueError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function queueAdmission(
  db: DatabaseSync,
  limits: ReturnType<typeof queueLimits>,
) {
  const { queueCapacity, resumeReserve, newCapacity } = limits;
  const queueCount = () =>
    Number(
      (db.prepare("SELECT count(*) AS n FROM job_queue").get() as { n: number })
        .n,
    );
  const newQueueCount = () =>
    Number(
      (
        db
          .prepare("SELECT count(*) AS n FROM job_queue WHERE kind='new'")
          .get() as { n: number }
      ).n,
    );
  function requireQueueSpace(kind: QueueKind) {
    if (queueCount() >= queueCapacity)
      throw new QueueError(
        "Fila cheia. Tente novamente quando houver vaga.",
        429,
      );
    if (kind === "new" && resumeReserve && newQueueCount() >= newCapacity) {
      throw new QueueError(
        "Fila de novos pedidos cheia. Há vagas reservadas para aprovações e retomadas.",
        429,
      );
    }
  }

  return { queueCount, newQueueCount, requireQueueSpace };
}
