/**
 * Vínculo do parecer: o hash cobre o trabalho, o relatório e o conteúdo exato do efeito.
 * A aprovação humana guarda esse hash; o efeito só é executado se o parecer atual ainda
 * produzir o mesmo hash. É a mesma regra para qualquer política.
 */
import { conflict, ensure } from "../../../shared/errors.ts";
import type { JobId } from "../../../shared/ids.ts";
import { hashOf, type Json } from "../../../shared/json.ts";
import type { Job, Review } from "./job.ts";

export interface EffectPayload {
  readonly operation: string;
  readonly recipient: string;
  readonly content: string;
}

export interface BoundReview extends Review {
  readonly job: string;
  readonly report: Json;
  readonly payload: Json;
}

export function bindReview(jobId: JobId, report: Json, payload: EffectPayload): BoundReview {
  const bound = { job: jobId, report, payload: { ...payload } };
  return { ...bound, hash: hashOf(bound) };
}

/** Lança se o parecer foi alterado ou se a aprovação não é deste parecer exato. */
export function verifyApproved(job: Job, hash: string): BoundReview {
  const review = job.review as BoundReview | null;
  ensure(
    review !== null &&
      review.hash === hash &&
      job.approval === hash &&
      hashOf({ job: review.job, report: review.report, payload: review.payload }) === hash,
    () => conflict("approval_invalid", "Aprovação do parecer exato ausente ou inválida"),
  );
  return review;
}
