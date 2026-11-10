/** Visão geral: o que precisa de você agora e o que está andando. Dados reais da API. */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Loader2, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { companyApi, jobsApi, type Job } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { JobStatusBadge } from "../jobs/job-status";
import { NewJobForm } from "../jobs/new-job-form";

export function CommandCenterPage() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: jobsApi.list, refetchInterval: 4000 });
  const setup = useQuery({ queryKey: ["setup"], queryFn: companyApi.setup });
  const list = jobs.data?.jobs ?? [];
  const by = (pred: (j: Job) => boolean) => list.filter(pred);
  const waiting = by((j) => j.status === "awaiting_approval");
  const moving = by((j) => j.status === "queued" || j.status === "running");
  const problems = by((j) => ["failed", "interrupted", "recovery_required"].includes(j.status));
  const done = by((j) => j.status === "completed");

  return (
    <div className="space-y-6">
      <PageHeader title="Command Center" description="O que precisa da sua decisão e o que a equipe está fazendo." />
      <ErrorNotice error={jobs.error} title="Não foi possível carregar os trabalhos" />
      {setup.data && !setup.data.completed_at && (
        <div className="flex flex-col gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Monte sua empresa</p>
            <p className="text-sm text-muted-foreground">
              Descreva a empresa, envie os primeiros documentos ao Cérebro e escolha o time.{" "}
              {setup.data.team === 0 && "Sem time, o Chief of Staff ainda não abre trabalhos."}
            </p>
          </div>
          <Button asChild>
            <Link to="/montar">Começar</Link>
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Clock} label="Aguardando você" value={waiting.length} to="/trabalhos" tone="text-warning" />
        <Stat icon={Loader2} label="Em andamento" value={moving.length} to="/trabalhos" tone="text-sky-500" />
        <Stat icon={AlertTriangle} label="Precisam de atenção" value={problems.length} to={problems.some((j) => j.status === "recovery_required") ? "/governanca" : "/trabalhos"} tone="text-destructive" />
        <Stat icon={CheckCircle2} label="Concluídos" value={done.length} to="/trabalhos" tone="text-success" />
      </div>
      <Card>
        <CardContent>
          <NewJobForm />
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <JobList title="Aguardando sua aprovação" jobs={waiting} empty="Nenhum parecer aguardando." loading={jobs.isPending} />
        <JobList title="Atividade recente" jobs={list.slice(0, 6)} empty="Nenhum trabalho ainda." loading={jobs.isPending} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, to, tone }: { icon: LucideIcon; label: string; value: number; to: string; tone: string }) {
  return (
    <Link to={to} className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50">
      <Icon className={`size-5 ${tone}`} />
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </Link>
  );
}

function JobList({ title, jobs, empty, loading }: { title: string; jobs: Job[]; empty: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingRows rows={2} />
        ) : !jobs.length ? (
          <EmptyState title={empty} />
        ) : (
          <ul className="divide-y">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link to={`/trabalhos/${j.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                  <span className="line-clamp-1 min-w-0 flex-1 text-sm">{j.goal}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{relativeTime(j.created_at)}</span>
                  <JobStatusBadge status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
