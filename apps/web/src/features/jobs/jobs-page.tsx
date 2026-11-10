import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { jobsApi } from "@/lib/api";
import { relativeTime, shortId } from "@/lib/format";
import { JobStatusBadge } from "./job-status";
import { NewJobForm } from "./new-job-form";

export function JobsPage() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: jobsApi.list, refetchInterval: 3000 });
  const queue = jobs.data?.queue;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Trabalhos"
        description="Pedidos ao Chief of Staff, com o plano, o parecer citado e a sua aprovação."
        actions={
          queue && (
            <span className="text-sm text-muted-foreground">
              Fila: {queue.pending}/{queue.capacity} · executando {queue.running}/{queue.max_workers}
            </span>
          )
        }
      />
      <Card>
        <CardContent>
          <NewJobForm />
        </CardContent>
      </Card>
      <ErrorNotice error={jobs.error} title="Não foi possível carregar os trabalhos" />
      {jobs.isPending ? (
        <LoadingRows />
      ) : !jobs.data?.jobs.length ? (
        <EmptyState icon={<Briefcase />} title="Nenhum trabalho ainda">
          Descreva um pedido acima ou converse com o Chief of Staff.
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border">
          {jobs.data.jobs.map((job) => (
            <li key={job.id}>
              <Link to={`/trabalhos/${job.id}`} className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium">{job.goal}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{shortId(job.id)} · {relativeTime(job.created_at)}
                    {job.plan?.agents && ` · ${job.plan.agents.length} especialista(s)`}
                  </p>
                </div>
                <JobStatusBadge status={job.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
