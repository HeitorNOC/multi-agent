/**
 * Cartão do plano na conversa (N2): o que o Chief entendeu do pedido (brief), o que ainda falta
 * saber, as etapas com responsáveis, quem ele traz do catálogo, riscos e as fontes do Cérebro que
 * usou. Aprovar abre o trabalho com este plano; para ajustar, basta escrever na conversa.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, X } from "lucide-react";
import { Link } from "react-router";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { conversationsApi, type PlanView } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS: Record<PlanView["status"], { label: string; tone: string }> = {
  drafting: { label: "Em elaboração", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  specifying: { label: "Diretores detalhando", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  proposed: { label: "Aguardando sua aprovação", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  approved: { label: "Aprovado", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  cancelled: { label: "Cancelado", tone: "bg-muted text-muted-foreground" },
};

export function PlanCard({ conversationId, plan }: { conversationId: string; plan: PlanView }) {
  const queryClient = useQueryClient();
  const settle = (data: Awaited<ReturnType<typeof conversationsApi.approvePlan>>) => {
    queryClient.setQueryData(["conversation", conversationId], data);
    for (const key of ["conversations", "jobs", "team", "agent-activity", "organogram", "catalog", "overview"]) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const approve = useMutation({ mutationFn: () => conversationsApi.approvePlan(conversationId, plan.id, plan.version), onSuccess: settle });
  const cancel = useMutation({ mutationFn: () => conversationsApi.cancelPlan(conversationId, plan.id), onSuccess: settle });
  const open = plan.status === "drafting" || plan.status === "proposed" || plan.status === "specifying";
  const s = STATUS[plan.status];
  const b = plan.brief;
  return (
    <section className="space-y-3 rounded-lg border bg-background p-3 text-foreground" aria-label="Plano do pedido">
      <header className="flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Plano · versão {plan.version}</span>
        <span className={cn("rounded-full px-2 py-px text-[10px] font-medium uppercase tracking-wide", s.tone)}>{s.label}</span>
      </header>

      <div className="space-y-1">
        <p className="font-medium">{b.objective}</p>
        {b.deadline && <p className="text-xs text-muted-foreground">Prazo: {b.deadline}</p>}
        <Lines title="Contexto" items={b.context} />
        <Lines title="Restrições" items={b.constraints} />
        <Lines title="Pronto quando" items={b.done} />
      </div>

      {plan.questions.length > 0 && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2">
          <p className="text-xs font-medium">Antes de propor, preciso saber:</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
            {plan.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          <p className="mt-1 text-[11px] text-muted-foreground">Responda aqui na conversa.</p>
        </div>
      )}

      {plan.plan && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Etapas</p>
          <ol className="space-y-1.5" aria-label="Etapas do plano">
            {plan.plan.steps.map((step, i) => (
              <li key={`${i}-${step.title}`} className="grid grid-cols-[1.5rem_1fr] gap-1 text-sm">
                <span className="text-muted-foreground">{i + 1}.</span>
                <span>
                  <span className="font-medium">{step.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {step.owner_name} · entrega: {step.deliverable}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {plan.plan.hire_names.length > 0 && (
            <p className="text-xs">
              <span className="font-medium">Traz do catálogo:</span> {plan.plan.hire_names.join(", ")}
            </p>
          )}
          <Lines title="Recursos da empresa" items={plan.plan.resources ?? []} />
          {(plan.plan.needs?.length ?? 0) > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs" aria-label="A provisionar">
              <span className="font-medium">Precisa provisionar (sua decisão):</span>
              <ul className="mt-0.5 list-disc pl-5">
                {plan.plan.needs!.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <Lines title="Riscos" items={plan.plan.risks} />
          <Lines title="Fontes do Cérebro" items={plan.plan.references} />
        </div>
      )}

      {plan.specs.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-violet-500/30 bg-violet-500/5 p-2" aria-label="Especificação pelos diretores">
          <p className="text-xs font-medium">{plan.status === "specifying" ? "Os diretores estão detalhando a parte deles…" : "Detalhado pelos diretores"}</p>
          <ul className="space-y-1.5">
            {plan.specs.map((x) => (
              <li key={x.agent} className="text-xs">
                <span className="font-medium">{x.name}</span>{" "}
                <span className="text-muted-foreground">· {x.status === "pending" ? "detalhando…" : x.status === "failed" ? "não conseguiu agora" : "pronto"}</span>
                {x.summary && <p className="mt-0.5 text-muted-foreground">{x.summary}</p>}
                {x.requirements.length > 0 && <p className="text-muted-foreground">Requisitos: {x.requirements.join("; ")}</p>}
                {x.risks.length > 0 && <p className="text-muted-foreground">Riscos: {x.risks.join("; ")}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={plan.status !== "proposed" || approve.isPending || cancel.isPending} onClick={() => approve.mutate()}>
              <Check /> Aprovar e começar
            </Button>
            <Button size="sm" variant="outline" disabled={approve.isPending || cancel.isPending} onClick={() => cancel.mutate()}>
              <X /> Cancelar
            </Button>
            <span className="text-[11px] text-muted-foreground">Para ajustar, escreva na conversa (ex.: “tira a etapa de SEO”).</span>
          </div>
          <ErrorNotice error={approve.error ?? cancel.error} title="Não foi possível decidir agora" />
        </>
      ) : (
        plan.job_id && (
          <Link to={`/trabalhos/${plan.job_id}`} className="text-xs underline">
            Ver o trabalho
          </Link>
        )
      )}
    </section>
  );
}

function Lines({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <div className="text-xs">
      <span className="font-medium">{title}:</span>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
