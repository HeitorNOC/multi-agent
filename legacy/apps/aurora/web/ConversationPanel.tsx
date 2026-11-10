/**
 * Conversa com o Chief of Staff (E2).
 *
 * O gestor escreve um pedido; o Chief of Staff responde ou abre um trabalho. Cada resposta
 * que abriu trabalho mostra o estado atual e as capacidades acionadas, e leva ao trabalho.
 * Um envio que falhou por rede é repetido com o mesmo `client_message_id`, então não duplica.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { statusText } from "./job-status.ts";
import "./conversation.css";

type JobRef = { id: string; status: string; capabilities: string[] | null };
type Decision = { engine: string; provider?: string; fallback?: string };
type Message = { seq: number; role: "user" | "chief"; text: string; created: string; job: JobRef | null; decision: Decision | null };
type Summary = { id: string; title: string; updated: string; message_count: number };
type Pending = { text: string; clientId: string };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(value.error || "Conversa indisponível"), { status: response.status });
  return value as T;
}

const FALLBACK: Record<string, string> = {
  quota_exhausted: "a cota da conta do modelo acabou",
  timeout: "o modelo demorou demais",
  nonzero_exit: "a CLI do modelo falhou",
  executable_unavailable: "a CLI do modelo não foi encontrada",
  model_busy: "muitas consultas ao modelo ao mesmo tempo",
  offer_not_in_catalog: "o modelo propôs algo fora do catálogo",
};
/** Quem decidiu a resposta; quando o modelo foi trocado pelas regras, diz por quê. */
function decidedBy(d: Decision | null) {
  if (!d) return "";
  if (d.engine === "model") return ` · por modelo${d.provider ? ` (${d.provider})` : ""}`;
  if (d.fallback && d.fallback !== "no_offers")
    return ` · por regras: ${FALLBACK[d.fallback] ?? "resposta do modelo inválida"}`;
  return " · por regras";
}
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const MAX_TEXT = 2000;
const REFRESH_MS = 3000;

export function ConversationPanel({
  onOpenJob,
  readOnly = false,
}: {
  /** Leva o usuário ao trabalho na área de decisão. */
  onOpenJob?: (jobId: string) => void;
  /** Perfis sem permissão de escrita podem ler, mas não enviar. */
  readOnly?: boolean;
}) {
  const [list, setList] = useState<Summary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const thread = useRef<HTMLOListElement>(null);

  const loadList = useCallback(async () => {
    const { conversations } = await call<{ conversations: Summary[] }>("/api/conversations");
    setList(conversations);
    return conversations;
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const { messages } = await call<{ messages: Message[] }>(`/api/conversations/${id}`);
    setMessages(messages);
  }, []);

  useEffect(() => {
    loadList()
      .then((items) => items[0] && setCurrent((c) => c ?? items[0].id))
      .catch((e) => setError(e.message));
  }, [loadList]);

  // O estado dos trabalhos muda no servidor; a conversa aberta é relida periodicamente.
  useEffect(() => {
    if (!current) return;
    loadThread(current).catch((e) => setError(e.message));
    const timer = setInterval(() => loadThread(current).catch(() => {}), REFRESH_MS);
    return () => clearInterval(timer);
  }, [current, loadThread]);

  useEffect(() => {
    thread.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function newConversation() {
    setError("");
    try {
      const { id } = await call<{ id: string }>("/api/conversations", {});
      setCurrent(id);
      setMessages([]);
      await loadList();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(retry?: Pending) {
    const text = retry?.text ?? draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    const attempt = retry ?? { text, clientId: crypto.randomUUID() };
    setPending(attempt);
    try {
      let id = current;
      if (!id) {
        id = (await call<{ id: string }>("/api/conversations", {})).id;
        setCurrent(id);
      }
      await call(`/api/conversations/${id}/messages`, { text: attempt.text, client_message_id: attempt.clientId });
      setPending(null);
      setDraft("");
      await Promise.all([loadThread(id), loadList()]);
    } catch (e) {
      // Mantém o envio pendente: "Tentar de novo" reutiliza o mesmo client_message_id.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <section className="panel conversation" aria-labelledby="conversation-title">
      <div className="panel-title">
        <div>
          <h2 id="conversation-title">Conversa com o Chief of Staff</h2>
          <p>Peça um trabalho ou pergunte o andamento. Pedidos fora do catálogo são explicados, não inventados.</p>
        </div>
        <button className="conversation-new" onClick={newConversation} disabled={readOnly}>
          Nova conversa
        </button>
      </div>

      <div className="conversation-body">
        <nav className="conversation-list" aria-label="Conversas">
          {list.length === 0 && <p className="conversation-empty">Nenhuma conversa ainda.</p>}
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button
                  className={c.id === current ? "active" : ""}
                  aria-current={c.id === current ? "true" : undefined}
                  onClick={() => setCurrent(c.id)}
                >
                  <span>{c.title}</span>
                  <small>
                    {c.message_count} mensagens · {time(c.updated)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="conversation-thread">
          <ol ref={thread} aria-live="polite" aria-label="Mensagens">
            {messages.length === 0 && !pending && (
              <li className="conversation-empty">Descreva um pedido ou pergunte “o que você consegue fazer?”.</li>
            )}
            {messages.map((m) => (
              <li key={m.seq} className={`message ${m.role}`}>
                <div className="message-meta">
                  {m.role === "chief" ? "Chief of Staff" : "Você"} · {time(m.created)}
                  {m.role === "chief" && decidedBy(m.decision)}
                </div>
                <p>{m.text}</p>
                {m.job && (
                  <div className="message-job">
                    <span className={`job-status status-${m.job.status}`}>{statusText[m.job.status] ?? m.job.status}</span>
                    <span className="job-routing">
                      {m.job.capabilities?.length
                        ? `Encaminhado a: ${m.job.capabilities.join(", ")}`
                        : "Aguardando o plano do Chief of Staff"}
                    </span>
                    {onOpenJob && (
                      <button className="link" onClick={() => onOpenJob(m.job!.id)}>
                        Abrir trabalho
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {pending && busy && (
              <li className="message user sending">
                <div className="message-meta">Você · enviando…</div>
                <p>{pending.text}</p>
              </li>
            )}
          </ol>

          {error && (
            <div role="alert" className="error conversation-error">
              {error}
              {pending && !busy && (
                <button className="link" onClick={() => send(pending)}>
                  Tentar de novo
                </button>
              )}
            </div>
          )}

          <form
            className="conversation-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="conversation-input" className="visually-hidden">
              Mensagem para o Chief of Staff
            </label>
            <textarea
              id="conversation-input"
              rows={2}
              maxLength={MAX_TEXT}
              value={draft}
              disabled={readOnly || busy}
              placeholder={readOnly ? "Seu perfil pode apenas ler as conversas." : "Escreva um pedido… (Enter envia, Shift+Enter quebra linha)"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" disabled={readOnly || busy || !draft.trim()}>
              {busy ? "Enviando…" : "Enviar"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
