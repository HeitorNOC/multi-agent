/** Rotas das entregas: listar, ver com histórico, aceitar, pedir ajustes e baixar em Markdown. */
import { z } from "zod";
import { JobId } from "../../../shared/ids.ts";
import { invalid } from "../../../shared/errors.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import {
  acceptDeliverable,
  deliverableForJob,
  deliverableMarkdown,
  listDeliverables,
  requestDeliverableChanges,
  viewDeliverable,
  type DeliverablesDeps,
} from "../application/deliverables.ts";
import { FEEDBACK, type DeliverableId } from "../domain/deliverable.ts";

const version = z.number().int().min(1);
const acceptBody = z.strictObject({ version });
const changesBody = z.strictObject({ version, feedback: z.string().max(FEEDBACK.max) });

const idOf = (params: unknown): DeliverableId => {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw invalid("invalid_id", "Identificador de entrega inválido");
  return id as DeliverableId;
};

export function deliverablesHttp(deps: DeliverablesDeps, options: { onJobOpened: () => void }): HttpModule {
  return (app, { actor }) => {
    app.get("/api/deliverables", async () => listDeliverables(deps));
    app.get("/api/deliverables/by-job/:job", async (req) => deliverableForJob(deps, JobId.parse((req.params as { job?: unknown }).job)));
    app.get("/api/deliverables/:id", async (req) => viewDeliverable(deps, idOf(req.params)));

    app.post("/api/deliverables/:id/accept", async (req) => acceptDeliverable(deps, actor(req), idOf(req.params), acceptBody.parse(req.body).version));

    app.post("/api/deliverables/:id/request-changes", async (req, reply) => {
      const body = changesBody.parse(req.body);
      const result = await requestDeliverableChanges(deps, actor(req), idOf(req.params), body.version, body.feedback);
      options.onJobOpened();
      return reply.code(202).send(result);
    });

    app.get("/api/deliverables/:id/versions/:version/markdown", async (req, reply) => {
      const v = z.coerce.number().int().min(1).parse((req.params as { version?: unknown }).version);
      const { filename, text } = await deliverableMarkdown(deps, idOf(req.params), v);
      return reply
        .header("content-type", "text/markdown; charset=utf-8")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(text);
    });
  };
}
