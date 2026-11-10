/** O parecer do trabalho aberto: resumo, recomendação, achados por especialista e fontes citadas. */
import { ExternalLink, FileText } from "lucide-react";
import { ToneBadge } from "@/components/common";
import type { OpenReport } from "@/lib/api";
import { agentLabel, formatDate } from "@/lib/format";

export function ReportView({ report }: { report: OpenReport }) {
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
                <span className="mb-1 block text-xs text-muted-foreground">{agentLabel(f.agent)}</span>
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
