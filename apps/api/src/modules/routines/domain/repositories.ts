/** O que o módulo de rotinas guarda. Implementação em `infrastructure/`. */
import type { Routine, RoutineId, RoutineRun } from "./routine.ts";

export interface RoutineRepository {
  get(id: RoutineId): Promise<Routine | undefined>;
  add(routine: Routine): Promise<void>;
  save(routine: Routine): Promise<void>;
  /** Não arquivadas, na ordem de criação. */
  list(): Promise<Routine[]>;
  /** Ativas com horário vencido até `now`. */
  due(now: string): Promise<Routine[]>;
}

export interface RunRepository {
  get(routineId: RoutineId, slot: string): Promise<RoutineRun | undefined>;
  /** Falha se o horário já tiver execução (chave única). */
  add(run: RoutineRun): Promise<void>;
  save(run: RoutineRun): Promise<void>;
  /** Da mais recente para a mais antiga. */
  list(routineId: RoutineId, limit?: number): Promise<RoutineRun[]>;
  /** Execuções aguardando nova tentativa com horário vencido. */
  retryDue(now: string): Promise<RoutineRun[]>;
}
