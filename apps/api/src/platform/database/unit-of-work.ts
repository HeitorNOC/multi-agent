/**
 * Unidade de trabalho: agrupa os repositórios de um módulo sobre a mesma transação.
 *
 *   await jobsUow.run(async ({ jobs, queue, events }) => { ... })   // tudo ou nada
 *   await jobsUow.read.jobs.get(id)                                 // leitura fora de transação
 *
 * Dois módulos podem escrever na mesma transação: quem a abriu repassa o `Transaction` e o
 * outro módulo obtém os próprios repositórios com `join(tx)` (por exemplo, a resposta da
 * conversa gravada junto com a admissão do trabalho).
 */
import type { Database, Sql } from "./database.ts";

declare const transaction: unique symbol;
/** Uma transação em andamento, opaca para quem não é do banco. */
export type Transaction = Sql & { readonly [transaction]: true };

export class UnitOfWork<Repositories> {
  private readonly db: Database;
  private readonly make: (sql: Sql) => Repositories;
  /** Repositórios para leitura fora de transação. */
  readonly read: Repositories;

  constructor(db: Database, make: (sql: Sql) => Repositories) {
    this.db = db;
    this.make = make;
    this.read = make(db.sql);
  }

  run<T>(work: (repositories: Repositories, tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction((sql) => work(this.make(sql), sql as Transaction));
  }

  /** Repositórios deste módulo dentro de uma transação aberta por outro. */
  join(tx: Transaction): Repositories {
    return this.make(tx);
  }
}
