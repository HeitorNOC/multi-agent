/**
 * Command Center: o que precisa da sua decisão, o que está andando, o que deu errado, quanto o
 * modelo está sendo usado e o que aconteceu por último. Tudo vem de `/api/overview` (dados reais).
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Loader2, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { companyApi, overviewApi, type Overview } from "@/lib/api";
import { EVENT_LABEL, formatDateTime, relativeTime } from "@/lib/format";
import { NewJobForm } from "../jobs/new-job-form";
import { UsageChart } from "./usage-chart";

const PROBLEM: Record<string, string> = {
  quota_exhausted: "A cota da conta do modelo acabou. Os passos que dependem dele vão falhar até a cota renovar.",
  executable_unavailable: "A CLI do modelo não foi encontrada neste computador.",
  timeout: "O modelo demorou demais para responder.",
  nonzero_exit: "A CLI do modelo terminou com erro.",
  provider_reported_error: "O provedor do modelo informou um erro.",
};

const AREA: Record<keyof Overview["usage"]["by_area"], string> = { work: "Trabalhos", chief: "Conversa", knowledge: "Cérebro" };

export function CommandCenterPage() {
  const o = useQuery({ queryKey: ["overview"], queryFn: overviewApi.get, refetchInterval: 5000 });
  const setup = useQuery({ queryKey: ["setup"], queryFn: companyApi.setup });
  const data = o.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Command Center" description="O que precisa da sua decisão e o que a equipe está fazendo." />
      <ErrorNotice error={o.error} title="Não foi possível carregar o painel" />
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
      {!data ? (
        o.isPending && <LoadingRows rows={4} />
      ) : (
        <>
          {data.usage.problems.map((p) => (
            <Alert key={p.code}>
              <AlertTriangle />
              <AlertTitle>
                Modelo: {p.count} ocorrência(s) nos últimos {data.days} dias
              </AlertTitle>
              <AlertDescription>
                {PROBLEM[p.code] ?? p.code} Última: {formatDateTime(p.last_at)}.
              </AlertDescription>
            </Alert>
          ))}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={Clock} label="Aguardando você" value={data.kpis.waiting_you} to="#para-decidir" tone="text-warning" />
            <Stat icon={Loader2} label="Em andamento" value={data.kpis.in_progress} to="/trabalhos" tone="text-sky-500" />
            <Stat icon={AlertTriangle} label="Precisam de atenção" value={data.kpis.attention} to={data.decide.recovery.length ? "/governanca" : "/trabalhos"} tone="text-destructive" />
            <Stat icon={CheckCircle2} label={`Entregues em ${data.days} dias`} value={data.kpis.delivered} to="/entregas" tone="text-success" />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <Decide data={data} />
            <Card>
              <CardContent>
                <NewJobForm />
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consumo do modelo</CardTitle>
                <CardDescription>
                  {data.usage.providers.length ? `Pela CLI local (${data.usage.providers.join(", ")}). ` : ""}Dias no fuso {data.time_zone}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageChart days={data.usage.days} />
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {(Object.keys(AREA) as (keyof typeof AREA)[]).map((k) => (
                    <div key={k} className="rounded-lg border p-2">
                      <dt className="text-xs text-muted-foreground">{AREA[k]}</dt>
                      <dd className="tabular-nums">{data.usage.by_area[k].calls} chamadas</dd>
                      {data.usage.by_area[k].fallbacks > 0 && <dd className="text-xs text-muted-foreground">{data.usage.by_area[k].fallbacks} sem o modelo</dd>}
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Próximas rotinas</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {data.routines.next.length ? (
                    <ul className="space-y-2">
                      {data.routines.next.map((r) => (
                        <li key={r.id} className="flex justify-between gap-2">
                          <Link to="/rotinas" className="truncate hover:underline">
                            {r.name}
                          </Link>
                          <span className="shrink-0 text-muted-foreground">{formatDateTime(r.next_run_at)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      Nenhuma rotina ativa.{" "}
                      <Link to="/rotinas" className="underline">
                        Criar uma
                      </Link>
                    </p>
                  )}
                  {data.routines.gave_up > 0 && (
                    <p className="mt-2 text-xs text-destructive">
                      {data.routines.gave_up} execução(ões) desistiram nos últimos {data.days} dias.
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sua empresa</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2 text-center text-sm">
                  <CompanyStat to="/agentes" value={data.company.team} label="no time" />
                  <CompanyStat to="/cerebro" value={data.company.sources} label="fontes" />
                  <CompanyStat to="/integracoes" value={data.company.connections} label="conexões" />
                </CardContent>
              </Card>
            </div>
          </div>
          <Activity data={data} />
        </>
      )}
    </div>
  );
}

function CompanyStat({ to, value, label }: { to: string; value: number; label: string }) {
  return (
    <Link to={to} className="rounded-lg border p-2 hover:bg-muted/50">
      <span className="block text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </Link>
  );
}

function Stat({ icon: Icon, label, value, to, tone }: { icon: LucideIcon; label: string; value: number; to: string; tone: string }) {
  const body = (
    <>
      <Icon className={`size-5 ${tone}`} />
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </>
  );
  const cls = "rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50";
  return to.startsWith("#") ? (
    <a href={to} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {body}
    </Link>
  );
}

function Decide({ data }: { data: Overview }) {
  const items = [
    ...data.decide.recovery.map((x) => ({ key: `r-${x.id}`, to: "/governanca", title: x.title, at: x.at, badge: <ToneBadge tone="danger">Revisar na central</ToneBadge> })),
    ...data.decide.approvals.map((x) => ({ key: `a-${x.id}`, to: `/trabalhos/${x.id}`, title: x.title, at: x.at, badge: <ToneBadge tone="warning">Aprovar parecer</ToneBadge> })),
    ...data.decide.reviews.map((x) => ({ key: `d-${x.id}`, to: `/entregas/${x.id}`, title: x.title, at: x.at, badge: <ToneBadge tone="info">Revisar entrega v{x.version}</ToneBadge> })),
  ];
  return (
    <Card id="para-decidir">
      <CardHeader>
        <CardTitle className="text-base">Para decidir</CardTitle>
      </CardHeader>
      <CardContent>
        {!items.length ? (
          <EmptyState title="Nada esperando por você" />
        ) : (
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.key}>
                <Link to={i.to} className="flex flex-col gap-1 py-3 hover:opacity-80 sm:flex-row sm:items-center sm:gap-3">
                  <span className="line-clamp-1 min-w-0 flex-1 text-sm">{i.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{relativeTime(i.at)}</span>
                    {i.badge}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Para onde leva cada acontecimento da trilha. */
function linkOf(stream: string): string | undefined {
  const cut = stream.indexOf(":");
  const kind = stream.slice(0, cut);
  const id = stream.slice(cut + 1);
  if (kind === "job") return `/trabalhos/${id}`;
  if (kind === "deliverable") return `/entregas/${id}`;
  if (kind === "knowledge") return "/cerebro";
  if (kind === "agents") return "/agentes";
  if (kind === "routines") return "/rotinas";
  if (kind === "connection") return "/integracoes";
  return undefined;
}

function Activity({ data }: { data: Overview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Atividade recente</CardTitle>
      </CardHeader>
      <CardContent>
        {!data.activity.length ? (
          <EmptyState title="Nada aconteceu ainda" />
        ) : (
          <ol className="divide-y text-sm">
            {data.activity.map((e, i) => {
              const to = linkOf(e.stream);
              const text = (
                <>
                  <span className="min-w-0 flex-1">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(e.at)}</span>
                </>
              );
              return (
                <li key={`${e.at}-${i}`} className={e.kind === "action_blocked" || e.kind === "inference_unknown" ? "text-destructive" : undefined}>
                  {to ? (
                    <Link to={to} className="flex items-center gap-3 py-2 hover:opacity-80">
                      {text}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-2">{text}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
