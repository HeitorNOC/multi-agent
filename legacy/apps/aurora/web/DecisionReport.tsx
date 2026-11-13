import React from "react";

interface ReportFact {
  key: string;
  label?: string;
  value: number | boolean;
  unit: string;
  sources: string[];
}

export interface Report {
  summary: string;
  facts: ReportFact[];
  risks: string[];
  conditions: string[];
}

interface DecisionReportProps {
  report: Report;
  onOpenSource: (sourceId: string) => void;
}

export function DecisionReport({ report, onOpenSource }: DecisionReportProps) {
  return (
    <section className="panel report">
      <div className="panel-title">
        <h2>Parecer integrado</h2>
        <span className="muted">Síntese real, com fontes</span>
      </div>
      <p className="summary">{report.summary}</p>
      <div className="fact-grid">
        {report.facts.map((f) => (
          <div className="fact" key={f.key}>
            <small>{f.label || f.key}</small>
            <strong>
              {typeof f.value === "boolean"
                ? f.value
                  ? "Sim"
                  : "Não"
                : Number(f.value).toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })}
              <em>{f.unit}</em>
            </strong>
            <div>
              {f.sources.map((s) => (
                <button key={s} onClick={() => onOpenSource(s)}>
                  ↗ {s.replace("aurora-", "")}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="report-columns">
        <div>
          <h3>Riscos e limites</h3>
          <ul>
            {report.risks.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Condições para avançar</h3>
          <ul>
            {report.conditions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
