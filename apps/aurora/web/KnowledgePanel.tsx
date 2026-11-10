/**
 * Cérebro (E3): enviar fontes, acompanhar versões e vigência, e perguntar com citação.
 *
 * Cada resposta lista as citações; cada citação abre o arquivo original exatamente como foi
 * enviado. Quando não há evidência suficiente, o Cérebro diz isso em vez de responder.
 */
import React, { useCallback, useEffect, useState } from "react";
import "./knowledge.css";

type Version = { version: number; filename: string; valid_from: string; size_bytes: number; url: string };
type Source = {
  id: string;
  title: string;
  owner: string;
  readers: string[];
  status: "current" | "superseded" | "revoked" | "not_yet_valid";
  current_version: number | null;
  latest_version: number;
  superseded_by: string | null;
  versions?: Version[];
};
type Citation = { n: number; source: string; title: string; version: number; valid_from: string; excerpt: string; url: string };
type Answer = { abstained: boolean; answer: string; citations: Citation[]; decision: { engine: string; provider?: string; fallback?: string } };

const STATUS: Record<Source["status"], string> = {
  current: "Vigente",
  superseded: "Substituída",
  revoked: "Revogada",
  not_yet_valid: "Ainda não vigente",
};
const MEDIA: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json" };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || "Cérebro indisponível");
  return value as T;
}

/** Lê o arquivo escolhido e devolve os campos de envio (nome, tipo e conteúdo em base64). */
async function readFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = MEDIA[extension];
  if (!mediaType) throw Error("Formatos aceitos: .md, .txt, .csv e .json");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { filename: file.name, media_type: mediaType, content_base64: btoa(binary) };
}

const date = (iso: string) => new Date(iso).toLocaleDateString();

export function KnowledgePanel({ readOnly = false }: { readOnly?: boolean }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [title, setTitle] = useState("");
  const [readers, setReaders] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const { sources } = await call<{ sources: Source[] }>("/api/knowledge/sources");
    setSources(sources);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const upload = (form: HTMLFormElement) =>
    run(async () => {
      if (!file) throw Error("Escolha um arquivo");
      const list = readers.split(",").map((r) => r.trim()).filter(Boolean);
      await call("/api/knowledge/sources", {
        title: title.trim() || file.name,
        ...(await readFile(file)),
        ...(list.length ? { readers: list } : {}),
        ...(validFrom ? { valid_from: new Date(validFrom).toISOString() } : {}),
        ...(supersedes ? { supersedes } : {}),
      });
      setTitle("");
      setReaders("");
      setValidFrom("");
      setSupersedes("");
      setFile(null);
      form.reset(); // o seletor de arquivo não é controlado pelo React; limpa também o nome mostrado
      await refresh();
    });

  const newVersion = (id: string, chosen: File) =>
    run(async () => {
      await call(`/api/knowledge/sources/${id}/versions`, await readFile(chosen));
      await Promise.all([refresh(), open(id, true)]);
    });

  const revoke = (id: string) =>
    run(async () => {
      if (!window.confirm("Revogar esta fonte? Ela sai das respostas imediatamente; o histórico continua guardado.")) return;
      await call(`/api/knowledge/sources/${id}/revoke`, {});
      await refresh();
    });

  async function open(id: string, force = false) {
    if (expanded === id && !force) return setExpanded(null);
    const detail = await call<Source>(`/api/knowledge/sources/${id}`);
    setSources((list) => list.map((s) => (s.id === id ? detail : s)));
    setExpanded(id);
  }

  const ask = () =>
    run(async () => {
      if (!question.trim()) return;
      setAnswer(await call<Answer>("/api/knowledge/query", { question }));
    });

  const replaceable = sources.filter((s) => s.status === "current");

  return (
    <section className="panel knowledge" aria-labelledby="knowledge-title">
      <div className="panel-title">
        <div>
          <h2 id="knowledge-title">Cérebro</h2>
          <p>Fontes da empresa com versão, vigência e acesso. Toda resposta cita o arquivo original; sem evidência, o Cérebro se abstém.</p>
        </div>
      </div>

      <form
        className="knowledge-ask"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label htmlFor="knowledge-question" className="visually-hidden">
          Pergunta ao Cérebro
        </label>
        <input
          id="knowledge-question"
          value={question}
          maxLength={1000}
          placeholder="Pergunte algo às fontes vigentes…"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" disabled={busy || !question.trim()}>
          Perguntar
        </button>
      </form>

      {answer && (
        <div className={`knowledge-answer ${answer.abstained ? "abstained" : ""}`} aria-live="polite">
          <p className="knowledge-answer-text">{answer.answer}</p>
          {answer.citations.length > 0 && (
            <ol className="knowledge-citations">
              {answer.citations.map((c) => (
                <li key={c.n}>
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    [{c.n}] {c.title} · versão {c.version} · vigente desde {date(c.valid_from)}
                  </a>
                  <blockquote>{c.excerpt}</blockquote>
                </li>
              ))}
            </ol>
          )}
          <small>
            {answer.decision.engine === "model"
              ? `Redigida pelo modelo (${answer.decision.provider})`
              : answer.decision.fallback
                ? "Trechos das fontes (o modelo não pôde responder)"
                : "Trechos das fontes"}
          </small>
        </div>
      )}

      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}

      <div className="knowledge-body">
        <div className="knowledge-sources">
          <h3>Fontes ({sources.length})</h3>
          {sources.length === 0 && <p className="knowledge-empty">Nenhuma fonte ainda. Envie a primeira ao lado.</p>}
          <ul>
            {sources.map((s) => (
              <li key={s.id} className={`knowledge-source status-${s.status}`}>
                <button className="knowledge-source-head" onClick={() => open(s.id)} aria-expanded={expanded === s.id}>
                  <span>{s.title}</span>
                  <span className={`knowledge-badge status-${s.status}`}>{STATUS[s.status]}</span>
                </button>
                <small>
                  v{s.current_version ?? "—"} de {s.latest_version} · dono {s.owner} · leitores {s.readers.includes("*") ? "todos" : s.readers.join(", ")}
                </small>
                {expanded === s.id && s.versions && (
                  <div className="knowledge-detail">
                    <ul>
                      {s.versions.map((v) => (
                        <li key={v.version}>
                          <a href={v.url} target="_blank" rel="noopener noreferrer">
                            v{v.version} · {v.filename}
                          </a>{" "}
                          · vigente desde {date(v.valid_from)} · {Math.ceil(v.size_bytes / 1024)} KB
                        </li>
                      ))}
                    </ul>
                    {!readOnly && s.status !== "revoked" && (
                      <div className="knowledge-actions">
                        <label className="knowledge-file">
                          Nova versão
                          <input
                            type="file"
                            accept=".md,.markdown,.txt,.csv,.json"
                            disabled={busy}
                            onChange={(event) => event.target.files?.[0] && newVersion(s.id, event.target.files[0])}
                          />
                        </label>
                        <button className="danger" disabled={busy} onClick={() => revoke(s.id)}>
                          Revogar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {!readOnly && (
          <form
            className="knowledge-upload"
            onSubmit={(event) => {
              event.preventDefault();
              void upload(event.currentTarget);
            }}
          >
            <h3>Enviar fonte</h3>
            <label>
              Arquivo (.md, .txt, .csv, .json)
              <input type="file" accept=".md,.markdown,.txt,.csv,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <label>
              Título
              <input value={title} maxLength={200} placeholder={file?.name ?? "Política de reembolso"} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Leitores
              <input value={readers} placeholder="vazio = todos da instalação" onChange={(e) => setReaders(e.target.value)} />
            </label>
            <label>
              Vigente a partir de
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </label>
            <label>
              Substitui
              <select value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
                <option value="">— nenhuma —</option>
                {replaceable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy || !file}>
              {busy ? "Enviando…" : "Enviar"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
