/** Detalhe do trabalho: o que foi pedido, quem trabalha, o parecer e a decisão do gestor. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, PackageCheck, RotateCcw, ShieldAlert, X } from "lucide-react";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deliverablesApi, jobsApi, type Job } from "@/lib/api";
import { EVENT_LABEL, formatDateTime, shortId } from "@/lib/format";
import { isMoving, JobStatusBadge } from "./job-status";
import { ReportView } from "./report-view";
import { useAgentNames } from "../agents/agent-bits";

export function JobDetailPage() {
  const agentName = useAgentNames();
  const { id = "" } = useParams();
  const job = useQuery({
    queryKey: ["job", id],
    queryFn: () => jobsApi.get(id),
    refetchInterval: (q) => (q.state.data && (isMoving(q.state.data.status) || q.state.data.worker_active) ? 1500 : 6000),
  });

  if (job.isPending) return <LoadingRows rows={4} />;
  if (job.error) return <ErrorNotice error={job.error} title="Trabalho não encontrado" />;
  const j = job.data;
  return (
    <div className="space-y-6">
      <Link to="/trabalhos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Trabalhos
      </Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusBadge status={j.status} />
          {j.worker_active && (
            <ToneBadge tone="info">
              <Loader2 className="animate-spin" /> trabalhando
            </ToneBadge>
          )}
          <span className="text-xs text-muted-foreground">
            #{shortId(j.id)} · {formatDateTime(j.created_at)}
          </span>
        </div>
        <h1 className="text-xl font-semibold leading-snug">{j.goal}</h1>
        {j.error && <p className="text-sm text-destructive">{j.error}</p>}
      </div>

      <Decision job={j} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Parecer</CardTitle>
            <CardDescription>Afirmações citam somente fontes do Cérebro entregues a este trabalho.</CardDescription>
          </CardHeader>
          <CardContent>
            {j.review ? (
              <ReportView report={j.review.report} />
            ) : (
              <EmptyState title={isMoving(j.status) ? "Os especialistas estão trabalhando" : "Sem parecer"}>
                {isMoving(j.status) ? "O parecer aparece aqui quando estiver pronto para sua aprovação." : "Este trabalho terminou sem parecer."}
              </EmptyState>
            )}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Plano</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {j.plan?.agents ? (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {j.plan.agents.map((a) => (
                      <li key={a} className="rounded-md bg-muted px-2 py-1 text-xs">
                        {agentName(a)}
                      </li>
                    ))}
                  </ul>
                  {j.plan.reason && <p className="text-muted-foreground">{j.plan.reason}</p>}
                </>
              ) : (
                <p className="text-muted-foreground">O Chief of Staff ainda não definiu o plano.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Trilha</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {j.events.map((e) => (
                  <li key={e.seq} className="flex gap-2">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">{formatDateTime(e.at).split(" ")[1]}</span>
                    <span>{EVENT_LABEL[e.kind] ?? e.kind}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Ações do gestor conforme o estado: aprovar/rejeitar o parecer exato, retomar ou revisar. */
function Decision({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["job", job.id] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };
  const approve = useMutation({ mutationFn: () => jobsApi.approve(job.id, job.review!.hash), onSuccess: refresh });
  const reject = useMutation({ mutationFn: () => jobsApi.reject(job.id, job.review!.hash), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => jobsApi.resume(job.id), onSuccess: refresh });
  // Trabalhos concluídos ou de revisão apontam para a entrega (404 quando não há).
  const deliverable = useQuery({ queryKey: ["deliverable-of", job.id, job.status], queryFn: () => deliverablesApi.byJob(job.id), retry: false });
  const busy = approve.isPending || reject.isPending || resume.isPending || job.worker_active;
  const error = approve.error ?? reject.error ?? resume.error;

  let body = null;
  if (job.status === "awaiting_approval" && job.review)
    body = (
      <>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Sua aprovação libera a entrega</p>
          <p className="text-sm text-muted-foreground">
            Entrega para <b>{job.review.payload.recipient}</b>: “{job.review.payload.content}”
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => reject.mutate()}>
            <X /> Rejeitar
          </Button>
          <Button disabled={busy} onClick={() => approve.mutate()}>
            <Check /> Aprovar
          </Button>
        </div>
      </>
    );
  else if (job.status === "interrupted" || job.status === "failed")
    body = (
      <>
        <p className="min-w-0 flex-1 text-sm">Retomar continua do último passo salvo; passos com recibo não chamam o modelo de novo.</p>
        <Button disabled={busy} onClick={() => resume.mutate()}>
          <RotateCcw /> Retomar
        </Button>
      </>
    );
  else if (job.status === "recovery_required")
    body = (
      <>
        <ShieldAlert className="size-5 text-destructive" />
        <p className="min-w-0 flex-1 text-sm">Algo ficou sem confirmação. Uma pessoa precisa decidir na central de recuperação.</p>
        <Button asChild variant="outline">
          <Link to="/governanca">Abrir a central</Link>
        </Button>
      </>
    );
  else if (job.status === "completed" && job.receipt)
    body = (
      <>
        <p className="min-w-0 flex-1 text-sm">Entregue uma única vez. Recibo {shortId(job.receipt.id)}.</p>
        {deliverable.data && (
          <Button asChild variant="outline">
            <Link to={`/entregas/${deliverable.data.id}`}>
              <PackageCheck /> Ver entrega{deliverable.data.version ? ` v${deliverable.data.version}` : ""}
            </Link>
          </Button>
        )}
      </>
    );
  if (!body && deliverable.data?.revision_of)
    body = (
      <p className="text-sm">
        Revisão da{" "}
        <Link to={`/entregas/${deliverable.data.id}`} className="underline">
          entrega
        </Link>{" "}
        (ajustes pedidos sobre a v{deliverable.data.revision_of}).
      </p>
    );
  if (!body) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">{body}</div>
      <ErrorNotice error={error} />
    </div>
  );
}
