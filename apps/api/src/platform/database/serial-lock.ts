/**
 * Fila FIFO de exclusão mútua dentro do processo, com detecção de reentrada.
 * Quem já está dentro (`inside()`) e tenta entrar de novo recebe erro em vez de travar.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseUsageError } from "./database.ts";

export class SerialLock {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly holder = new AsyncLocalStorage<true>();

  inside(): boolean {
    return this.holder.getStore() === true;
  }

  /** Lança se o contexto atual já estiver dentro do bloqueio. */
  assertOutside() {
    if (this.inside())
      throw new DatabaseUsageError("Use o `sql` da transação: o banco externo não pode ser usado dentro dela");
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    try {
      this.assertOutside();
    } catch (error) {
      return Promise.reject(error);
    }
    const result = this.tail.then(
      () => this.holder.run(true, work),
      () => this.holder.run(true, work),
    );
    this.tail = result.catch(() => undefined);
    return result;
  }
}
