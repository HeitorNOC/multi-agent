/**
 * Escolhe e abre o adaptador do ledger conforme a configuração da instalação.
 *
 * É o único lugar que conhece os adaptadores concretos; o servidor só enxerga `JourneyLedger`.
 * Sem configuração explícita, usa SQLite no diretório de estado (instalação local simples).
 */
import type { JourneyLedger } from "./journey-ledger.ts";
import { PostgresJourneyLedger } from "./postgres-journey-ledger.ts";
import { SqliteJourneyLedger } from "./sqlite-journey-ledger.ts";

export type LedgerDriverConfig =
  | { driver: "sqlite" }
  | { driver: "postgres"; connectionString: string; schema?: string; poolSize?: number };

export interface OpenLedgerOptions {
  /** Trecho `ledger` da configuração da instalação; ausente significa SQLite. */
  driver?: LedgerDriverConfig;
  stateDir: string;
  installation: string;
  destinationJournal: boolean;
  /** Impede um segundo agendador na mesma instalação. */
  schedulerLock: boolean;
}

export async function openJourneyLedger(options: OpenLedgerOptions): Promise<JourneyLedger> {
  const { driver = { driver: "sqlite" } as const, ...common } = options;
  switch (driver.driver) {
    case "sqlite":
      return new SqliteJourneyLedger(common);
    case "postgres":
      if (typeof driver.connectionString !== "string" || !driver.connectionString)
        throw new Error("O driver postgres requer ledger.connectionString");
      return PostgresJourneyLedger.open({
        connectionString: driver.connectionString,
        schema: driver.schema,
        poolSize: driver.poolSize,
        installation: common.installation,
        destinationJournal: common.destinationJournal,
        schedulerLock: common.schedulerLock,
      });
    default:
      throw new Error(`Driver de ledger desconhecido: ${(driver as { driver: string }).driver}`);
  }
}
