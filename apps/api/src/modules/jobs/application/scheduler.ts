/**
 * Agendador: enquanto houver vaga de worker e entrada na fila, tira da fila e inicia o worker.
 * É acordado por admissões, decisões e fim de execução, e a cada segundo como rede de segurança.
 */
import type { JobsDeps } from "./deps.ts";
import { claimNextJob, finishRun } from "./run-lifecycle.ts";
import type { WorkerLaunch } from "../../../platform/workers/supervisor.ts";

export interface WorkerStarter {
  start(launch: WorkerLaunch): void;
}

export class JobScheduler {
  private readonly deps: JobsDeps;
  private readonly starter: WorkerStarter;
  private pumping = false;
  private again = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(deps: JobsDeps, starter: WorkerStarter) {
    this.deps = deps;
    this.starter = starter;
  }

  start(intervalMs = 1000) {
    this.timer = setInterval(() => void this.wake(), intervalMs);
    this.timer.unref();
    void this.wake();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Pede uma rodada; se já houver uma em andamento, outra roda logo depois. */
  async wake(): Promise<void> {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        await this.drain();
      } while (this.again);
    } finally {
      this.pumping = false;
    }
  }

  private async drain() {
    for (;;) {
      const claim = await claimNextJob(this.deps).catch(() => ({ kind: "empty" as const }));
      if (claim.kind === "empty") return;
      if (claim.kind === "skipped") continue;
      try {
        this.starter.start({ jobId: claim.job.id, goal: claim.job.goal, crashAfterEffect: claim.entry.crashAfterEffect });
      } catch {
        await finishRun(this.deps, claim.job.id, { exitCode: null, spawnFailed: true });
      }
    }
  }
}
