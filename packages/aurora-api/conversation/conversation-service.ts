/**
 * Conversa do gestor com o Chief of Staff (E2).
 *
 * Fluxo de uma mensagem:
 *  1. A mensagem do gestor é gravada. Com `client_message_id`, repetir o envio não duplica.
 *  2. Se ela já tem resposta, a resposta é devolvida (repetição segura).
 *  3. O Chief of Staff decide: responder ou abrir um trabalho.
 *  4. Abrir um trabalho e gravar a resposta acontecem NA MESMA TRANSAÇÃO da admissão: ou
 *     existem os dois, ou nenhum. Se a admissão for recusada (fila cheia, runtime ainda
 *     preparando), a resposta explica o motivo e nenhum trabalho é criado.
 *
 * Cada usuário só enxerga as próprias conversas; a instalação (empresa) é o próprio banco.
 */
import { randomUUID } from "node:crypto";
import type {
  ConversationMessage,
  JobStatus,
  JourneyLedger,
  JourneyStore,
} from "../ledger/journey-ledger.ts";
import type { ChiefOfStaff, ChiefTrace, ConversationOffer } from "./chief-of-staff.ts";

export class ConversationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ConversationError";
    this.status = status;
  }
}

/** Resultado de uma tentativa de abrir trabalho. `opened` é falso quando a admissão foi recusada. */
export type Admission = { opened: true } | { opened: false; reason: string };

export interface ConversationDeps {
  ledger: JourneyLedger;
  chief: ChiefOfStaff;
  /** Trabalhos que a conversa pode abrir nesta instalação. */
  offers: ConversationOffer[];
  /**
   * Abre o trabalho `offerId`. `onAdmitted` roda dentro da transação que cria o trabalho; se
   * lançar, o trabalho não é criado. Recusas esperadas (fila cheia etc.) voltam como `opened: false`.
   */
  openJob(
    offerId: string,
    onAdmitted: (tx: JourneyStore, jobId: string) => Promise<void>,
    request: { text: string },
  ): Promise<Admission>;
  now?: () => string;
}

export interface MessageView {
  seq: number;
  role: "user" | "chief";
  text: string;
  created: string;
  reply_to: number | null;
  job: { id: string; status: JobStatus; capabilities: string[] | null } | null;
  /** Só nas respostas do Chief of Staff: quem decidiu e, se for o caso, por que o modelo não foi usado. */
  decision: { engine: string; provider?: string; fallback?: string } | null;
}

type Decisions = Map<number, MessageView["decision"]>;

const MAX_TEXT = 2000;
const MAX_TITLE = 120;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,100}$/;
const DEFAULT_TITLE = "Nova conversa";

type DecisionRecord = ChiefTrace & { offer_id?: string; admission?: "refused" };

/** A resposta já existe; usado para abortar a transação sem criar nada. */
class AlreadyAnswered extends Error {
  readonly reply: ConversationMessage;
  constructor(reply: ConversationMessage) {
    super("already answered");
    this.reply = reply;
  }
}

function requireThat(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new ConversationError(status, message);
}

function onlyFields(body: unknown, allowed: string[]): asserts body is Record<string, unknown> {
  requireThat(
    body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).every((k) => allowed.includes(k)),
    400,
    "Campo não permitido",
  );
}

export class ConversationService {
  private readonly ledger: JourneyLedger;
  private readonly chief: ChiefOfStaff;
  private readonly offers: ConversationOffer[];
  private readonly openJob: ConversationDeps["openJob"];
  private readonly now: () => string;

  constructor(deps: ConversationDeps) {
    this.ledger = deps.ledger;
    this.chief = deps.chief;
    this.offers = deps.offers;
    this.openJob = deps.openJob;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async list(actor: string) {
    const conversations = await this.ledger.listConversationsForActor(actor);
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        created: c.created,
        updated: c.updated,
        message_count: c.messageCount,
      })),
    };
  }

  async create(actor: string, body: unknown) {
    onlyFields(body, ["title"]);
    const title = body.title === undefined ? DEFAULT_TITLE : body.title;
    requireThat(
      typeof title === "string" && title.trim().length > 0 && title.length <= MAX_TITLE,
      400,
      `Título deve ter de 1 a ${MAX_TITLE} caracteres`,
    );
    const conversation = { id: randomUUID(), actor, title: title.trim(), created: this.now() };
    await this.ledger.createConversation(conversation);
    return { id: conversation.id, title: conversation.title, created: conversation.created };
  }

  async read(actor: string, id: string) {
    const conversation = await this.owned(actor, id);
    const messages = await this.ledger.listConversationMessages(id);
    const decisions = await this.decisions(id);
    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        created: conversation.created,
        updated: conversation.updated,
      },
      messages: await Promise.all(messages.map((m) => this.view(m, decisions))),
    };
  }

  /** Grava a mensagem do gestor, obtém a decisão do Chief of Staff e grava a resposta. */
  async send(actor: string, id: string, body: unknown) {
    onlyFields(body, ["text", "client_message_id"]);
    const { text, client_message_id: clientId } = body;
    requireThat(
      typeof text === "string" && text.trim().length > 0 && text.length <= MAX_TEXT,
      400,
      `Mensagem deve ter de 1 a ${MAX_TEXT} caracteres`,
    );
    requireThat(
      clientId === undefined || (typeof clientId === "string" && CLIENT_ID.test(clientId)),
      400,
      "client_message_id inválido",
    );
    const conversation = await this.owned(actor, id);

    const question = await this.ledger.transaction(async (tx) => {
      if (clientId) {
        const prior = await tx.findConversationMessageByClientId(conversation.id, clientId);
        if (prior) {
          requireThat(prior.text === text, 409, "client_message_id já usado com outro texto");
          return prior;
        }
      }
      return tx.appendConversationMessage({
        conversation: conversation.id,
        role: "user",
        text,
        clientId: clientId ?? null,
        created: this.now(),
      });
    });

    const previous = await this.ledger.findConversationReply(conversation.id, question.seq);
    if (previous) {
      const decisions = await this.decisions(conversation.id);
      return { status: 200, body: { replayed: true, user: await this.view(question, decisions), reply: await this.view(previous, decisions) } };
    }

    const reply = await this.answer(conversation.id, question);
    const decisions = await this.decisions(conversation.id);
    return { status: 201, body: { replayed: false, user: await this.view(question, decisions), reply: await this.view(reply, decisions) } };
  }

  private async answer(conversation: string, question: ConversationMessage): Promise<ConversationMessage> {
    const history = await this.ledger.listConversationMessages(conversation);
    const decision = await this.chief.decide({
      text: question.text,
      history,
      lastJob: await this.lastJob(history),
      offers: this.offers,
    });
    const trace: ChiefTrace = decision.trace ?? { engine: "rules" };
    if (decision.kind === "reply") return this.reply(conversation, question.seq, decision.text, trace);
    // Defesa contra uma implementação que invente um trabalho fora do catálogo.
    requireThat(this.offers.some((o) => o.id === decision.offerId), 500, "Chief of Staff escolheu um trabalho indisponível");

    let admission: Admission;
    try {
      admission = await this.openJob(decision.offerId, async (tx, jobId) => {
        await this.requireUnanswered(tx, conversation, question.seq);
        await this.appendReply(tx, conversation, question.seq, decision.text, jobId, { ...trace, offer_id: decision.offerId });
      }, { text: question.text });
    } catch (error) {
      if (error instanceof AlreadyAnswered) return error.reply;
      // O trabalho pode ter sido criado e respondido antes da falha (por exemplo, o worker
      // não iniciou). Nesse caso a resposta gravada vale; o estado do trabalho mostra a falha.
      const stored = await this.ledger.findConversationReply(conversation, question.seq);
      if (stored) return stored;
      throw error;
    }
    if (admission.opened) {
      const stored = await this.ledger.findConversationReply(conversation, question.seq);
      if (stored) return stored;
      throw new ConversationError(500, "Trabalho aberto sem resposta registrada");
    }
    return this.reply(
      conversation,
      question.seq,
      `Não consegui abrir o trabalho agora: ${admission.reason}. Tente de novo em instantes.`,
      { ...trace, offer_id: decision.offerId, admission: "refused" },
    );
  }

  /** Grava uma resposta sem trabalho; se outra requisição já respondeu, devolve aquela. */
  private async reply(conversation: string, replyTo: number, text: string, trace: DecisionRecord): Promise<ConversationMessage> {
    try {
      return await this.ledger.transaction(async (tx) => {
        await this.requireUnanswered(tx, conversation, replyTo);
        return this.appendReply(tx, conversation, replyTo, text, null, trace);
      });
    } catch (error) {
      if (error instanceof AlreadyAnswered) return error.reply;
      throw error;
    }
  }

  private async requireUnanswered(tx: JourneyStore, conversation: string, replyTo: number) {
    const existing = await tx.findConversationReply(conversation, replyTo);
    if (existing) throw new AlreadyAnswered(existing);
  }

  /**
   * Grava a resposta e, na mesma transação, a decisão na trilha de eventos da conversa
   * (motor, provedor, tempo, uso de tokens, motivo de fallback). O texto não vai para a trilha.
   */
  private async appendReply(
    tx: JourneyStore,
    conversation: string,
    replyTo: number,
    text: string,
    job: string | null,
    trace: DecisionRecord,
  ) {
    const reply = await tx.appendConversationMessage({ conversation, role: "chief", text, job, replyTo, created: this.now() });
    await tx.appendEvent(`conversation:${conversation}`, "chief_decision", {
      reply_to: replyTo,
      reply_seq: reply.seq,
      job,
      ...trace,
    });
    return reply;
  }

  /** A conversa existe e pertence ao usuário; caso contrário, 404 (sem revelar que existe). */
  private async owned(actor: string, id: string) {
    const conversation = await this.ledger.getConversation(id);
    requireThat(conversation && conversation.actor === actor, 404, "Conversa não encontrada");
    return conversation;
  }

  private async lastJob(history: ConversationMessage[]) {
    const withJob = [...history].reverse().find((m) => m.job);
    if (!withJob?.job) return null;
    const job = await this.ledger.getJob(withJob.job);
    return job ? { id: job.id, status: job.status } : null;
  }

  /** Decisões registradas na trilha da conversa, por `seq` da resposta. */
  private async decisions(conversation: string): Promise<Decisions> {
    const map: Decisions = new Map();
    for (const event of await this.ledger.listEvents(`conversation:${conversation}`)) {
      if (event.node !== "chief_decision") continue;
      const d = JSON.parse(event.detail);
      map.set(Number(d.reply_seq), {
        engine: String(d.engine),
        ...(d.provider ? { provider: String(d.provider) } : {}),
        ...(d.fallback ? { fallback: String(d.fallback) } : {}),
      });
    }
    return map;
  }

  private async view(m: ConversationMessage, decisions: Decisions): Promise<MessageView> {
    let job: MessageView["job"] = null;
    if (m.job) {
      const record = await this.ledger.getJob(m.job);
      if (record) {
        const plan = record.plan ? JSON.parse(record.plan) : null;
        job = {
          id: record.id,
          status: record.status,
          capabilities: Array.isArray(plan?.capabilities) ? plan.capabilities : null,
        };
      }
    }
    return {
      seq: m.seq,
      role: m.role,
      text: m.text,
      created: m.created,
      reply_to: m.replyTo,
      job,
      decision: m.role === "chief" ? (decisions.get(m.seq) ?? null) : null,
    };
  }
}
