/**
 * Chama `tick` a cada intervalo e logo ao subir (cobrindo o que venceu enquanto a API estava
 * parada). Uma rodada por vez; um erro numa rodada não derruba as próximas.
 */
import { tick, type RoutinesDeps } from "./routines.ts";

export class RoutineTicker {
  private readonly deps: RoutinesDeps;
  private readonly onAdmitted: () => void;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(deps: RoutinesDeps, onAdmitted: () => void) {
    this.deps = deps;
    this.onAdmitted = onAdmitted;
  }

  start(intervalMs = 30_000) {
    this.timer = setInterval(() => void this.round(), intervalMs);
    this.timer.unref();
    void this.round();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Uma rodada agora (ou espera a que já está rodando). */
  round(): Promise<void> {
    this.running ??= tick(this.deps)
      .then((r) => {
        if (r.admitted || r.retried) this.onAdmitted();
      })
      .catch((error) => console.error("rotinas", error))
      .finally(() => (this.running = undefined));
    return this.running;
  }
}
