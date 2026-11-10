/**
 * Conversa com o Chief of Staff. Cada envio tem um `client_message_id`: se a rede falhar, reenviar
 * a mesma mensagem não duplica a pergunta nem o trabalho aberto.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, MessageSquarePlus, MessagesSquare, Send } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { conversationsApi, newKey, type Message } from "@/lib/api";
import { agentLabel, relativeTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JobStatusBadge } from "../jobs/job-status";

export function ConversationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["conversations"], queryFn: conversationsApi.list });
  const create = useMutation({
    mutationFn: () => conversationsApi.create(),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void navigate(`/conversa/${c.id}`);
    },
  });

  return (
    <div className="grid h-[calc(100dvh-7rem)] gap-4 md:grid-cols-[240px_1fr]">
      <aside className={cn("flex min-h-0 flex-col gap-2", id && "hidden md:flex")}>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          <MessageSquarePlus /> Nova conversa
        </Button>
        <ErrorNotice error={list.error ?? create.error} />
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {list.data?.conversations.map((c) => (
            <Link
              key={c.id}
              to={`/conversa/${c.id}`}
              className={cn("block rounded-lg px-3 py-2 text-sm hover:bg-muted", c.id === id && "bg-muted font-medium")}
            >
              <span className="line-clamp-1">{c.title}</span>
              <span className="text-xs text-muted-foreground">
                {c.message_count} mensagens · {relativeTime(c.updated_at)}
              </span>
            </Link>
          ))}
        </nav>
      </aside>
      <section className={cn("flex min-h-0 flex-col rounded-xl border", !id && "hidden md:flex")}>
        {id ? (
          <Thread id={id} />
        ) : (
          <div className="m-auto p-6">
            <EmptyState icon={<MessagesSquare />} title="Converse com o Chief of Staff">
              Peça análises, propostas ou o andamento de um trabalho. Quando o pedido exigir especialistas, ele abre um trabalho e o parecer volta para sua aprovação.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}

function Thread({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const thread = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => conversationsApi.read(id),
    // Enquanto um trabalho aberto aqui estiver andando, o estado do cartão atualiza.
    refetchInterval: (q) => (q.state.data?.messages.some((m) => m.job && ["queued", "running"].includes(m.job.status)) ? 3000 : false),
  });
  const [text, setText] = useState("");
  const [clientId, setClientId] = useState(newKey);
  const end = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: (message: string) => conversationsApi.send(id, message, clientId),
    onSuccess: () => {
      setText("");
      setClientId(newKey());
      void queryClient.invalidateQueries({ queryKey: ["conversation", id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const count = thread.data?.messages.length ?? 0;
  useEffect(() => {
    // Corpo em bloco: navegadores novos devolvem uma Promise em scrollIntoView, e o React trataria
    // o valor devolvido como função de limpeza.
    end.current?.scrollIntoView({ block: "end" });
  }, [count, send.isPending]);

  if (thread.error) return <div className="p-4"><ErrorNotice error={thread.error} title="Conversa não encontrada" /></div>;
  const submit = () => {
    const message = text.trim();
    if (message && !send.isPending) send.mutate(message);
  };
  return (
    <>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Link to="/conversa" className="text-sm text-muted-foreground md:hidden">
          ←
        </Link>
        <h2 className="line-clamp-1 font-medium">{thread.data?.conversation.title ?? "Conversa"}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {thread.isPending ? <LoadingRows /> : thread.data!.messages.map((m) => <Bubble key={m.seq} message={m} />)}
        {send.isPending && (
          <>
            <Bubble message={{ seq: -1, role: "user", text: send.variables ?? "", created_at: new Date().toISOString(), reply_to: null, job: null, decision: null }} />
            <p className="text-sm text-muted-foreground">O Chief of Staff está pensando…</p>
          </>
        )}
        <div ref={end} />
      </div>
      <form
        className="space-y-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ErrorNotice error={send.error} title="Mensagem não enviada; tente de novo (não vai duplicar)" />
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            maxLength={2000}
            rows={2}
            placeholder="Escreva para o Chief of Staff…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button type="submit" size="icon" aria-label="Enviar" disabled={!text.trim() || send.isPending}>
            <Send />
          </Button>
        </div>
      </form>
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex gap-2", mine && "justify-end")}>
      {!mine && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
          <Bot className="size-4" />
        </div>
      )}
      <div className={cn("max-w-[85%] space-y-2 rounded-2xl px-4 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.job && (
          <Link to={`/trabalhos/${message.job.id}`} className="block rounded-lg border bg-background p-3 text-foreground hover:bg-muted/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Trabalho #{shortId(message.job.id)}</span>
              <JobStatusBadge status={message.job.status} />
            </div>
            {message.job.agents && <p className="mt-2 text-xs">{message.job.agents.map(agentLabel).join(" · ")}</p>}
          </Link>
        )}
        {message.decision?.fallback && <p className="text-[11px] text-muted-foreground">Decidido por regras ({message.decision.fallback})</p>}
      </div>
    </div>
  );
}
