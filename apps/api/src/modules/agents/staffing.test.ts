// N1 — composição do time e alçadas do Chief of Staff, nos dois bancos: o Chief propõe ou contrata
// quem falta na conversa, o CEO decide, quem entra só para o trabalho sai ao final, e diretor
// lidera a área. Agentes, conversa e trabalhos no mesmo banco, como em produção.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { createConversation, decideStaffing, readConversation, sendMessage, type ConversationDeps } from "../conversations/application/conversations.ts";
import { jobOpener } from "../conversations/application/job-opener.ts";
import { RuleBasedChiefOfStaff } from "../conversations/domain/chief-of-staff.ts";
import { suggestHires, type StaffingSnapshot } from "../conversations/domain/staffing.ts";
import { conversationStore } from "../conversations/infrastructure/sql-conversations.ts";
import { openWorkPolicy } from "../open-work/application/open-policy.ts";
import { dismiss, hire, listTeam, organogram, teamDirectory, type AgentsDeps } from "./application/agents.ts";
import { getAutonomy, releaseJobHires, saveAutonomy, staffingPort } from "./application/staffing.ts";
import { DEFAULT_AUTONOMY } from "./domain/autonomy.ts";
import { loadTemplates } from "./domain/template.ts";
import { agentsStore } from "./infrastructure/sql-agents.ts";

const templates = loadTemplates(fileURLToPath(new URL("../../../data/agent-templates.json", import.meta.url)));
const ceo = ActorId.parse("ceo");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const OFFERS = [{ id: "open", title: "Pedido livre", keywords: ["campanha", "promocao"] }];
const PEDIDO = "Quero uma campanha paga no Meta Ads e Google Ads, com testes de criativos, orçamento por públicos e leitura do ROAS.";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

test("catálogo: um diretor por área, com o papel de liderar e revisar", () => {
  for (const area of templates.areas) {
    const directors = templates.templates.filter((t) => t.area === area.id && t.role === "director");
    assert.equal(directors.length, 1, area.id);
    assert.ok(directors[0]!.responsibilities.some((r) => /revisa/i.test(r)), area.id);
  }
  assert.equal(templates.templates.find((t) => t.id === "tech_lead")!.role, "lead");
  assert.equal(new Set(templates.templates.map((t) => t.name)).size, templates.templates.length, "nomes únicos");
});

test("regra de cobertura: traz quem cobre o pedido melhor que o time; nunca, em 'nunca'", () => {
  const candidates = templates.templates.map((t) => ({ id: t.id, name: t.name, title: t.title, area: t.area, role: t.role, focus: t.focus, skills: t.skills }));
  const finance = candidates.find((c) => c.id === "financial_planning_analyst")!;
  const snapshot = (over: Partial<StaffingSnapshot["autonomy"]> = {}, team = [finance]): StaffingSnapshot => ({
    autonomy: { hire: "propose", engagement: "job", maxAgents: 8, ...over },
    team,
    candidates: candidates.filter((c) => !team.some((t) => t.id === c.id)),
  });
  assert.deepEqual(suggestHires(PEDIDO, snapshot()), ["paid_traffic_manager"]);
  assert.deepEqual(suggestHires(PEDIDO, snapshot({ hire: "never" })), []);
  const traffic = candidates.find((c) => c.id === "paid_traffic_manager")!;
  assert.deepEqual(suggestHires(PEDIDO, snapshot({}, [traffic])), [], "o time já cobre");
  assert.deepEqual(suggestHires("Como está o andamento?", snapshot()), [], "pouca coisa em comum: não contrata");
});

for (const dialect of dialects) {
  describe(`composição do time — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const agents: AgentsDeps = { uow: new UnitOfWork(d.db, agentsStore(clock)), catalog: templates, clock, countSources: async () => 0 };
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      const conversations: ConversationDeps = {
        uow: new UnitOfWork(d.db, conversationStore(clock)),
        chief: new RuleBasedChiefOfStaff(),
        offers: OFFERS,
        jobs: jobOpener(jobs),
        clock,
        staffing: staffingPort(agents),
      };
      await hire(agents, ceo, "financial_planning_analyst");
      const conversation = (await createConversation(conversations, ceo)).id;
      const ask = (text = PEDIDO) => sendMessage(conversations, ceo, conversation, { text });
      const jobCount = async () => (await jobs.uow.read.jobs.listRecent()).length;
      const member = async (id: string) => (await listTeam(agents)).agents.find((a) => a.id === id);
      const finish = async (jobId: string, status: "completed" | "rejected") =>
        jobs.uow.run(async (s) => s.jobs.save({ ...(await s.jobs.get(jobId as never))!, status }));
      const finished = async (ids: string[]) => {
        const all = await jobs.uow.read.jobs.listRecent(100);
        return new Set(all.filter((j) => ids.includes(j.id) && ["completed", "rejected", "closed_unknown"].includes(j.status)).map((j) => j.id));
      };
      return { agents, conversations, conversation, ask, jobCount, member, finish, finished, d };
    }

    test("padrão: o Chief propõe; aceitar contrata só para o trabalho e abre; ao terminar, sai do time", async () => {
      const { agents, conversations, conversation, ask, jobCount, member, finish, finished } = await setup();
      assert.deepEqual(await getAutonomy(agents), DEFAULT_AUTONOMY);
      const { reply } = await ask();
      assert.equal(reply.job, null, "nada aberto antes da decisão do CEO");
      assert.equal(await jobCount(), 0);
      assert.match(reply.text, /Proponho trazer Paulo|Proponho trazer .*\(Gestor de tráfego pago\) só para este trabalho/);
      assert.deepEqual([reply.staffing?.status, reply.staffing?.templates.map((t) => t.id)], ["pending", ["paid_traffic_manager"]]);
      assert.equal(await member("paid_traffic_manager"), undefined);

      const after = await decideStaffing(conversations, ceo, conversation, reply.staffing!.id, true);
      const proposal = after.messages.find((m) => m.staffing)!.staffing!;
      const confirmation = after.messages.at(-1)!;
      assert.equal(proposal.status, "accepted");
      assert.ok(confirmation.job, "a confirmação traz o trabalho aberto");
      assert.equal(proposal.job_id, confirmation.job!.id);
      assert.match(confirmation.text, /^Combinado\. Trouxe .* só para este trabalho\. Abri o trabalho/);
      const hired = (await member("paid_traffic_manager"))!;
      assert.deepEqual([hired.engagement, hired.engaged_job, hired.hired_by], ["job", confirmation.job!.id, "chief"]);
      assert.equal(await jobCount(), 1);

      // Decidir de novo não abre outro trabalho nem contrata de novo.
      const again = await decideStaffing(conversations, ceo, conversation, reply.staffing!.id, true);
      assert.equal(again.messages.length, after.messages.length);
      assert.equal(await jobCount(), 1);

      // Enquanto o trabalho anda, fica; quando termina, sai (idempotente).
      assert.deepEqual(await releaseJobHires(agents, finished), []);
      await finish(confirmation.job!.id, "completed");
      assert.deepEqual(await releaseJobHires(agents, finished), ["paid_traffic_manager"]);
      assert.deepEqual(await releaseJobHires(agents, finished), []);
      assert.equal(await member("paid_traffic_manager"), undefined);
      assert.ok(await member("financial_planning_analyst"), "quem é permanente continua");
    });

    test("seguir com o time atual abre o trabalho sem contratar", async () => {
      const { conversations, conversation, ask, jobCount, member } = await setup();
      const { reply } = await ask();
      const after = await decideStaffing(conversations, ceo, conversation, reply.staffing!.id, false);
      assert.equal(after.messages.find((m) => m.staffing)!.staffing!.status, "declined");
      assert.match(after.messages.at(-1)!.text, /^Certo, sigo com o time atual\. Abri o trabalho/);
      assert.equal(await jobCount(), 1);
      assert.equal(await member("paid_traffic_manager"), undefined);
      assert.equal(await code(decideStaffing(conversations, ActorId.parse("outra"), conversation, reply.staffing!.id, true)), "conversation_not_found");
    });

    test("contratar sozinho: entra e o trabalho abre na mesma resposta; permanente não sai ao final", async () => {
      const { agents, ask, member, finish, finished } = await setup();
      await saveAutonomy(agents, ceo, { hire: "auto" });
      const { reply } = await ask();
      assert.ok(reply.job);
      assert.equal(reply.staffing, null);
      assert.match(reply.text, /Trouxe .*\(Gestor de tráfego pago\) só para este trabalho\.$/);
      assert.equal((await member("paid_traffic_manager"))!.engaged_job, reply.job!.id);

      await saveAutonomy(agents, ceo, { engagement: "permanent" });
      await dismiss(agents, ceo, "paid_traffic_manager" as never);
      const second = (await ask()).reply;
      assert.deepEqual([(await member("paid_traffic_manager"))!.engagement, (await member("paid_traffic_manager"))!.engaged_job], ["permanent", null]);
      await finish(second.job!.id, "completed");
      assert.deepEqual(await releaseJobHires(agents, finished), []);
    });

    test("nunca, ou fora das áreas permitidas: abre com o time atual, sem proposta", async () => {
      const { agents, ask, member } = await setup();
      await saveAutonomy(agents, ceo, { areas: ["finance", "legal"] });
      const limited = (await ask()).reply;
      assert.ok(limited.job);
      assert.equal(limited.staffing, null);
      await saveAutonomy(agents, ceo, { hire: "never", areas: null });
      const never = (await ask()).reply;
      assert.ok(never.job);
      assert.equal(never.staffing, null);
      assert.equal(await member("paid_traffic_manager"), undefined);
    });

    test("o CEO contratar quem estava só no trabalho o torna permanente", async () => {
      const { agents, conversations, conversation, ask, member } = await setup();
      const { reply } = await ask();
      await decideStaffing(conversations, ceo, conversation, reply.staffing!.id, true);
      assert.equal((await member("paid_traffic_manager"))!.engagement, "job");
      await hire(agents, ceo, "paid_traffic_manager");
      assert.deepEqual([(await member("paid_traffic_manager"))!.engagement, (await member("paid_traffic_manager"))!.engaged_job], ["permanent", null]);
      assert.ok((await readConversation(conversations, ceo, conversation)).messages.length >= 3);
    });

    test("diretor lidera a área: quem já estava passa a responder a ele, e quem chega também", async () => {
      const { agents, member } = await setup();
      await hire(agents, ceo, "copywriter");
      await hire(agents, ceo, "director_marketing");
      assert.equal((await member("copywriter"))!.reports_to, "director_marketing");
      assert.equal((await member("director_marketing"))!.role, "director");
      await hire(agents, ceo, "social_media_manager");
      assert.equal((await member("social_media_manager"))!.reports_to, "director_marketing");
      assert.equal((await member("financial_planning_analyst"))!.reports_to, null, "outras áreas não mudam");
      const org = await organogram(agents);
      const director = org.chief.reports.find((n) => n.id === "director_marketing")!;
      assert.deepEqual([director.role, director.reports.map((r) => r.id).sort()], ["director", ["copywriter", "social_media_manager"]]);
      // Sai o diretor: o time dele volta a responder a quem ele respondia.
      await dismiss(agents, ceo, "director_marketing" as never);
      assert.equal((await member("copywriter"))!.reports_to, null);
    });

    test("alçadas: validação, e o limite de agentes por trabalho vale para o plano", async () => {
      const { agents } = await setup();
      assert.equal(await code(saveAutonomy(agents, ceo, { hire: "sempre" })), "invalid_hire_mode");
      assert.equal(await code(saveAutonomy(agents, ceo, { maxAgents: 0 })), "invalid_max_agents");
      assert.equal(await code(saveAutonomy(agents, ceo, { areas: ["inexistente"] })), "invalid_areas");
      assert.equal(await code(saveAutonomy(agents, ceo, { remove: "auto" })), "invalid_remove_mode");
      const saved = await saveAutonomy(agents, ceo, { maxAgents: 4, edit: "never" });
      assert.deepEqual([saved.maxAgents, saved.edit, saved.hire], [4, "never", "propose"]);
      assert.deepEqual(await getAutonomy(agents), saved, "guardado");

      for (const t of ["copywriter", "social_media_manager", "seo_specialist", "brand_designer"]) await hire(agents, ceo, t);
      const policy = openWorkPolicy(teamDirectory(agents.uow, templates));
      const plan = async (ids: string[]) => (await policy.plan({ agents: ids, reason: "Cobrir as frentes da campanha." }, {} as never)) as { agents: string[] };
      assert.equal((await plan(["copywriter", "social_media_manager", "seo_specialist", "brand_designer"])).agents.length, 4);
      assert.equal(await code(plan(["copywriter", "social_media_manager", "seo_specialist", "brand_designer", "financial_planning_analyst"])), "invalid_plan");
    });
  });
}
