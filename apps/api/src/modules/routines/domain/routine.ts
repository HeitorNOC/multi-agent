/**
 * Rotinas: um pedido ao Chief of Staff que se repete numa agenda.
 *
 * Regras que impedem duplicar trabalho:
 *  - cada horário (`slot`) de uma rotina tem no máximo uma execução — chave única no banco;
 *  - o trabalho é admitido na mesma transação que grava a execução: ou existem os dois, ou nenhum;
 *  - depois de uma parada, só o horário vencido mais recente é disparado (os anteriores ficam
 *    registrados como perdidos), para não despejar uma fila de trabalhos atrasados.
 * Se a admissão for recusada (fila cheia, time vazio), a execução fica aguardando nova tentativa,
 * com espera crescente, até `MAX_ATTEMPTS`.
 */
import { ensure, invalid } from "../../../shared/errors.ts";
import type { ActorId, Id, JobId } from "../../../shared/ids.ts";
import type { Schedule } from "./schedule.ts";

export type RoutineId = Id<"Routine">;

export interface Routine {
  readonly id: RoutineId;
  readonly name: string;
  /** O pedido enviado ao Chief of Staff em cada execução. */
  readonly goal: string;
  readonly schedule: Schedule;
  readonly enabled: boolean;
  readonly archived: boolean;
  /** Próximo horário a disparar; `null` quando pausada. */
  readonly nextRunAt: string | null;
  readonly createdBy: ActorId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type RunStatus = "admitted" | "retrying" | "gave_up";

export interface RoutineRun {
  readonly routineId: RoutineId;
  /** O horário da agenda que esta execução atende (ou o instante do "rodar agora"). */
  readonly slot: string;
  readonly trigger: "schedule" | "manual";
  readonly status: RunStatus;
  readonly jobId: JobId | null;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  /** Horários perdidos durante uma parada, cobertos por esta execução. */
  readonly missed: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const MAX_ATTEMPTS = 3;
/** Espera antes da tentativa n+1 (minutos). */
export const RETRY_MINUTES = [5, 15] as const;

export function validateRoutineText(name: string, goal: string) {
  const n = name.trim();
  const g = goal.trim();
  ensure(n.length >= 2 && n.length <= 80, () => invalid("invalid_name", "Nome da rotina deve ter de 2 a 80 caracteres"));
  ensure(g.length >= 10 && g.length <= 2000, () => invalid("invalid_goal", "Descreva o pedido em 10 a 2000 caracteres"));
  return { name: n, goal: g };
}

/** Depois de uma tentativa recusada: espera crescente, ou desiste no limite. */
export function afterFailure(run: Pick<RoutineRun, "attempts">, error: string, now: Date): Pick<RoutineRun, "status" | "attempts" | "nextAttemptAt" | "lastError"> {
  const attempts = run.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return { status: "gave_up", attempts, nextAttemptAt: null, lastError: error };
  const wait = RETRY_MINUTES[attempts - 1] ?? RETRY_MINUTES.at(-1)!;
  return { status: "retrying", attempts, nextAttemptAt: new Date(now.getTime() + wait * 60_000).toISOString(), lastError: error };
}
