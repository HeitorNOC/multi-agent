import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeJourneyLedgerContract } from "./journey-ledger.contract.ts";
import { SqliteJourneyLedger } from "./sqlite-journey-ledger.ts";

describeJourneyLedgerContract("SQLite", {
  async create({ destinationJournal }) {
    const stateDir = mkdtempSync(join(tmpdir(), "aurora-ledger-contract-"));
    const ledger = new SqliteJourneyLedger({ stateDir, installation: "contrato", destinationJournal });
    return {
      ledger,
      async cleanup() {
        await ledger.close();
        rmSync(stateDir, { recursive: true, force: true });
      },
    };
  },
});
