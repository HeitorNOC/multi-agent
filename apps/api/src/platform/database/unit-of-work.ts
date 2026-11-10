/**
 * Unidade de trabalho: agrupa os repositórios de um módulo sobre a mesma transação.
 *
 *   await jobsUow.run(async ({ jobs, queue, events }) => { ... })   // tudo ou nada
 *   await jobsUow.read.jobs.get(id)                                 // leitura fora de transação
 */
import type { Database, Sql } from "./database.ts";

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

  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((sql) => work(this.make(sql)));
  }
}
