/**
 * Conversa com o Chief of Staff ou, na Estação, direto com um agente do time. Cada envio tem um
 * `client_message_id`: se a rede falhar, reenviar a mesma mensagem não duplica a pergunta nem o
 * trabalho aberto.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, ExternalLink, MessageSquarePlus, MessagesSquare, Paperclip, Send, UserPlus, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { conversationsApi, fileToBase64, newKey, type Agent, type Message, type StaffingProposal } from "@/lib/api";
import { acceptOf, mediaTypeOf } from "../knowledge/upload-dialog";
import { relativeTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JobStatusBadge } from "../jobs/job-status";
import { AgentAvatar, useAgentNames, useTeamMap } from "../agents/agent-bits";

export function ConversationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["conversations"], queryFn: conversationsApi.list });
  const team = useTeamMap();
  const create = useMutation({
    mutationFn: () => conversationsApi.create(),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void navigate(`/conversa/${c.id}`);
    },
  });

  return (
    <div className="grid h-[calc(100dvh-7rem)] gap-4 md:grid-cols-[260px_1fr]">
      {/* Título da área para leitores de tela (a tela já mostra o título de cada conversa). */}
      <h1 className="sr-only">Conversa</h1>
      <aside className={cn("flex min-h-0 flex-col gap-2", id && "hidden md:flex")}>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          <MessageSquarePlus /> Nova conversa
        </Button>
        <ErrorNotice error={list.error ?? create.error} />
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {list.data?.conversations.map((c) => {
            const agent = c.agent_id ? team.get(c.agent_id) : undefined;
            return (
              <Link
                key={c.id}
                to={`/conversa/${c.id}`}
                className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted", c.id === id && "bg-muted font-medium")}
              >
                {agent && <AgentAvatar name={agent.name} area={agent.area} size="sm" />}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1">{c.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.agent_id ? "Estação · " : ""}
                    {c.message_count} mensagens · {relativeTime(c.updated_at)}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className={cn("flex min-h-0 flex-col rounded-xl border", !id && "hidden md:flex")}>
        {id ? (
          <Thread id={id} />
        ) : (
          <div className="m-auto p-6">
            <EmptyState icon={<MessagesSquare />} title="Converse com o Chief of Staff">
              Peça análises, propostas ou o andamento de um trabalho. Quando o pedido exigir especialistas, ele abre um trabalho e o parecer volta para sua aprovação. Para falar direto com um
              especialista, abra a Estação dele em Agentes.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}

/** Uma conversa: mensagens e envio. `embedded` tira a navegação da página (usado no Jarvis). */
export function Thread({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const thread = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => conversationsApi.read(id),
    // Enquanto um trabalho aberto aqui estiver andando, o estado do cartão atualiza.
    refetchInterval: (q) => (q.state.data?.messages.some((m) => m.job && ["queued", "running"].includes(m.job.status)) ? 3000 : false),
  });
  const team = useTeamMap();
  const agentId = thread.data?.conversation.agent_id ?? null;
  const agent = agentId ? team.get(agentId) : undefined;
  const who = agentId ? (agent?.name ?? "O agente") : "o Chief of Staff";
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [clientId, setClientId] = useState(newKey);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: async (message: string) =>
      conversationsApi.send(
        id,
        message,
        clientId,
        await Promise.all(files.map(async (f) => ({ filename: f.name, media_type: mediaTypeOf(f), content_base64: await fileToBase64(f) }))),
      ),
    onSuccess: () => {
      setText("");
      setFiles([]);
      setClientId(newKey());
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
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

  if (thread.error)
    return (
      <div className="p-4">
        <ErrorNotice error={thread.error} title="Conversa não encontrada" />
      </div>
    );
  const submit = () => {
    const message = text.trim();
    if (message && !send.isPending) send.mutate(message);
  };
  return (
    <>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {!embedded && (
          <Link to="/conversa" className="text-sm text-muted-foreground md:hidden">
            ←
          </Link>
        )}
        {agent && <AgentAvatar name={agent.name} area={agent.area} size="sm" />}
        <div className="min-w-0">
          <h2 className="line-clamp-1 font-medium">{thread.data?.conversation.title ?? "Conversa"}</h2>
          {agentId && <p className="text-xs text-muted-foreground">Responde só com as fontes do Cérebro que pode ler, citando cada uma.</p>}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {thread.isPending ? <LoadingRows /> : thread.data!.messages.map((m) => <Bubble key={m.seq} message={m} agent={agent} conversationId={id} />)}
        {send.isPending && (
          <>
            <Bubble
              message={{
                seq: -1,
                role: "user",
                text: send.variables ?? "",
                created_at: new Date().toISOString(),
                reply_to: null,
                citations: null,
                attachments: files.map((f) => ({ source: f.name, title: f.name })),
                job: null,
                decision: null,
                staffing: null,
              }}
            />
            <p className="text-sm text-muted-foreground">
              {files.length ? "Lendo os anexos e guardando no Cérebro…" : agentId ? `${who} está consultando o Cérebro…` : "O Chief of Staff está pensando…"}
            </p>
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
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Anexos">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                <Paperclip className="size-3" /> <span className="max-w-40 truncate">{f.name}</span>
                <button type="button" aria-label={`Tirar ${f.name}`} className="text-muted-foreground hover:text-foreground" disabled={send.isPending} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={acceptOf([])}
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              setFiles((l) => [...l, ...picked].slice(0, 4));
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Anexar imagem ou documento"
            title="Anexar imagem ou documento (vai para o Cérebro)"
            disabled={send.isPending || files.length >= 4}
            onClick={() => picker.current?.click()}
          >
            <Paperclip />
          </Button>
          <Textarea
            value={text}
            maxLength={2000}
            rows={2}
            placeholder={`Escreva para ${who}…`}
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

function Bubble({ message, agent, conversationId }: { message: Message; agent?: Agent; conversationId?: string }) {
  const agentName = useAgentNames();
  const mine = message.role === "user";
  return (
    <div className={cn("flex gap-2", mine && "justify-end")}>
      {!mine &&
        (agent ? (
          <AgentAvatar name={agent.name} area={agent.area} size="sm" />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
            <Bot className="size-4" />
          </div>
        ))}
      <div className={cn("max-w-[85%] space-y-2 rounded-2xl px-4 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.attachments && message.attachments.length > 0 && (
          <ul className={cn("flex flex-wrap gap-1 text-xs", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {message.attachments.map((a) => (
              <li key={a.source} className="inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5">
                <Paperclip className="size-3" /> {a.title}
              </li>
            ))}
          </ul>
        )}
        {message.staffing && conversationId && <StaffingCard conversationId={conversationId} proposal={message.staffing} />}
        {message.job && (
          <Link to={`/trabalhos/${message.job.id}`} className="block rounded-lg border bg-background p-3 text-foreground hover:bg-muted/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Trabalho #{shortId(message.job.id)}</span>
              <JobStatusBadge status={message.job.status} />
            </div>
            {message.job.agents && <p className="mt-2 text-xs">{message.job.agents.map(agentName).join(" · ")}</p>}
          </Link>
        )}
        {message.citations && message.citations.length > 0 && (
          <ol className="space-y-1 border-t pt-2 text-xs">
            {message.citations.map((c) => (
              <li key={c.n} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  [{c.n}] {c.title} · v{c.version}
                </span>
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sky-600 hover:underline dark:text-sky-400">
                  Original <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ol>
        )}
        {message.decision?.fallback && (
          <p className="text-[11px] text-muted-foreground">
            {agent ? "Resposta extraída dos trechos" : "Decidido por regras"} ({message.decision.fallback})
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Proposta de contratação do Chief: quem ele quer trazer e por quanto tempo. Contratar abre o
 * trabalho com o reforço; seguir com o time atual abre sem contratar. Depois, mostra o que foi feito.
 */
function StaffingCard({ conversationId, proposal }: { conversationId: string; proposal: StaffingProposal }) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (accept: boolean) => conversationsApi.decideStaffing(conversationId, proposal.id, accept),
    onSuccess: (data) => {
      queryClient.setQueryData(["conversation", conversationId], data);
      for (const key of ["conversations", "jobs", "team", "agent-activity", "organogram", "catalog", "overview"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  const how = proposal.engagement === "job" ? "só para este trabalho" : "permanente";
  return (
    <div className="space-y-2 rounded-lg border bg-background p-3 text-foreground" aria-label="Proposta de contratação">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <UserPlus className="size-3.5" /> Proposta de contratação · {how}
      </p>
      <ul className="space-y-1">
        {proposal.templates.map((t) => (
          <li key={t.id} className="text-sm">
            <span className="font-medium">{t.name}</span> <span className="text-muted-foreground">· {t.title}</span>
          </li>
        ))}
      </ul>
      {proposal.status === "pending" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
              <Check /> Contratar e seguir
            </Button>
            <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
              Seguir com o time atual
            </Button>
          </div>
          <ErrorNotice error={decide.error} title="Não foi possível decidir agora" />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {proposal.status === "accepted" ? "Você aprovou a contratação." : "Você preferiu seguir com o time atual."}
          {proposal.job_id && (
            <>
              {" "}
              <Link to={`/trabalhos/${proposal.job_id}`} className="underline">
                Ver o trabalho
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
