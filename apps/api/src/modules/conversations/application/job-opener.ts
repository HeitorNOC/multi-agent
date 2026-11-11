/**
 * Liga a conversa ao módulo de trabalhos: abrir um trabalho é admitir um pedido cujo texto é a
 * mensagem do gestor, e recusas esperadas (pedido fora da política, fila cheia) viram explicação.
 */
import { AppError } from "../../../shared/errors.ts";
import { admitJob } from "../../jobs/application/admit-job.ts";
import type { JobsDeps } from "../../jobs/application/deps.ts";
import type { JobOpener } from "./conversations.ts";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, "");

export function jobOpener(jobs: JobsDeps): JobOpener {
  return {
    async open(_offerId, text, onAdmitted, attachments) {
      try {
        await admitJob(jobs, { request: { goal: text }, attachments, onAdmitted: (job, tx) => onAdmitted(job.id, tx) });
        return { opened: true };
      } catch (error) {
        if (error instanceof AppError && (error.kind === "invalid" || error.kind === "rate_limited"))
          return { opened: false, reason: lowerFirst(error.message) };
        throw error;
      }
    },
    async describe(jobId) {
      const job = await jobs.uow.read.jobs.get(jobId);
      if (!job) return undefined;
      const agents = (job.plan as { agents?: unknown } | null)?.agents;
      return { id: job.id, status: job.status, agents: Array.isArray(agents) ? (agents as string[]) : null };
    },
  };
}
