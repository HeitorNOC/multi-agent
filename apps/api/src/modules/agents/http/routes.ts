/** Rotas do time, da empresa e do primeiro uso. */
import { z } from "zod";
import { AgentId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { catalogView, changeAgent, completeSetup, createAgent, dismiss, getOrganization, hire, listTeam, organogram, saveOrganization, setupStatus, type AgentsDeps } from "../application/agents.ts";
import { LIMITS } from "../domain/agent.ts";

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

    app.get("/api/organization", async () => getOrganization(deps));
    app.post("/api/organization", async (req) => saveOrganization(deps, actor(req), organizationBody.parse(req.body)));

    app.get("/api/setup", async () => setupStatus(deps));
    app.post("/api/setup/complete", async (req) => completeSetup(deps, actor(req)));
  };
}
