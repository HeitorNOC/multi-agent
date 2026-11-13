/** O parecer do trabalho aberto: resumo, recomendação, achados por especialista e fontes citadas. */
import { ExternalLink, FileText } from "lucide-react";
import { ToneBadge } from "@/components/common";
import type { JobReport, OpenReport, StepsReport } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { useAgentNames } from "../agents/agent-bits";

export function ReportView({ report }: { report: JobReport }) {
  return report.kind === "steps" ? <StepsReportView report={report} /> : <OpenReportView report={report} />;
}

const STEP_STATUS: Record<StepsReport["steps"][number]["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  accepted: { label: "Aceita na revisão", tone: "success" },
  escalated: { label: "Precisa da sua decisão", tone: "warning" },
  exhausted: { label: "Tentativas esgotadas", tone: "danger" },
  skipped: { label: "Não executada", tone: "neutral" },
};

/** Etapas do plano aprovado: o que cada responsável entregou, a revisão e o que sobe para você. */
function StepsReportView({ report }: { report: StepsReport }) {
  const agentName = useAgentNames();
  const reviewer = (id: string) => (id === "chief" ? "Chief of Staff" : agentName(id));
  return (
    <div className="space-y-6">
      {report.escalations.length > 0 && (
        <section className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" aria-label="Precisa da sua decisão">
          <h3 className="text-sm font-medium">Precisa da sua decisão</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {report.escalations.map((e) => (
              <li key={e.step}>
                <span className="font-medium">Etapa {e.step + 1} — {e.title}:</span> {e.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Resumo</h3>
        <p className="leading-relaxed">{report.summary}</p>
      </section>
      {report.recommendation && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Recomendação</h3>
          <p className="leading-relaxed">{report.recommendation}</p>
        </section>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Etapas</h3>
        <ol className="space-y-3" aria-label="Etapas executadas">
          {report.steps.map((s) => (
            <li key={s.index} className={cn("rounded-lg border p-3", s.status !== "accepted" && "border-dashed")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {s.index + 1}. {s.title}
                </span>
                <ToneBadge tone={STEP_STATUS[s.status].tone}>{STEP_STATUS[s.status].label}</ToneBadge>
              </div>
              <p className="text-xs text-muted-foreground">
                {agentName(s.owner)} entregou · revisão de {reviewer(s.reviewer)} · {s.attempts} tentativa(s)
              </p>
              {s.deliverable && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-sky-600 dark:text-sky-400">Ver a entrega</summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm">{s.deliverable}</pre>
                </details>
              )}
              {s.feedback && <p className="mt-2 text-sm"><span className="font-medium">Revisão:</span> {s.feedback}</p>}
              {s.issues.length > 0 && <p className="text-xs text-muted-foreground">Pontos: {s.issues.join("; ")}</p>}
            </li>
          ))}
        </ol>
      </section>
      {report.citations.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Fontes do Cérebro usadas</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {report.citations.map((c) => (
              <li key={c.label}>
                {c.title} · v{c.version}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OpenReportView({ report }: { report: OpenReport }) {
  const agentName = useAgentNames();
  const byLabel = new Map(report.citations.map((c, i) => [c.label, { ...c, n: i + 1 }]));
  const refs = (labels: string[]) =>
    labels
      .map((l) => byLabel.get(l))
      .filter((c) => c !== undefined)
      .map((c) => (
        <a key={c.label} href={`#fonte-${c.n}`} className="ml-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400">
          [{c.n}]
        </a>
      ));

  return (
    <div className="space-y-6">
      {report.abstained && <ToneBadge tone="warning">Sem evidência suficiente no Cérebro</ToneBadge>}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Resumo</h3>
        <p className="leading-relaxed">{report.summary}</p>
      </section>
      {report.recommendation && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Recomendação</h3>
          <p className="leading-relaxed">{report.recommendation}</p>
        </section>
      )}
      {report.findings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Achados dos especialistas</h3>
          <ul className="space-y-2">
            {report.findings.map((f, i) => (
              <li key={i} className="rounded-lg border p-3 text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">{agentName(f.agent)}</span>
                {f.claim}
                {refs(f.citations)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.unknowns && report.unknowns.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">O que ficou em aberto</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {report.unknowns.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}
      {report.citations.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Fontes citadas</h3>
          <ol className="space-y-2">
            {[...byLabel.values()].map((c) => (
              <li key={c.label} id={`fonte-${c.n}`} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    [{c.n}] {c.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Versão {c.version} · vigente desde {formatDate(c.valid_from)}
                  </p>
                </div>
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400">
                  Original <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
