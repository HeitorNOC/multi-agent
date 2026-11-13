/**
 * Capacidade da fila. Parte das vagas fica reservada para retomadas e aprovações, para que uma
 * rajada de pedidos novos não impeça concluir o que já foi aprovado.
 */
import { invalid, rateLimited } from "../../../shared/errors.ts";
import type { QueueKind, WorkQueue } from "../domain/repositories.ts";

export interface QueueLimits {
  readonly capacity: number;
  readonly resumeReserve: number;
  readonly maxWorkers: number;
}

export function queueLimits(input: { capacity: number; resumeReserve?: number; maxWorkers?: number }): QueueLimits {
  const { capacity, resumeReserve = 0, maxWorkers = 1 } = input;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw invalid("invalid_capacity", "Capacidade da fila deve ser de 1 a 1000");
  if (!Number.isInteger(resumeReserve) || resumeReserve < 0 || resumeReserve >= capacity)
    throw invalid("invalid_reserve", "Reserva de retomadas deve ser menor que a capacidade");
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 8) throw invalid("invalid_workers", "Workers devem ser de 1 a 8");
  return { capacity, resumeReserve, maxWorkers };
}

/** Lança `rate_limited` se não houver vaga para este tipo de entrada. */
export async function requireQueueSpace(queue: WorkQueue, limits: QueueLimits, kind: QueueKind): Promise<void> {
  const { total, newRequests } = await queue.depth();
  if (total >= limits.capacity) throw rateLimited("queue_full", "Fila cheia. Tente novamente quando houver vaga.");
  if (kind === "new" && limits.resumeReserve && newRequests >= limits.capacity - limits.resumeReserve)
    throw rateLimited("queue_full_for_new", "Fila de novos pedidos cheia. Há vagas reservadas para aprovações e retomadas.");
}
