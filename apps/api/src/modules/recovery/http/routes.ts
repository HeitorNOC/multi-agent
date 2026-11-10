/** Rotas da central de recuperação. */
import { z } from "zod";
import { JobId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import type { JobsDeps } from "../../jobs/application/deps.ts";
import { viewJob } from "../../jobs/application/job-view.ts";
import { authorizeRetry, closeAsUnknown, listRecoveryCases } from "../application/recovery.ts";

const reason = z.string().max(500);
const closeBody = z.strictObject({ reason });
const retryBody = z.strictObject({ reason, steps: z.array(z.string().min(1).max(100)).max(20) });
const idOf = (params: unknown) => JobId.parse((params as { id?: unknown }).id);

export function recoveryHttp(jobs: JobsDeps, options: { wake: () => void }): HttpModule {
  return (app, { actor }) => {
    app.get("/api/recovery/cases", async () => listRecoveryCases(jobs));

    app.post("/api/recovery/jobs/:id/close", async (req) => {
      const id = idOf(req.params);
      await closeAsUnknown(jobs, { jobId: id, actor: actor(req), reason: closeBody.parse(req.body).reason });
      return viewJob(jobs, id);
    });

    app.post("/api/recovery/jobs/:id/retry", async (req, reply) => {
      const id = idOf(req.params);
      const body = retryBody.parse(req.body);
      await authorizeRetry(jobs, { jobId: id, actor: actor(req), reason: body.reason, steps: body.steps });
      options.wake();
      return reply.code(202).send(await viewJob(jobs, id));
    });
  };
}
