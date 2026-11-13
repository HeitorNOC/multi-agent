import { notFound } from "../../../shared/errors.ts";
import type { JobId } from "../../../shared/ids.ts";
import type { Job } from "../domain/job.ts";
import type { JobRepository } from "../domain/repositories.ts";

/** Lê o trabalho ou lança `not_found`. */
export async function loadJob(jobs: JobRepository, id: JobId): Promise<Job> {
  const job = await jobs.get(id);
  if (!job) throw notFound("job_not_found", "Trabalho não encontrado");
  return job;
}
