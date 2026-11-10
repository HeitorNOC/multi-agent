/**
 * Limita chamadas simultâneas a um recurso caro (a CLI do modelo, que consome a cota do usuário).
 * No máximo `maxConcurrent` em execução e `maxWaiting` na espera; acima disso `tryRun` devolve
 * `undefined` na hora, para o chamador decidir sem esperar indefinidamente.
 */
export class CallLimiter {
  private readonly maxConcurrent: number;
  private readonly maxWaiting: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(maxConcurrent = 1, maxWaiting = 4) {
    this.maxConcurrent = maxConcurrent;
    this.maxWaiting = maxWaiting;
  }

  /** Executa `work` quando houver vaga; devolve `{ busy: true }` se a espera estiver cheia. */
  async tryRun<T>(work: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
    if (this.active >= this.maxConcurrent && this.waiting.length >= this.maxWaiting) return { busy: true };
    await this.acquire();
    try {
      return { busy: false, value: await work() };
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiting.push(() => {
        this.active++;
        resolve();
      }),
    );
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }
}
