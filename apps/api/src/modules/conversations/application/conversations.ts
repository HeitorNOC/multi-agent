/**
 * Casos de uso da conversa com o Chief of Staff.
 *
 * Uma mensagem:
 *  1. A mensagem do gestor é gravada. Com `clientId`, repetir o envio não duplica.
 *  2. Se ela já tem resposta, a resposta é devolvida (repetição segura).
 *  3. O Chief of Staff decide: responder ou abrir um trabalho.
 *  4. Abrir o trabalho e gravar a resposta acontecem NA MESMA TRANSAÇÃO da admissão: ou
 *     existem os dois, ou nenhum. Se a admissão for recusada (fila cheia, pedido fora da
 *     política), a resposta explica o motivo e nenhum trabalho é criado.
 */
import type { Clock } from "../../../shared/clock.ts";
import { conflict, ensure, notFound } from "../../../shared/errors.ts";
import { AgentId, ConversationId, type ActorId, type JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { JobStatus } from "../../jobs/domain/job.ts";
import type { ChiefOfStaff, ChiefTrace, ConversationOffer } from "../domain/chief-of-staff.ts";
import type { AnswerTrace } from "../../knowledge/application/answerers.ts";
import { DEFAULT_TITLE, type Conversation, type Message, type MessageCitation } from "../domain/conversation.ts";
import type { ConversationStore } from "../infrastructure/sql-conversations.ts";
import type { StationResponder } from "./station.ts";

export type Admission = { opened: true } | { opened: false; reason: string };

/** O que a conversa precisa do módulo de trabalhos. */
export interface JobOpener {
  /**
   * Abre um trabalho da oferta com o texto do gestor como pedido. `onAdmitted` roda dentro da
   * transação da admissão; se lançar, o trabalho não é criado. Recusas esperadas voltam como
   * `opened: false`.
   */
  open(offerId: string, text: string, onAdmitted: (jobId: JobId, tx: Transaction) => Promise<void>): Promise<Admission>;
  /** Estado atual e especialistas do plano, para mostrar na conversa. */
  describe(jobId: JobId): Promise<{ id: JobId; status: JobStatus; agents: string[] | null } | undefined>;
}

export interface ConversationDeps {
  uow: UnitOfWork<ConversationStore>;
  chief: ChiefOfStaff;
  offers: readonly ConversationOffer[];
  jobs: JobOpener;
  clock: Clock;
  /** Estação (conversa direta com um agente). Sem ele, só há conversa com o Chief of Staff. */
  station?: StationResponder;
}

export interface MessageView {
  seq: number;
  role: "user" | "chief";
  text: string;
  created_at: string;
  reply_to: number | null;
  /** Na Estação: as fontes citadas na resposta. */
  citations: readonly MessageCitation[] | null;
  job: { id: string; status: JobStatus; agents: string[] | null } | null;
  /** Só nas respostas: quem decidiu e, se for o caso, por que o modelo não foi usado. */
  decision: { engine: string; provider?: string; fallback?: string } | null;
}

/** Quem decidiu a resposta: o Chief of Staff (regras ou modelo) ou, na Estação, o agente (`agent`). */
type DecisionRecord = (ChiefTrace | (AnswerTrace & { agent: string })) & { offer_id?: string; admission?: "refused" };
type Decisions = Map<number, MessageView["decision"]>;

/** A resposta já existe; aborta a transação sem criar nada. */
class AlreadyAnswered extends Error {
  readonly reply: Message;
  constructor(reply: Message) {
    super("already answered");
    this.reply = reply;
  }
}

export async function listConversations(deps: ConversationDeps, actor: ActorId) {
  const conversations = await deps.uow.read.conversations.listForActor(actor);
  return {
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, agent_id: c.agentId, created_at: c.createdAt, updated_at: c.updatedAt, message_count: c.messageCount })),
  };
}

/** Conversa com o Chief of Staff ou, com `agentId`, a Estação de um agente do time. */
export async function createConversation(deps: ConversationDeps, actor: ActorId, title?: string, agentId?: string) {
  const now = deps.clock.now();
  let agent: AgentId | null = null;
  let name = title?.trim() || DEFAULT_TITLE;
  if (agentId) {
    ensure(deps.station, () => conflict("station_unavailable", "Estação indisponível nesta instalação"));
    const member = await deps.station.member(agentId);
    agent = AgentId.parse(member.id);
    name = title?.trim() || `Estação de ${member.title}`;
  }
  const conversation: Conversation = { id: ConversationId.create(), actor, title: name, agentId: agent, createdAt: now, updatedAt: now };
  await deps.uow.run((s) => s.conversations.add(conversation));
  return { id: conversation.id, title: conversation.title, agent_id: agent, created_at: conversation.createdAt };
}

export async function readConversation(deps: ConversationDeps, actor: ActorId, id: ConversationId) {
  const conversation = await owned(deps, actor, id);
  const messages = await deps.uow.read.messages.list(id);
  const decisions = await decisionsOf(deps, id);
  return {
    conversation: { id: conversation.id, title: conversation.title, agent_id: conversation.agentId, created_at: conversation.createdAt, updated_at: conversation.updatedAt },
    messages: await Promise.all(messages.map((m) => view(deps, m, decisions))),
  };
}

/** Grava a mensagem do gestor, obtém a decisão do Chief of Staff e grava a resposta. */
export async function sendMessage(deps: ConversationDeps, actor: ActorId, id: ConversationId, input: { text: string; clientId?: string }) {
  const conversation = await owned(deps, actor, id);
  const question = await deps.uow.run(async (s) => {
    if (input.clientId) {
      const prior = await s.messages.findByClientId(id, input.clientId);
      if (prior) {
        ensure(prior.text === input.text, () => conflict("client_id_reused", "client_message_id já usado com outro texto"));
        return prior;
      }
    }
    const now = deps.clock.now();
    await s.conversations.touch(id, now);
    return s.messages.add({ conversationId: id, role: "user", text: input.text, jobId: null, clientId: input.clientId ?? null, replyTo: null, citations: null, createdAt: now });
  });

  const previous = await deps.uow.read.messages.findReply(id, question.seq);
  const reply = previous ?? (conversation.agentId ? await stationAnswer(deps, conversation, question) : await answer(deps, id, question));
  const decisions = await decisionsOf(deps, id);
  return { replayed: !!previous, user: await view(deps, question, decisions), reply: await view(deps, reply, decisions) };
}

/** Na Estação, o agente responde com as fontes que pode ler; a decisão vai para a trilha sem o texto. */
async function stationAnswer(deps: ConversationDeps, conversation: Conversation, question: Message): Promise<Message> {
  ensure(deps.station, () => conflict("station_unavailable", "Estação indisponível nesta instalação"));
  const r = await deps.station.reply(conversation.agentId!, question.text, conversation.actor);
  return reply(deps, conversation.id, question.seq, r.text, null, r.trace, r.citations);
}

async function answer(deps: ConversationDeps, id: ConversationId, question: Message): Promise<Message> {
  const history = await deps.uow.read.messages.list(id);
  const decision = await deps.chief.decide({ text: question.text, history, lastJob: await lastJob(deps, history), offers: deps.offers });
  const trace: ChiefTrace = decision.trace ?? { engine: "rules" };
  if (decision.kind === "reply") return reply(deps, id, question.seq, decision.text, null, trace);
  // Defesa contra uma implementação que invente um trabalho fora do catálogo.
  if (!deps.offers.some((o) => o.id === decision.offerId))
    return reply(deps, id, question.seq, "Não consegui identificar um trabalho disponível para esse pedido.", null, { ...trace, fallback: "offer_not_in_catalog" });

  let admission: Admission;
  try {
    admission = await deps.jobs.open(decision.offerId, question.text, async (jobId, tx) => {
      const s = deps.uow.join(tx);
      await requireUnanswered(s, id, question.seq);
      await appendReply(deps, s, id, question.seq, decision.text, jobId, { ...trace, offer_id: decision.offerId });
    });
  } catch (error) {
    if (error instanceof AlreadyAnswered) return error.reply;
    throw error;
  }
  if (admission.opened) {
    const stored = await deps.uow.read.messages.findReply(id, question.seq);
    ensure(stored, () => conflict("reply_missing", "Trabalho aberto sem resposta registrada"));
    return stored;
  }
  return reply(deps, id, question.seq, `Não consegui abrir o trabalho agora: ${admission.reason}. Tente de novo em instantes.`, null, {
    ...trace,
    offer_id: decision.offerId,
    admission: "refused",
  });
}

/** Grava uma resposta; se outra requisição já respondeu, devolve aquela. */
async function reply(deps: ConversationDeps, id: ConversationId, replyTo: number, text: string, jobId: JobId | null, trace: DecisionRecord, citations: MessageCitation[] | null = null) {
  try {
    return await deps.uow.run(async (s) => {
      await requireUnanswered(s, id, replyTo);
      return appendReply(deps, s, id, replyTo, text, jobId, trace, citations);
    });
  } catch (error) {
    if (error instanceof AlreadyAnswered) return error.reply;
    throw error;
  }
}

async function requireUnanswered(s: ConversationStore, id: ConversationId, replyTo: number) {
  const existing = await s.messages.findReply(id, replyTo);
  if (existing) throw new AlreadyAnswered(existing);
}

/** Grava a resposta e, na mesma transação, a decisão na trilha da conversa (sem o texto). */
async function appendReply(
  deps: ConversationDeps,
  s: ConversationStore,
  id: ConversationId,
  replyTo: number,
  text: string,
  jobId: JobId | null,
  trace: DecisionRecord,
  citations: MessageCitation[] | null = null,
) {
  const now = deps.clock.now();
  // As respostas da Estação usam o mesmo papel das do Chief of Staff; quem respondeu é o agente da conversa.
  const message = await s.messages.add({ conversationId: id, role: "chief", text, jobId, clientId: null, replyTo, citations, createdAt: now });
  await s.conversations.touch(id, now);
  await s.events.append(stream.conversation(id), {
    kind: "agent" in trace ? "agent_reply" : "chief_decision",
    detail: { reply_to: replyTo, reply_seq: message.seq, job: jobId, ...trace } as Json,
  });
  return message;
}

/** A conversa existe e é da pessoa; caso contrário, `not_found` (sem revelar que existe). */
async function owned(deps: ConversationDeps, actor: ActorId, id: ConversationId) {
  const conversation = await deps.uow.read.conversations.get(id);
  ensure(conversation && conversation.actor === actor, () => notFound("conversation_not_found", "Conversa não encontrada"));
  return conversation;
}

async function lastJob(deps: ConversationDeps, history: readonly Message[]) {
  const withJob = [...history].reverse().find((m) => m.jobId);
  if (!withJob?.jobId) return null;
  const job = await deps.jobs.describe(withJob.jobId);
  return job ? { id: job.id, status: job.status } : null;
}

async function decisionsOf(deps: ConversationDeps, id: ConversationId): Promise<Decisions> {
  const map: Decisions = new Map();
  for (const event of await deps.uow.read.events.list(stream.conversation(id))) {
    if (event.kind !== "chief_decision" && event.kind !== "agent_reply") continue;
    const d = event.detail as { reply_seq: number; engine: string; provider?: string; fallback?: string };
    map.set(Number(d.reply_seq), { engine: d.engine, ...(d.provider ? { provider: d.provider } : {}), ...(d.fallback ? { fallback: d.fallback } : {}) });
  }
  return map;
}

async function view(deps: ConversationDeps, m: Message, decisions: Decisions): Promise<MessageView> {
  return {
    seq: m.seq,
    role: m.role,
    text: m.text,
    created_at: m.createdAt,
    reply_to: m.replyTo,
    citations: m.citations,
    job: m.jobId ? ((await deps.jobs.describe(m.jobId)) ?? null) : null,
    decision: m.role === "chief" ? (decisions.get(m.seq) ?? null) : null,
  };
}
