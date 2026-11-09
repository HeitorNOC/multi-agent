import React from "react";

export interface PilotReport {
  summary: string;
  status: "supported_extracts" | "partial_evidence" | "insufficient_evidence";
  unanswered?: string[];
  citations: {
    id: string;
    source: string;
    version: number;
    line: number;
    quote: string;
    sha256: string;
  }[];
}

export function PilotSignIn({
  error,
  busy,
  onSignIn,
}: {
  error: string;
  busy: boolean;
  onSignIn: (credentials: {
    id: FormDataEntryValue | null;
    password: FormDataEntryValue | null;
  }) => void;
}) {
  return (
    <main>
      <form
        className="panel pilot-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSignIn({ id: data.get("id"), password: data.get("password") });
        }}
      >
        <h1>Piloto consultivo do Aurora</h1>
        <label>
          Identidade local <input name="id" autoComplete="username" required />
        </label>
        <label>
          Senha{" "}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          Entrar
        </button>
      </form>
    </main>
  );
}

export function PilotEvidence({ report }: { report: PilotReport }) {
  return (
    <section className="panel">
      <h2>Parecer consultivo</h2>
      <p>{report.summary}</p>
      {!!report.unanswered?.length && (
        <div>
          <h3>Sem evidência</h3>
          <ul>
            {report.unanswered.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </div>
      )}
      {report.citations.map((citation) => (
        <blockquote key={citation.id}>
          <p>{citation.quote}</p>
          <small>
            {citation.source} · versão {citation.version} · linha{" "}
            {citation.line}
          </small>
          <details>
            <summary>SHA-256 do original</summary>
            <code>{citation.sha256}</code>
          </details>
        </blockquote>
      ))}
    </section>
  );
}
