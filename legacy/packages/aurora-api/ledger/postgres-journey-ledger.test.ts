// Roda o contrato contra PostgreSQL. Precisa de AURORA_TEST_POSTGRES_URL; sem ela, é ignorado.
import { randomBytes } from "node:crypto";
import { describe } from "node:test";
import pg from "pg";
import { describeJourneyLedgerContract } from "./journey-ledger.contract.ts";
import type { JourneyLedger } from "./journey-ledger.ts";
import { PostgresJourneyLedger } from "./postgres-journey-ledger.ts";

const url = process.env.AURORA_TEST_POSTGRES_URL;

if (!url) {
  describe("contrato JourneyLedger — PostgreSQL", { skip: "defina AURORA_TEST_POSTGRES_URL" }, () => {});
} else {
  describeJourneyLedgerContract("PostgreSQL", {
    async create({ destinationJournal, schedulerLock = false }) {
      // Um esquema novo por teste mantém os testes independentes e repetíveis.
      const schema = "t_" + randomBytes(6).toString("hex");
      const opened: JourneyLedger[] = [];
      const open = async (lock: boolean) => {
        const ledger = await PostgresJourneyLedger.open({
          connectionString: url,
          schema,
          installation: "contrato",
          destinationJournal,
          schedulerLock: lock,
        });
        opened.push(ledger);
        return ledger;
      };
      const ledger = await open(schedulerLock);
      return {
        ledger,
        reopen: ({ schedulerLock: lock }) => open(lock),
        async cleanup() {
          for (const l of opened) await l.close().catch(() => {});
          const admin = new pg.Pool({ connectionString: url, max: 1 });
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.end();
        },
      };
    },
  });
}
