// Time de agentes, organograma, empresa e primeiro uso, nos dois bancos; e o Chief of Staff
// escalando só quem está no time.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type AgentId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { createHttpApp } from "../../platform/http/app.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { openWorkPolicy } from "../open-work/application/open-policy.ts";
import { catalogView, changeAgent, completeSetup, createAgent, dismiss, hire, listTeam, organogram, saveOrganization, setupStatus, teamDirectory, type AgentsDeps } from "./application/agents.ts";
import { loadTemplates } from "./domain/template.ts";
import { agentsHttp } from "./http/routes.ts";
import { agentsStore } from "./infrastructure/sql-agents.ts";

const templates = loadTemplates(fileURLToPath(new URL("../../../data/agent-templates.json", import.meta.url)));
const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

test("catálogo de personas: válido, por área, com nome, cargo, frase e habilidades", () => {
  assert.ok(templates.areas.length >= 8);
  assert.ok(templates.templates.length >= 30);
  for (const t of templates.templates) assert.ok(t.name && t.title && t.tagline && t.skills.length >= 2, t.id);
});

for (const dialect of dialects) {
  describe(`time de agentes — ${dialect}`, () => {
    async function setup() {
      const d: TestDatabase = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      let sources = 0;
      const uow = new UnitOfWork(d.db, agentsStore(clock));
      const deps: AgentsDeps = { uow, catalog: templates, clock, countSources: async () => sources };
      return { deps, uow, setSources: (n: number) => (sources = n) };
    }

    test("contratar uma persona; repetir é inofensivo; o catálogo marca 'no seu time'", async () => {
      const { deps } = await setup();
      const first = await hire(deps, ana, "procurement_analyst");
      assert.deepEqual([first.replayed, first.agent.name, first.agent.reports_to], [false, "Bruno", null]);
      assert.equal((await hire(deps, ana, "procurement_analyst")).replayed, true);
      assert.equal(await code(hire(deps, ana, "nao_existe")), "template_not_found");
      const ops = (await catalogView(deps)).areas.find((a) => a.id === "operations")!;
      assert.equal(ops.in_team, 1);
      assert.equal(ops.templates.find((t) => t.id === "procurement_analyst")!.in_team, true);
      assert.equal((await listTeam(deps)).agents.length, 1);
    });

    test("criar meu agente: validações e id próprio", async () => {
      const { deps } = await setup();
      const mine = await createAgent(deps, ana, { name: "Ágata Souza", title: "Analista de licitações", area: "legal", focus: "Editais públicos e prazos", skills: ["Editais", "Editais", "Prazos"] });
      assert.match(mine.id, /^custom_agata_souza_[0-9a-f]{6}$/);
      assert.deepEqual(mine.skills, ["Editais", "Prazos"]);
      assert.equal(await code(createAgent(deps, ana, { name: "X", title: "Y", area: "inexistente", focus: "Z" })), "invalid_area");
      assert.equal(await code(createAgent(deps, ana, { name: " ", title: "Y", area: "legal", focus: "Z" })), "invalid_name");
    });

    test("organograma: a quem cada um responde, sem ciclo; remover reatribui os subordinados", async () => {
      const { deps } = await setup();
      const lead = (await hire(deps, ana, "tech_lead")).agent.id as AgentId;
      const back = (await hire(deps, ana, "backend_engineer")).agent.id as AgentId;
      const front = (await hire(deps, ana, "frontend_engineer")).agent.id as AgentId;
      await changeAgent(deps, ana, back, { reportsTo: lead });
      await changeAgent(deps, ana, front, { reportsTo: back });
      assert.equal(await code(changeAgent(deps, ana, lead, { reportsTo: front })), "org_cycle");
      assert.equal(await code(changeAgent(deps, ana, lead, { reportsTo: lead })), "invalid_manager");
      const org = await organogram(deps);
      assert.deepEqual(org.chief.reports.map((n) => [n.id, n.reports.map((r) => [r.id, r.reports.map((x) => x.id)])]), [["tech_lead", [["backend_engineer", ["frontend_engineer"]]]]]);
      await dismiss(deps, ana, back);
      assert.equal((await dismiss(deps, ana, back)).replayed, true);
      const after = await organogram(deps);
      assert.deepEqual(after.chief.reports.map((n) => [n.id, n.reports.map((r) => r.id)]), [["tech_lead", ["frontend_engineer"]]], "quem respondia ao removido sobe para o gestor dele");
      assert.equal(await code(changeAgent(deps, ana, back, { instructions: "x" })), "agent_removed");
      const again = await hire(deps, ana, "backend_engineer");
      assert.deepEqual([again.replayed, again.agent.reports_to], [false, null], "recontratar volta respondendo ao Chief of Staff");
    });

    test("orientações da empresa chegam ao trabalho aberto; quem saiu do time não é escalado", async () => {
      const { deps, uow } = await setup();
      const team = teamDirectory(uow);
      const policy = openWorkPolicy(team);
      assert.equal(await code(Promise.resolve().then(() => policy.goal({ goal: "Analise as compras do trimestre, por favor" }))), "team_empty");
      await hire(deps, ana, "procurement_analyst");
      await changeAgent(deps, ana, "procurement_analyst" as AgentId, { instructions: "Sempre compare pelo menos três fornecedores." });
      const [member] = await team.members();
      assert.deepEqual([member!.id, member!.title, member!.instructions], ["procurement_analyst", "Bruno, Analista de compras", "Sempre compare pelo menos três fornecedores."]);
      assert.equal(await code(Promise.resolve().then(() => policy.plan({ agents: ["controller"], reason: "Precisa da controladoria aqui." }, null as never))), "agent_not_in_team");
      await dismiss(deps, ana, "procurement_analyst" as AgentId);
      assert.deepEqual(await team.members(), []);
    });

    test("empresa e primeiro uso: concluir exige empresa e time; Cérebro conta mas não bloqueia", async () => {
      const { deps, setSources } = await setup();
      assert.deepEqual((await setupStatus(deps)).steps, { company: false, knowledge: false, team: false });
      assert.equal(await code(completeSetup(deps, ana)), "setup_company_missing");
      assert.equal(await code(saveOrganization(deps, ana, { name: "A" })), "invalid_name");
      const org = await saveOrganization(deps, ana, { name: "Comercial Horizonte", sector: "Varejo", objectives: "Crescer 10%" });
      assert.deepEqual([org.name, org.sector], ["Comercial Horizonte", "Varejo"]);
      assert.equal(await code(completeSetup(deps, ana)), "setup_team_missing");
      await hire(deps, ana, "pricing_analyst");
      setSources(2);
      const done = await completeSetup(deps, ana);
      assert.deepEqual([done.steps, done.sources, !!done.completed_at], [{ company: true, knowledge: true, team: true }, 2, true]);
      assert.equal((await saveOrganization(deps, ana, { name: "Comercial Horizonte S.A." })).sector, "Varejo", "campos omitidos ficam como estavam");
    });

    test("HTTP: contratar, criar, ajustar, remover e organograma", async () => {
      const { deps } = await setup();
      const app = await createHttpApp({ origin: () => "http://127.0.0.1:1", identify: () => ana, modules: [agentsHttp(deps)] });
      opened.push({ close: () => app.close() });
      const call = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { host: "127.0.0.1:1" } });
      assert.equal((await call("POST", "/api/agents/hire", { template_id: "controller" })).statusCode, 201);
      assert.equal((await call("POST", "/api/agents/hire", { template_id: "controller" })).statusCode, 200);
      const created = await call("POST", "/api/agents", { name: "Rita", title: "Analista fiscal", area: "finance", focus: "Tributos e obrigações acessórias" });
      assert.equal(created.statusCode, 201);
      const rita = created.json().id;
      const moved = await call("POST", `/api/agents/${rita}`, { reports_to: "controller", instructions: "Cite a norma." });
      assert.deepEqual([moved.statusCode, moved.json().reports_to, moved.json().instructions], [200, "controller", "Cite a norma."]);
      assert.equal((await call("POST", `/api/agents/${rita}`, { reports_to: "nao_existe" })).json().code, "invalid_manager");
      assert.equal((await call("POST", `/api/agents/${rita}`, { extra: 1 })).json().code, "invalid_request");
      assert.equal((await call("GET", "/api/agents/organogram")).json().chief.reports[0].reports[0].id, rita);
      assert.equal((await call("POST", `/api/agents/${rita}/remove`)).statusCode, 200);
      assert.equal((await call("GET", "/api/agents")).json().agents.length, 1);
      assert.equal((await call("POST", "/api/setup/complete")).json().code, "setup_company_missing");
    });
  });
}
