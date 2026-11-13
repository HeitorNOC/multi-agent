/** Rotas do time, da empresa e do primeiro uso. */
import { z } from "zod";
import { AgentId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { catalogView, changeAgent, completeSetup, createAgent, dismiss, getOrganization, hire, listTeam, organogram, saveOrganization, setupStatus, type AgentsDeps } from "../application/agents.ts";
import { LIMITS } from "../domain/agent.ts";
import { AGENTS_PER_JOB } from "../domain/autonomy.ts";
import { getAutonomy, saveAutonomy } from "../application/staffing.ts";
import { addFact, changeFact, listFacts, removeFact } from "../application/facts.ts";
import { addResource, changeResource, listResources, removeResource } from "../application/resources.ts";

const skills = z.array(z.string().max(LIMITS.skill)).max(LIMITS.skills);
const hireBody = z.strictObject({ template_id: z.string().min(1).max(80) });
const createBody = z.strictObject({
  name: z.string().max(LIMITS.name),
  title: z.string().max(LIMITS.title),
  area: z.string().max(40),
  focus: z.string().max(LIMITS.focus),
  tagline: z.string().max(LIMITS.tagline).optional(),
  skills: skills.optional(),
  instructions: z.string().max(LIMITS.instructions).optional(),
});
const changeBody = z.strictObject({
  name: z.string().max(LIMITS.name).optional(),
  title: z.string().max(LIMITS.title).optional(),
  focus: z.string().max(LIMITS.focus).optional(),
  tagline: z.string().max(LIMITS.tagline).optional(),
  skills: skills.optional(),
  instructions: z.string().max(LIMITS.instructions).optional(),
  reports_to: z.string().max(100).nullable().optional(),
});
const organizationBody = z.strictObject({
  name: z.string().max(120),
  sector: z.string().max(120).optional(),
  objectives: z.string().max(2000).optional(),
  policies: z.string().max(4000).optional(),
});

const autonomyBody = z.strictObject({
  hire: z.enum(["never", "propose", "auto"]).optional(),
  engagement: z.enum(["job", "permanent"]).optional(),
  max_agents: z.number().int().min(AGENTS_PER_JOB.min).max(AGENTS_PER_JOB.max).optional(),
  areas: z.array(z.string().max(40)).max(40).nullable().optional(),
  edit: z.enum(["never", "propose", "auto"]).optional(),
  remove: z.enum(["never", "propose"]).optional(),
});

/** Alçadas no formato da API (snake_case). */
const autonomyView = (a: Awaited<ReturnType<typeof getAutonomy>>) => ({
  hire: a.hire,
  engagement: a.engagement,
  max_agents: a.maxAgents,
  areas: a.areas,
  edit: a.edit,
  remove: a.remove,
});

const idOf = (params: unknown) => AgentId.parse((params as { id?: unknown }).id);

export function agentsHttp(deps: AgentsDeps): HttpModule {
  return (app, { actor }) => {
    app.get("/api/agents/catalog", async () => catalogView(deps));
    app.get("/api/agents", async () => listTeam(deps));
    app.get("/api/agents/organogram", async () => organogram(deps));

    app.post("/api/agents/hire", async (req, reply) => {
      const { agent, replayed } = await hire(deps, actor(req), hireBody.parse(req.body).template_id);
      return reply.code(replayed ? 200 : 201).send(agent);
    });

    app.post("/api/agents", async (req, reply) => reply.code(201).send(await createAgent(deps, actor(req), createBody.parse(req.body))));

    app.post("/api/agents/:id", async (req) => {
      const b = changeBody.parse(req.body);
      const { reports_to, ...rest } = b;
      const reportsTo = reports_to === undefined ? undefined : reports_to === null ? null : AgentId.parse(reports_to);
      return changeAgent(deps, actor(req), idOf(req.params), { ...rest, reportsTo });
    });

    app.post("/api/agents/:id/remove", async (req) => dismiss(deps, actor(req), idOf(req.params)));

    // Alçadas do Chief of Staff sobre o time (Configurações).
    app.get("/api/autonomy", async () => autonomyView(await getAutonomy(deps)));
    app.post("/api/autonomy", async (req) => {
      const { max_agents, ...rest } = autonomyBody.parse(req.body);
      return autonomyView(await saveAutonomy(deps, actor(req), { ...rest, ...(max_agents === undefined ? {} : { maxAgents: max_agents }) }));
    });

    // Memória da empresa (N5): fatos que todo agente recebe.
    const factBody = z.strictObject({ text: z.string().max(500), category: z.string().max(40) });
    const factId = (params: unknown) => z.string().uuid().parse((params as { id?: unknown }).id);
    app.get("/api/company/facts", async () => listFacts(deps));
    app.post("/api/company/facts", async (req, reply) => reply.code(201).send(await addFact(deps, actor(req), factBody.parse(req.body))));
    app.post("/api/company/facts/:id", async (req) => changeFact(deps, actor(req), factId(req.params), factBody.parse(req.body)));
    app.post("/api/company/facts/:id/remove", async (req) => removeFact(deps, actor(req), factId(req.params)));

    // Recursos da empresa (N6): bancos, filas, ambientes, repositórios — só descrições.
    const resourceBody = z.strictObject({ kind: z.string().max(20), name: z.string().max(80), description: z.string().max(1000) });
    app.get("/api/resources", async () => listResources(deps));
    app.post("/api/resources", async (req, reply) => reply.code(201).send(await addResource(deps, actor(req), resourceBody.parse(req.body))));
    app.post("/api/resources/:id", async (req) => changeResource(deps, actor(req), factId(req.params), resourceBody.parse(req.body)));
    app.post("/api/resources/:id/remove", async (req) => removeResource(deps, actor(req), factId(req.params)));

    app.get("/api/organization", async () => getOrganization(deps));
    app.post("/api/organization", async (req) => saveOrganization(deps, actor(req), organizationBody.parse(req.body)));

    app.get("/api/setup", async () => setupStatus(deps));
    app.post("/api/setup/complete", async (req) => completeSetup(deps, actor(req)));
  };
}
