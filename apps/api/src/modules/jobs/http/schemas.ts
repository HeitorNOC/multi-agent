/** Formatos aceitos nas rotas de trabalhos. O conteúdo do pedido em si é validado pela política. */
import { z } from "zod";

const hash = z.string().min(1).max(200);

export const approveBody = z.object({ hash, crash_after_effect: z.boolean().optional() });
export const rejectBody = z.object({ hash });

/** Tudo que o worker manda vem com a concessão da execução atual. */
const fromWorker = z.object({ lease: z.string().min(1).max(200) });

export const workerPlanBody = fromWorker.extend({ plan: z.json() });
export const workerReviewBody = fromWorker.extend({ report: z.json() });
export const workerEffectBody = fromWorker.extend({ hash });
export const workerEventBody = fromWorker.extend({
  kind: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  detail: z.json(),
  event_id: z.string().regex(/^[\w:-]{8,200}$/).optional(),
});
export const workerSnapshotBody = fromWorker;
