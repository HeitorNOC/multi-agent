import { ToneBadge } from "@/components/common";
import type { JobStatus } from "@/lib/api";
import { JOB_STATUS } from "@/lib/format";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = JOB_STATUS[status];
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}

/** Estados em que o trabalho ainda pode mudar sozinho (a tela atualiza com mais frequência). */
export const isMoving = (status: JobStatus) => status === "queued" || status === "running";
