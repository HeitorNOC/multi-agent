// N6 — recursos da empresa: cadastro sem credenciais, nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { addResource, changeResource, listResources, removeResource, resourceBriefs } from "./application/resources.ts";
import { agentsStore } from "./infrastructure/sql-agents.ts";

const ceo = ActorId.parse("ceo");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects)
  describe(`recursos da empresa — ${dialect}`, () => {
    test("cadastrar, mudar e remover; nome único; credencial é recusada", async () => {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const deps = { uow: new UnitOfWork(d.db, agentsStore(clock)), clock };
      const kafka = await addResource(deps, ceo, { kind: "queue", name: "Kafka de produção", description: "Cluster kafka.interno:9092; tópicos atendimento.*" });
      assert.equal(await code(addResource(deps, ceo, { kind: "queue", name: "kafka de produção", description: "Outro cluster" })), "resource_exists");
      assert.equal(await code(addResource(deps, ceo, { kind: "database", name: "Réplica", description: "postgres://leitor:segredo@host:5432/db" })), "looks_like_secret");
      assert.equal(await code(addResource(deps, ceo, { kind: "nave", name: "X", description: "Descrição" })), "invalid_kind");
      await changeResource(deps, ceo, kafka.id, { kind: "queue", name: "Kafka de produção", description: "Cluster kafka.interno:9092; tópicos atendimento.* e vendas.*" });
      assert.deepEqual(await resourceBriefs(deps), [{ name: "Kafka de produção", kind: "queue", description: "Cluster kafka.interno:9092; tópicos atendimento.* e vendas.*" }]);
      await removeResource(deps, ceo, kafka.id);
      assert.equal((await listResources(deps)).resources.length, 0);
    });
  });
