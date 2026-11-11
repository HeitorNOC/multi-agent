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
import type { ChiefDecision, ChiefOfStaff, ChiefTrace, ChiefTurn, ConversationOffer, CompanyBriefing, KnowledgeNote } from "../domain/chief-of-staff.ts";
import { composeGoal, isProposal, presetOf, type Brief, type PlanningDraft, type WorkPlan } from "../domain/planning.ts";
import { addDecisions, recallOlder, statedDecisions, summarizeOlder, type MemoryDecision } from "../domain/memory.ts";
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
  open(
    offerId: string,
    text: string,
    onAdmitted: (jobId: JobId, tx: Transaction) => Promise<void>,
    attachments?: readonly string[],
    /** Plano aprovado pelo CEO (time e motivo): o trabalho usa este em vez de escolher o time. */
    preset?: Json,
  ): Promise<Admission>;
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
  /** Trechos do Cérebro ligados ao pedido que a pessoa pode ler (para o Chief planejar, N2). */
  knowledge?: (text: string, actor: ActorId) => Promise<KnowledgeNote[]>;
  /** Fatos da empresa (N5), para o Chief e os agentes. */
  facts?: () => Promise<string[]>;
  /** Recursos provisionados (N6), para o Chief planejar. */
  resources?: () => Promise<{ name: string; kind: string; description: string }[]>;
  /** Especificação pelos diretores em segundo plano (N2); sem isto, o plano vai direto ao CEO. */
  specRunner?: { kick(planId: string): void };
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
  /** Plano em elaboração ou decidido que esta resposta mostra (a versão atual fica na última). */
  planning: PlanView | null;
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
  /** Planejamento (N2): versão em elaboração, proposta, aprovada ou cancelada. */
  planning?: "drafting" | "specifying" | "proposed" | "approved" | "cancelled";
  plan_version?: number;
};
type Decisions = Map<number, MessageView["decision"]>;
type Proposals = Map<number, StaffingProposal>;
type Plans = Map<number, PlanningDraft>;

export interface PlanView {
  id: string;
  version: number;
  status: PlanningDraft["status"];
  brief: Brief;
  questions: readonly string[];
  plan: (WorkPlan & { steps: (WorkPlan["steps"][number] & { owner_name: string })[]; hire_names: string[] }) | null;
  job_id: string | null;
  /** Partes detalhadas pelos diretores (a rodada mais recente). */
  specs: { agent: string; name: string; status: "pending" | "done" | "failed"; summary: string | null; requirements: readonly string[]; risks: readonly string[] }[];
}

async function plansOf(deps: ConversationDeps, id: ConversationId): Promise<Plans> {
  return new Map((await deps.uow.read.planning.listForConversation(id)).map((p) => [p.replySeq, p]));
}

/** Nomes de quem aparece no plano (do time ou do catálogo), para o cartão. */
async function planView(deps: ConversationDeps, d: PlanningDraft): Promise<PlanView> {
  const s = deps.staffing ? await deps.staffing.snapshot().catch(() => null) : null;
  const names = new Map<string, string>([
    ...(s?.team.map((a) => [a.id, `${a.name} · ${a.title}`] as const) ?? []),
    ...(s?.candidates.map((c) => [c.id, `${c.name} · ${c.title}`] as const) ?? []),
  ]);
  return {
    id: d.id,
    version: d.version,
    status: d.status,
    brief: d.brief,
    questions: d.questions,
    plan: d.plan
      ? {
          ...d.plan,
          steps: d.plan.steps.map((st) => ({ ...st, owner_name: names.get(st.owner) ?? st.owner })),
          hire_names: d.plan.hire.map((h) => names.get(h) ?? h),
        }
      : null,
    job_id: d.jobId,
    specs: await specsOf(deps, d, names),
  };
}

async function specsOf(deps: ConversationDeps, d: PlanningDraft, names: ReadonlyMap<string, string>): Promise<PlanView["specs"]> {
  const all = await deps.uow.read.specs.list(d.id);
  const last = Math.max(0, ...all.map((x) => x.version));
  return all
    .filter((x) => x.version === last)
    .map((x) => ({ agent: x.agentId, name: names.get(x.agentId) ?? x.agentId, status: x.status, summary: x.output?.summary ?? null, requirements: x.output?.requirements ?? [], risks: x.output?.risks ?? [] }));
}

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
  const plans = await plansOf(deps, id);
  const memory = await deps.uow.read.memory.get(id);
  return {
    memory: { summary: memory?.summary ?? "", decisions: (memory?.decisions ?? []).map((d) => ({ text: d.text, kind: d.kind, at: d.at })) },
    conversation: { id: conversation.id, title: conversation.title, agent_id: conversation.agentId, created_at: conversation.createdAt, updated_at: conversation.updatedAt },
    messages: await Promise.all(messages.map((m) => view(deps, m, decisions, proposals, plans))),
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
  const reply = previous ?? (conversation.agentId ? await stationAnswer(deps, conversation, question) : await answer(deps, conversation, question));
  const decisions = await decisionsOf(deps, id);
  const proposals = await proposalsOf(deps, id);
  const plans = await plansOf(deps, id);
  return { replayed: !!previous, user: await view(deps, question, decisions, proposals, plans), reply: await view(deps, reply, decisions, proposals, plans) };
}

/** Na Estação, o agente responde com as fontes que pode ler; a decisão vai para a trilha sem o texto. */
async function stationAnswer(deps: ConversationDeps, conversation: Conversation, question: Message): Promise<Message> {
  ensure(deps.station, () => conflict("station_unavailable", "Estação indisponível nesta instalação"));
  const r = await deps.station.reply(conversation.agentId!, question.text, conversation.actor, sourcesOf(question));
  return reply(deps, conversation.id, question.seq, r.text, null, r.trace, r.citations);
}

async function answer(deps: ConversationDeps, conversation: Conversation, question: Message): Promise<Message> {
  const id = conversation.id;
  const history = await deps.uow.read.messages.list(id);
  // Sem a situação da empresa, o time ou o Cérebro (falha ao ler), o Chief responde só com a conversa.
  const briefing = deps.briefing ? await deps.briefing().catch(() => null) : null;
  const staffing = deps.staffing ? await deps.staffing.snapshot().catch(() => null) : null;
  const draft = (await deps.uow.read.planning.active(id)) ?? null;
  const knowledge = deps.knowledge && deps.chief.plans ? await deps.knowledge(planningQuery(draft, question.text), conversation.actor).catch(() => null) : null;
  const memory = (await deps.uow.read.memory.get(id)) ?? null;
  const facts = deps.facts ? await deps.facts().catch(() => null) : null;
  const resources = deps.resources && deps.chief.plans ? await deps.resources().catch(() => null) : null;
  const decision = await deps.chief.decide({
    text: question.text,
    history,
    memory: { summary: memory?.summary ?? "", decisions: memory?.decisions.map((d) => d.text) ?? [], recalled: recallOlder(history.slice(0, -1), question.text) },
    facts,
    resources,
    lastJob: await lastJob(deps, history),
    offers: deps.offers,
    briefing,
    staffing,
    planning: draft ? { version: draft.version, brief: draft.brief, questions: draft.questions, plan: draft.plan } : null,
    knowledge,
  });
  const trace: ChiefTrace = decision.trace ?? { engine: "rules" };
  // O que o gestor afirmou (pelo modelo ou pela frase "fica decidido…") vai para a memória.
  const stated = [...new Set([...(decision.remember ?? []), ...statedDecisions(question.text)])];
  const answered = await answerDecision(deps, conversation, question, decision, trace, draft, knowledge, staffing);
  await noteMemory(deps, id, stated.map((text) => ({ text, kind: "stated" as const, seq: question.seq, at: deps.clock.now() }))).catch(() => undefined);
  return answered;
}

async function answerDecision(
  deps: ConversationDeps,
  conversation: Conversation,
  question: Message,
  decision: ChiefDecision,
  trace: ChiefTrace,
  draft: PlanningDraft | null,
  knowledge: KnowledgeNote[] | null,
  staffing: StaffingSnapshot | null,
): Promise<Message> {
  const id = conversation.id;
  if (decision.kind === "reply") return reply(deps, id, question.seq, decision.text, null, trace);
  if (decision.kind === "cancel_plan") return cancelDraft(deps, id, question.seq, draft, decision.text, trace);
  if (decision.kind === "plan") {
    // Os rótulos dos trechos só valem nesta chamada: o plano guarda a fonte e a versão.
    const sources = new Map(knowledge?.map((k) => [k.label, `${k.title} (v${k.version})`]) ?? []);
    const plan = decision.plan && { ...decision.plan, references: [...new Set(decision.plan.references.map((r) => sources.get(r)).filter((t): t is string => !!t))] };
    return planReply(deps, id, question, draft, { ...decision, plan }, trace);
  }
  // Com plano em elaboração, o trabalho só abre pela aprovação do CEO (defesa: uma implementação
  // que tente abrir direto vira explicação).
  if (draft)
    return reply(deps, id, question.seq, "Há um plano em elaboração nesta conversa. Aprove, ajuste ou cancele o plano antes de eu abrir outro trabalho.", null, {
      ...trace,
      fallback: trace.fallback ?? "open_job_while_planning",
    });
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

/** Junta decisões novas e refaz o resumo das mensagens que saíram da janela. */
async function noteMemory(deps: ConversationDeps, id: ConversationId, fresh: MemoryDecision[]) {
  const messages = await deps.uow.read.messages.list(id);
  await deps.uow.run(async (s) => {
    const current = await s.memory.get(id);
    const { summary, upTo } = summarizeOlder(messages);
    if (!fresh.length && (current?.summarizedSeq ?? 0) === upTo) return;
    await s.memory.save({
      conversationId: id,
      summary: upTo ? summary : (current?.summary ?? ""),
      decisions: addDecisions(current?.decisions ?? [], fresh),
      summarizedSeq: Math.max(upTo, current?.summarizedSeq ?? 0),
      updatedAt: deps.clock.now(),
    });
  });
}

/** O que buscar no Cérebro para planejar: o pedido de origem e a mensagem atual. */
const planningQuery = (draft: PlanningDraft | null, text: string) => (draft ? `${draft.brief.objective}\n${text}` : text);

/** Começa ou revisa o planejamento: grava a resposta do Chief e a nova versão, juntas. */
async function planReply(
  deps: ConversationDeps,
  id: ConversationId,
  question: Message,
  draft: PlanningDraft | null,
  d: { offerId: string; text: string; brief: Brief; questions: string[]; plan: WorkPlan | null },
  trace: ChiefTrace,
) {
  // Pronto para o CEO, mas o Chief pediu que diretores detalhem antes: vai para "specifying".
  const delegate = isProposal(d) && !!deps.specRunner && (d.plan?.specify.length ?? 0) > 0;
  const planId = draft?.id ?? randomUUID();
  // Nomes antes da transação (a leitura do time é por fora dela).
  const leaders = delegate ? await leaderNames(deps, d.plan!.specify) : null;
  try {
    const message = await deps.uow.run(async (s) => {
      await requireUnanswered(s, id, question.seq);
      const status = delegate ? "specifying" : isProposal(d) ? "proposed" : "drafting";
      const version = (draft?.version ?? 0) + 1;
      const text = leaders ? `${d.text} Pedi para ${leaders.text} ${leaders.many ? "detalharem a parte deles" : "detalhar a parte dele"}; o plano volta para você em seguida.` : d.text;
      const message = await appendReply(deps, s, id, question.seq, text, null, { ...trace, offer_id: d.offerId, planning: status, plan_version: version });
      const now = deps.clock.now();
      if (draft) {
        const revised = await s.planning.revise(
          { ...draft, replySeq: message.seq, version, status, brief: d.brief, questions: d.questions, plan: d.plan, updatedAt: now },
          draft.version,
        );
        ensure(revised, () => conflict("plan_changed", "O plano mudou enquanto eu revisava; envie de novo"));
      } else
        await s.planning.add({
          id: planId,
          conversationId: id,
          originSeq: question.seq,
          replySeq: message.seq,
          offerId: d.offerId,
          version,
          status,
          brief: d.brief,
          questions: d.questions,
          plan: d.plan,
          jobId: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      if (delegate) await s.specs.add(planId, version, d.plan!.specify, now);
      return message;
    });
    if (delegate) deps.specRunner!.kick(planId);
    return message;
  } catch (error) {
    if (error instanceof AlreadyAnswered) return error.reply;
    throw error;
  }
}

async function leaderNames(deps: ConversationDeps, ids: readonly string[]) {
  const s = deps.staffing ? await deps.staffing.snapshot().catch(() => null) : null;
  const names = new Map<string, string>([...(s?.team.map((a) => [a.id, a.name] as const) ?? []), ...(s?.candidates.map((c) => [c.id, c.name] as const) ?? [])]);
  const list = ids.map((i) => names.get(i) ?? i);
  return { text: list.length > 1 ? `${list.slice(0, -1).join(", ")} e ${list.at(-1)}` : list[0]!, many: list.length > 1 };
}

const CONSOLIDATE = "Os diretores detalharam as partes deles. Consolide as especificações no plano e devolva a versão revisada completa.";

/**
 * Fim da especificação (chamado pelo `SpecificationRunner`): o Chief consolida as partes numa versão
 * nova do plano e responde na conversa. Sem conseguir consolidar, o plano volta ao CEO como estava.
 * Se o CEO mexeu no plano enquanto isso (outra versão, cancelado), não faz nada.
 */
export async function settlePlanFromSpecs(
  deps: ConversationDeps,
  draft: PlanningDraft,
  sections: NonNullable<ChiefTurn["specifications"]>,
  knowledge: readonly KnowledgeNote[],
  staffing: ChiefTurn["staffing"],
) {
  const id = draft.conversationId as ConversationId;
  let decision: Awaited<ReturnType<ChiefOfStaff["decide"]>> | null = null;
  if (sections.length)
    decision = await deps.chief
      .decide({
        text: CONSOLIDATE,
        history: await deps.uow.read.messages.list(id),
        lastJob: null,
        offers: deps.offers,
        staffing: staffing ?? null,
        planning: { version: draft.version, brief: draft.brief, questions: draft.questions, plan: draft.plan },
        knowledge,
        specifications: sections,
      })
      .catch(() => null);
  const names = sections.map((x) => x.title.split(",")[0]!);
  const who = `${names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : (names[0] ?? "")} ${names.length > 1 ? "detalharam a parte deles" : "detalhou a parte dele"}`;
  let next: { brief: Brief; questions: string[]; plan: WorkPlan | null; text: string; trace: DecisionRecord };
  if (decision?.kind === "plan") {
    const sources = new Map(knowledge.map((k) => [k.label, `${k.title} (v${k.version})`]));
    const plan = decision.plan && { ...decision.plan, specify: [], references: [...new Set(decision.plan.references.map((r) => sources.get(r)).filter((t): t is string => !!t))] };
    next = { brief: decision.brief, questions: decision.questions, plan, text: `${who}. ${decision.text}`, trace: { ...(decision.trace ?? { engine: "rules" }), planning: "proposed" } };
  } else
    next = {
      brief: draft.brief,
      questions: [...draft.questions],
      plan: draft.plan && { ...draft.plan, specify: [] },
      text: sections.length
        ? `${who}, mas não consegui consolidar no plano agora. O plano segue como estava, com as especificações abaixo, para sua aprovação.`
        : "Os diretores não conseguiram detalhar agora. O plano segue como estava, para sua aprovação.",
      trace: { engine: "rules", planning: "proposed", fallback: "consolidation_failed" },
    };
  const status = next.plan && next.questions.length === 0 ? "proposed" : "drafting";
  try {
    await deps.uow.run(async (s) => {
      await requireUnanswered(s, id, draft.replySeq);
      const message = await appendReply(deps, s, id, draft.replySeq, next.text, null, { ...next.trace, planning: status, plan_version: draft.version + 1 });
      const revised = await s.planning.revise(
        { ...draft, replySeq: message.seq, version: draft.version + 1, status, brief: next.brief, questions: next.questions, plan: next.plan, updatedAt: deps.clock.now() },
        draft.version,
      );
      // O CEO mexeu no plano no meio: descarta (a transação desfaz a mensagem).
      if (!revised) throw new AlreadyAnswered(message);
    });
  } catch (error) {
    if (!(error instanceof AlreadyAnswered)) throw error;
  }
}

async function cancelDraft(deps: ConversationDeps, id: ConversationId, replyTo: number, draft: PlanningDraft | null, text: string, trace: ChiefTrace) {
  try {
    return await deps.uow.run(async (s) => {
      await requireUnanswered(s, id, replyTo);
      if (draft) await s.planning.decide(draft.id, draft.version, "cancelled", null, "chief_of_staff", deps.clock.now());
      return appendReply(deps, s, id, replyTo, text, null, { ...trace, planning: "cancelled" });
    });
  } catch (error) {
    if (error instanceof AlreadyAnswered) return error.reply;
    throw error;
  }
}

/**
 * O CEO aprova a versão do plano que está vendo: contrata quem o plano traz do catálogo, abre o
 * trabalho com o pedido montado do brief e com o time do plano, tudo na mesma transação. Aprovar
 * uma versão antiga é recusado (o plano mudou); repetir a aprovação é inofensivo.
 */
export async function approvePlan(deps: ConversationDeps, actor: ActorId, id: ConversationId, planId: string, version: number) {
  await owned(deps, actor, id);
  const draft = await deps.uow.read.planning.get(planId);
  ensure(draft && draft.conversationId === id, () => notFound("plan_not_found", "Plano não encontrado"));
  if (draft.status === "approved") return readConversation(deps, actor, id);
  ensure(draft.status !== "specifying", () => conflict("plan_specifying", "Os diretores ainda estão detalhando o plano"));
  ensure(draft.status === "proposed", () => conflict(draft.status === "cancelled" ? "plan_cancelled" : "plan_not_ready", draft.status === "cancelled" ? "Este plano foi cancelado" : "O plano ainda tem perguntas em aberto"));
  ensure(draft.version === version, () => conflict("plan_changed", "O plano mudou desde que você o viu; confira a versão nova"));
  const plan = draft.plan!;
  const staffing = deps.staffing ? await deps.staffing.snapshot() : null;
  const names = new Map<string, string>([
    ...(staffing?.team.map((a) => [a.id, `${a.name} (${a.title})`] as const) ?? []),
    ...(staffing?.candidates.map((c) => [c.id, `${c.name} (${c.title})`] as const) ?? []),
  ]);
  // Quem o plano traz do catálogo precisa continuar disponível (alguém pode ter mudado o time).
  const offered = new Map(staffing?.candidates.map((c) => [c.id, c]) ?? []);
  ensure(plan.hire.every((h) => offered.has(h)), () => conflict("plan_hire_unavailable", "Alguém que o plano traz não está mais disponível no catálogo; peça uma revisão"));
  const hires = plan.hire.map((h) => offered.get(h)!).map((c) => ({ id: c.id, name: c.name, title: c.title, area: c.area }));
  const engagement = staffing?.autonomy.engagement ?? "job";
  const question = (await deps.uow.read.messages.list(id)).find((m) => m.seq === draft.originSeq);
  const text = `Plano aprovado. ${hires.length ? `${hiredText(hires, engagement)} ` : ""}Abri o trabalho com ${plan.steps.length} etapa(s); aviso aqui quando houver um parecer para você aprovar.`;
  const opened = await openJob(deps, id, draft.replySeq, {
    offerId: draft.offerId,
    request: composeGoal(draft.brief, plan, names, new Map((deps.resources ? await deps.resources().catch(() => []) : []).map((r) => [r.name, r.description.slice(0, 160)]))),
    text,
    trace: { engine: "rules", offer_id: draft.offerId, planning: "approved", plan_version: draft.version, ...(hires.length ? { hired: hires.map((h) => h.id) } : {}) },
    attachments: question ? sourcesOf(question) : [],
    hire: hires.length ? { templates: hires, engagement, actor } : null,
    preset: presetOf(
      plan,
      draft.version,
      new Map([...(staffing?.team.map((a) => [a.id, { area: a.area, role: a.role }] as const) ?? []), ...(staffing?.candidates.map((c) => [c.id, { area: c.area, role: c.role }] as const) ?? [])]),
    ),
    also: async (jobId, tx) => {
      const decided = await deps.uow.join(tx).planning.decide(draft.id, draft.version, "approved", jobId, actor, deps.clock.now());
      ensure(decided, () => conflict("plan_changed", "O plano mudou enquanto você aprovava; confira a versão nova"));
    },
  });
  ensure(opened.ok, () => conflict("admission_refused", `Não consegui abrir o trabalho agora: ${opened.ok ? "" : opened.reason}. Tente de novo em instantes.`));
  await noteMemory(deps, id, [{ text: `Plano aprovado (versão ${draft.version}): ${draft.brief.objective}`, kind: "plan_approved", seq: draft.replySeq, at: deps.clock.now() }]).catch(() => undefined);
  return readConversation(deps, actor, id);
}

/** O CEO cancela o plano pelo botão. */
export async function cancelPlan(deps: ConversationDeps, actor: ActorId, id: ConversationId, planId: string) {
  await owned(deps, actor, id);
  const draft = await deps.uow.read.planning.get(planId);
  ensure(draft && draft.conversationId === id, () => notFound("plan_not_found", "Plano não encontrado"));
  if (draft.status === "drafting" || draft.status === "proposed" || draft.status === "specifying") {
    await cancelDraft(deps, id, draft.replySeq, draft, "Certo, cancelei o planejamento. Nada foi aberto.", { engine: "rules" });
    await noteMemory(deps, id, [{ text: `Planejamento cancelado: ${draft.brief.objective}`, kind: "plan_cancelled", seq: draft.replySeq, at: deps.clock.now() }]).catch(() => undefined);
  }
  return readConversation(deps, actor, id);
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
  /** Plano aprovado (time e motivo) que o trabalho recebe pronto. */
  preset?: Json;
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
      r.preset,
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
    await noteMemory(deps, id, [
      {
        text: accept ? `Contratar ${proposal.templates.map((t) => `${t.name} (${t.title})`).join(" e ")} ${proposal.engagement === "job" ? "só para o trabalho" : "para o time"}` : "Seguir com o time atual, sem contratar",
        kind: "staffing",
        seq: proposal.replySeq,
        at: deps.clock.now(),
      },
    ]).catch(() => undefined);
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

async function view(deps: ConversationDeps, m: Message, decisions: Decisions, proposals: Proposals = new Map(), plans: Plans = new Map()): Promise<MessageView> {
  const p = m.role === "chief" ? proposals.get(m.seq) : undefined;
  const plan = m.role === "chief" ? plans.get(m.seq) : undefined;
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
    planning: plan ? await planView(deps, plan) : null,
  };
}
