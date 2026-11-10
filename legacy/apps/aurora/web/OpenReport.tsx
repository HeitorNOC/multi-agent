/**
 * Parecer do trabalho aberto: resumo, recomendação, achados de cada especialista com as
 * citações (que abrem o arquivo original no Cérebro) e o que não pôde ser confirmado.
 */
import React from "react";

export type OpenCitation = { label: string; source: string; title: string; version: number; valid_from: string; url: string };
export type OpenReportData = {
  kind: "open";
  abstained: boolean;
  summary: string;
  recommendation: string;
  plan_reason?: string;
  findings: { agent: string; claim: string; citations: string[] }[];
  citations: OpenCitation[];
  unknowns: string[];
};

export function OpenReport({ report, agentName }: { report: OpenReportData; agentName: (id: string) => string | undefined }) {
  const byLabel = new Map(report.citations.map((c) => [c.label, c]));
  const number = new Map(report.citations.map((c, i) => [c.label, i + 1]));
  const cite = (label: string) => {
    const c = byLabel.get(label);
    return c ? (
      <a key={label} href={c.url} target="_blank" rel="noopener noreferrer" title={`${c.title} · versão ${c.version}`}>
        [{number.get(label)}]
      </a>
    ) : null;
  };
  return (
    <section className="panel report open-report" aria-labelledby="open-report-title">
      <div className="panel-title">
        <h2 id="open-report-title">Parecer dos especialistas</h2>
        <span className="muted">{report.abstained ? "Abstenção: evidência insuficiente" : "Com citações do Cérebro"}</span>
      </div>
      <p className="summary">{report.summary}</p>
      {report.recommendation && (
        <>
          <h3>Recomendação</h3>
          <p>{report.recommendation}</p>
        </>
      )}
      {report.findings.length > 0 && (
        <>
          <h3>Achados</h3>
          <ul className="open-findings">
            {report.findings.map((f, i) => (
              <li key={i}>
                <small>{agentName(f.agent) ?? f.agent}</small>
                <span>
                  {f.claim} {f.citations.map(cite)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.unknowns.length > 0 && (
        <>
          <h3>Não confirmado pelas fontes</h3>
          <ul className="open-unknowns">
            {report.unknowns.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </>
      )}
      {report.citations.length > 0 && (
        <>
          <h3>Fontes citadas</h3>
          <ol className="open-sources">
            {report.citations.map((c) => (
              <li key={c.label}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.title} · versão {c.version} · vigente desde {new Date(c.valid_from).toLocaleDateString()}
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
      {report.plan_reason && <p className="muted">Por que estes especialistas: {report.plan_reason}</p>}
    </section>
  );
}
