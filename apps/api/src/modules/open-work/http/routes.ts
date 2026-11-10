/** Rotas do worker do trabalho aberto: trechos do Cérebro e passos de modelo, com concessão. */
import { z } from "zod";
import type { HttpModule } from "../../../platform/http/app.ts";
import { authorizeWorker, type WorkerAccess } from "../../jobs/http/routes.ts";
import type { OpenWorkGateway } from "../application/gateway.ts";

const lease = z.string().min(1).max(200);
const knowledgeBody = z.object({ lease, agent: z.string().min(1).max(80) });
const modelBody = z.object({ lease, slot: z.string().min(1).max(100), labels: z.array(z.string().max(20)).max(20).optional() });

export function openWorkHttp(gateway: OpenWorkGateway, access: WorkerAccess): HttpModule {
  return (app) => {
    app.post("/internal/jobs/:id/knowledge", async (req) => {
      const body = knowledgeBody.parse(req.body);
      return gateway.retrieve(authorizeWorker(access, req, body.lease), body.agent);
    });

    app.post("/internal/jobs/:id/model", async (req) => {
      const body = modelBody.parse(req.body);
      return gateway.run(authorizeWorker(access, req, body.lease), body.slot, { labels: body.labels });
    });
  };
}
