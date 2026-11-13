import type { JourneyStore, QueueKind } from "./ledger/journey-ledger.ts";

export type { QueueKind };

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

/**
 * Regra de admissão da fila: capacidade total e vagas reservadas para retomadas.
 * Lê a profundidade pela porta do ledger; para decidir e enfileirar de forma atômica,
 * chame `requireQueueSpace` com o `tx` da mesma transação que fará o `enqueue`.
 */
export function queueAdmission(limits: ReturnType<typeof queueLimits>) {
  const { queueCapacity, resumeReserve, newCapacity } = limits;

  async function requireQueueSpace(
    store: Pick<JourneyStore, "queueDepth">,
    kind: QueueKind,
  ): Promise<void> {
    const { total, newRequests } = await store.queueDepth();
    if (total >= queueCapacity)
      throw new QueueError(
        "Fila cheia. Tente novamente quando houver vaga.",
        429,
      );
    if (kind === "new" && resumeReserve && newRequests >= newCapacity) {
      throw new QueueError(
        "Fila de novos pedidos cheia. Há vagas reservadas para aprovações e retomadas.",
        429,
      );
    }
  }

  return { requireQueueSpace };
}
