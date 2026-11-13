import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeJourneyLedgerContract } from "./journey-ledger.contract.ts";
import type { JourneyLedger } from "./journey-ledger.ts";
import { SqliteJourneyLedger } from "./sqlite-journey-ledger.ts";

describeJourneyLedgerContract("SQLite", {
  async create({ destinationJournal, schedulerLock = false }) {
    const stateDir = mkdtempSync(join(tmpdir(), "aurora-ledger-contract-"));
    const opened: JourneyLedger[] = [];
    const open = (lock: boolean) => {
      const ledger = new SqliteJourneyLedger({ stateDir, installation: "contrato", destinationJournal, schedulerLock: lock });
      opened.push(ledger);
      return ledger;
    };
    const ledger = open(schedulerLock);
    return {
      ledger,
      reopen: async ({ schedulerLock: lock }) => open(lock),
      async cleanup() {
        for (const l of opened) await l.close().catch(() => {});
        rmSync(stateDir, { recursive: true, force: true });
      },
    };
  },
});
