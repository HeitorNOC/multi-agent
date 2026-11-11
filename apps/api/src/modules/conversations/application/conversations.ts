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
import { randomUUID } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { conflict, ensure, invalid, notFound } from "../../../shared/errors.ts";
import { AgentId, ConversationId, type ActorId, type JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { JobStatus } from "../../jobs/domain/job.ts";
import type { ChiefOfStaff, ChiefTrace, ConversationOffer, CompanyBriefing } from "../domain/chief-of-staff.ts";
import type { AnswerTrace } from "../../knowledge/application/answerers.ts";
import { DEFAULT_TITLE, type Conversation, type Message, type MessageAttachment, type MessageCitation } from "../domain/conversation.ts";
import type { ConversationStore } from "../infrastructure/sql-conversations.ts";
import type { StationResponder } from "./station.ts";
import { MAX_HIRES, proposalText, suggestHires, type Engagement, type ProposalStatus, type StaffingCandidate, type StaffingDirectory, type StaffingProposal, type StaffingSnapshot } from "../domain/staffing.ts";

export type Admission = { opened: true } | { opened: false; reason: string };

/** O que a conversa precisa do módulo de trabalhos. */
export interface JobOpener {
  /**
   * Abre um trabalho da oferta com o texto do gestor como pedido. `onAdmitted` roda dentro da
   * transação da admissão; se lançar, o trabalho não é criado. Recusas esperadas voltam como
   * `opened: false`.
   */
  open(offerId: string, text: string, onAdmitted: (jobId: JobId, tx: Transaction) => Promise<void>, attachments?: readonly string[]): Promise<Admission>;
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
  /** Guarda um anexo no Cérebro (imagem lida pelo modelo, documento extraído) e devolve a fonte. */
  attach?: (actor: ActorId, file: AttachmentFile) => Promise<MessageAttachment>;
  /** Situação da empresa para o Chief responder sobre pendências, andamento e time. */
  briefing?: () => Promise<CompanyBriefing>;
  /** Time, alçadas e catálogo: o Chief propõe ou contrata quem falta (N1). */
  staffing?: StaffingDirectory;
}

export interface AttachmentFile {
  filename: string;
  mediaType: string;
  contentBase64: string;
}

/** Anexos por mensagem: o bastante para um pedido; cada imagem custa uma leitura do modelo. */
export const MAX_ATTACHMENTS = 4;

export interface MessageView {
  seq: number;
  role: "user" | "chief";
  text: string;
  created_at: string;
  reply_to: number | null;
  /** Na Estação: as fontes citadas na resposta. */
  citations: readonly MessageCitation[] | null;
  /** Arquivos que o gestor anexou (fontes do Cérebro). */
  attachments: readonly MessageAttachment[] | null;
  job: { id: string; status: JobStatus; agents: string[] | null } | null;
  /** Só nas respostas: quem decidiu e, se for o caso, por que o modelo não foi usado. */
  decision: { engine: string; provider?: string; fallback?: string } | null;
  /** Proposta de contratação do Chief que esta resposta traz (para o CEO decidir). */
  staffing: { id: string; status: ProposalStatus; engagement: Engagement; templates: StaffingProposal["templates"]; job_id: string | null } | null;
}

/** Quem decidiu a resposta: o Chief of Staff (regras ou modelo) ou, na Estação, o agente (`agent`). */
type DecisionRecord = (ChiefTrace | (AnswerTrace & { agent: string })) & {
  offer_id?: string;
  admission?: "refused";
  /** Composição do time: o Chief propôs, contratou, ou o CEO aceitou ou recusou a proposta. */
  staffing?: "proposed" | "hired" | "accepted" | "declined";
  hired?: string[];
};
type Decisions = Map<number, MessageView["decision"]>;
type Proposals = Map<number, StaffingProposal>;

async function proposalsOf(deps: ConversationDeps, id: ConversationId): Promise<Proposals> {
  return new Map((await deps.uow.read.staffing.listForConversation(id)).map((p) => [p.replySeq, p]));
}

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
  const proposals = await proposalsOf(deps, id);
  return {
    conversation: { id: conversation.id, title: conversation.title, agent_id: conversation.agentId, created_at: conversation.createdAt, updated_at: conversation.updatedAt },
    messages: await Promise.all(messages.map((m) => view(deps, m, decisions, proposals))),
  };
}

/** Grava a mensagem do gestor, obtém a decisão do Chief of Staff e grava a resposta. */
export async function sendMessage(
  deps: ConversationDeps,
  actor: ActorId,
  id: ConversationId,
  input: { text: string; clientId?: string; attachments?: readonly AttachmentFile[] },
) {
  const conversation = await owned(deps, actor, id);
  const files = input.attachments ?? [];
  ensure(files.length <= MAX_ATTACHMENTS, () => invalid("too_many_attachments", `No máximo ${MAX_ATTACHMENTS} anexos por mensagem`));
  ensure(!files.length || deps.attach, () => conflict("attachments_unavailable", "Anexos indisponíveis nesta instalação"));
  // Repetição do mesmo envio: devolve o que já existe, sem guardar os anexos de novo.
  const prior = input.clientId ? await deps.uow.read.messages.findByClientId(id, input.clientId) : undefined;
  // Os anexos vão ao Cérebro antes da mensagem (ler uma imagem leva alguns segundos e não pode
  // segurar uma transação). Se algum falhar, a mensagem não é gravada e nada fica pela metade na conversa.
  const attachments: MessageAttachment[] = [];
  if (!prior) for (const file of files) attachments.push(await deps.attach!(actor, file));
  const question = await deps.uow.run(async (s) => {
    if (input.clientId) {
      const again = await s.messages.findByClientId(id, input.clientId);
      if (again) {
        ensure(again.text === input.text, () => conflict("client_id_reused", "client_message_id já usado com outro texto"));
        return again;
      }
    }
    const now = deps.clock.now();
    await s.conversations.touch(id, now);
    return s.messages.add({
      conversationId: id,
      role: "user",
      text: input.text,
      jobId: null,
      clientId: input.clientId ?? null,
      replyTo: null,
      citations: null,
      attachments: attachments.length ? attachments : null,
      createdAt: now,
    });
  });

  const previous = await deps.uow.read.messages.findReply(id, question.seq);
  const reply = previous ?? (conversation.agentId ? await stationAnswer(deps, conversation, question) : await answer(deps, id, question));
  const decisions = await decisionsOf(deps, id);
  const proposals = await proposalsOf(deps, id);
  return { replayed: !!previous, user: await view(deps, question, decisions, proposals), reply: await view(deps, reply, decisions, proposals) };
}

/** Na Estação, o agente responde com as fontes que pode ler; a decisão vai para a trilha sem o texto. */
async function stationAnswer(deps: ConversationDeps, conversation: Conversation, question: Message): Promise<Message> {
  ensure(deps.station, () => conflict("station_unavailable", "Estação indisponível nesta instalação"));
  const r = await deps.station.reply(conversation.agentId!, question.text, conversation.actor, sourcesOf(question));
  return reply(deps, conversation.id, question.seq, r.text, null, r.trace, r.citations);
}

async function answer(deps: ConversationDeps, id: ConversationId, question: Message): Promise<Message> {
  const history = await deps.uow.read.messages.list(id);
  // Sem a situação da empresa ou o time (falha ao ler), o Chief responde só com a conversa.
  const briefing = deps.briefing ? await deps.briefing().catch(() => null) : null;
  const staffing = deps.staffing ? await deps.staffing.snapshot().catch(() => null) : null;
  const decision = await deps.chief.decide({ text: question.text, history, lastJob: await lastJob(deps, history), offers: deps.offers, briefing, staffing });
  const trace: ChiefTrace = decision.trace ?? { engine: "rules" };
  if (decision.kind === "reply") return reply(deps, id, question.seq, decision.text, null, trace);
  // Defesa contra uma implementação que invente um trabalho fora do catálogo.
  if (!deps.offers.some((o) => o.id === decision.offerId))
    return reply(deps, id, question.seq, "Não consegui identificar um trabalho disponível para esse pedido.", null, { ...trace, fallback: "offer_not_in_catalog" });

  // Falta alguém no time? O modelo diz em `hire`; por regras, a sobreposição de palavras.
  const hires = staffing ? pickHires(decision.hire ?? suggestHires(question.text, staffing), staffing) : [];
  if (hires.length && staffing!.autonomy.hire === "propose") return propose(deps, id, question, decision.offerId, hires, staffing!.autonomy.engagement, trace);
  const auto = hires.length > 0 && staffing!.autonomy.hire === "auto";
  const text = auto ? `${decision.text} ${hiredText(hires, staffing!.autonomy.engagement)}` : decision.text;
  const opened = await openJob(deps, id, question.seq, {
    offerId: decision.offerId,
    request: question.text,
    text,
    trace: { ...trace, offer_id: decision.offerId, ...(auto ? { staffing: "hired", hired: hires.map((h) => h.id) } : {}) },
    attachments: sourcesOf(question),
    hire: auto ? { templates: hires, engagement: staffing!.autonomy.engagement, actor: "chief_of_staff" } : null,
  });
  if (opened.ok) return opened.reply;
  return reply(deps, id, question.seq, `Não consegui abrir o trabalho agora: ${opened.reason}. Tente de novo em instantes.`, null, {
    ...trace,
    offer_id: decision.offerId,
    admission: "refused",
  });
}

type Hire = StaffingProposal["templates"][number];

/** Só quem o catálogo oferece agora (fora do time, dentro das áreas), sem repetir, até `MAX_HIRES`. */
function pickHires(ids: readonly string[], staffing: StaffingSnapshot): Hire[] {
  const byId = new Map(staffing.candidates.map((c) => [c.id, c]));
  return [...new Set(ids)]
    .map((i) => byId.get(i))
    .filter((c): c is StaffingCandidate => !!c)
    .slice(0, MAX_HIRES)
    .map((c) => ({ id: c.id, name: c.name, title: c.title, area: c.area }));
}

const who = (hires: readonly Hire[]) => hires.map((h) => `${h.name} (${h.title})`).join(" e ");
const how = (engagement: Engagement) => (engagement === "job" ? "só para este trabalho" : "para o time");
const hiredText = (hires: readonly Hire[], engagement: Engagement) => `Trouxe ${who(hires)} ${how(engagement)}.`;

/** O Chief propõe contratar: grava a resposta com a proposta, sem abrir o trabalho ainda. */
async function propose(deps: ConversationDeps, id: ConversationId, question: Message, offerId: string, hires: Hire[], engagement: Engagement, trace: ChiefTrace) {
  try {
    return await deps.uow.run(async (s) => {
      await requireUnanswered(s, id, question.seq);
      const message = await appendReply(deps, s, id, question.seq, proposalText(hires, engagement), null, {
        ...trace,
        offer_id: offerId,
        staffing: "proposed",
        hired: hires.map((h) => h.id),
      });
      await s.staffing.add({
        id: randomUUID(),
        conversationId: id,
        questionSeq: question.seq,
        replySeq: message.seq,
        offerId,
        request: question.text,
        templates: hires,
        engagement,
        status: "pending",
        jobId: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: deps.clock.now(),
      });
      return message;
    });
  } catch (error) {
    if (error instanceof AlreadyAnswered) return error.reply;
    throw error;
  }
}

interface OpenRequest {
  offerId: string;
  request: string;
  text: string;
  trace: DecisionRecord;
  attachments: readonly string[];
  /** Contratar na mesma transação em que o trabalho é admitido (o worker só planeja depois). */
  hire: { templates: readonly Hire[]; engagement: Engagement; actor: string } | null;
  /** Mais algo na mesma transação (por exemplo, marcar a proposta como decidida). */
  also?: (jobId: JobId, tx: Transaction) => Promise<void>;
}

/** Abre o trabalho e grava a resposta (em `replyTo`) na mesma transação. */
async function openJob(deps: ConversationDeps, id: ConversationId, replyTo: number, r: OpenRequest): Promise<{ ok: true; reply: Message } | { ok: false; reason: string }> {
  let admission: Admission;
  try {
    admission = await deps.jobs.open(
      r.offerId,
      r.request,
      async (jobId, tx) => {
        const s = deps.uow.join(tx);
        await requireUnanswered(s, id, replyTo);
        await r.also?.(jobId, tx);
        if (r.hire) {
          ensure(deps.staffing, () => conflict("staffing_unavailable", "Contratação indisponível nesta instalação"));
          await deps.staffing.hire(
            tx,
            r.hire.templates.map((t) => t.id),
            { engagement: r.hire.engagement, engagedJob: jobId, hiredBy: "chief", actor: r.hire.actor },
          );
        }
        await appendReply(deps, s, id, replyTo, r.text, jobId, r.trace);
      },
      r.attachments,
    );
  } catch (error) {
    if (error instanceof AlreadyAnswered) return { ok: true, reply: error.reply };
    throw error;
  }
  if (!admission.opened) return { ok: false, reason: admission.reason };
  const stored = await deps.uow.read.messages.findReply(id, replyTo);
  ensure(stored, () => conflict("reply_missing", "Trabalho aberto sem resposta registrada"));
  return { ok: true, reply: stored };
}

/**
 * O CEO decide a proposta de contratação: aceitar (contrata e abre o trabalho) ou seguir com o
 * time atual (abre sem contratar). Repetir a decisão é inofensivo.
 */
export async function decideStaffing(deps: ConversationDeps, actor: ActorId, id: ConversationId, proposalId: string, accept: boolean) {
  await owned(deps, actor, id);
  const proposal = await deps.uow.read.staffing.get(proposalId);
  ensure(proposal && proposal.conversationId === id, () => notFound("proposal_not_found", "Proposta não encontrada"));
  if (proposal.status === "pending") {
    const question = (await deps.uow.read.messages.list(id)).find((m) => m.seq === proposal.questionSeq);
    const text = accept
      ? `Combinado. ${hiredText(proposal.templates, proposal.engagement)} Abri o trabalho e aviso aqui quando houver um parecer para você aprovar.`
      : "Certo, sigo com o time atual. Abri o trabalho e aviso aqui quando houver um parecer para você aprovar.";
    const opened = await openJob(deps, id, proposal.replySeq, {
      offerId: proposal.offerId,
      request: proposal.request,
      text,
      trace: { engine: "rules", offer_id: proposal.offerId, staffing: accept ? "accepted" : "declined", ...(accept ? { hired: proposal.templates.map((t) => t.id) } : {}) },
      attachments: question ? sourcesOf(question) : [],
      hire: accept ? { templates: proposal.templates, engagement: proposal.engagement, actor } : null,
      also: async (jobId, tx) => {
        const decided = await deps.uow.join(tx).staffing.decide(proposal.id, accept ? "accepted" : "declined", jobId, actor, deps.clock.now());
        ensure(decided, () => conflict("proposal_decided", "Esta proposta já foi decidida"));
      },
    });
    ensure(opened.ok, () => conflict("admission_refused", `Não consegui abrir o trabalho agora: ${opened.ok ? "" : opened.reason}. Tente de novo em instantes.`));
  }
  return readConversation(deps, actor, id);
}

const sourcesOf = (m: Message) => (m.attachments ?? []).map((a) => a.source);

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
  const message = await s.messages.add({ conversationId: id, role: "chief", text, jobId, clientId: null, replyTo, citations, attachments: null, createdAt: now });
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

async function view(deps: ConversationDeps, m: Message, decisions: Decisions, proposals: Proposals = new Map()): Promise<MessageView> {
  const p = m.role === "chief" ? proposals.get(m.seq) : undefined;
  return {
    seq: m.seq,
    role: m.role,
    text: m.text,
    created_at: m.createdAt,
    reply_to: m.replyTo,
    citations: m.citations,
    attachments: m.attachments,
    job: m.jobId ? ((await deps.jobs.describe(m.jobId)) ?? null) : null,
    decision: m.role === "chief" ? (decisions.get(m.seq) ?? null) : null,
    staffing: p ? { id: p.id, status: p.status, engagement: p.engagement, templates: p.templates, job_id: p.jobId } : null,
  };
}
