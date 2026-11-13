/**
 * Chief of Staff: decide o que fazer com cada mensagem do gestor.
 *
 * É uma interface para que a implementação possa mudar sem tocar no resto: hoje há uma
 * versão determinística por regras (sem chamar modelo); depois entra uma versão que usa o
 * `ModelProvider` local (CLI do Codex ou do Claude) com o mesmo contrato.
 *
 * O Chief of Staff só DECIDE, e só entre os trabalhos que a instalação oferece (`offers`).
 * Quem grava a conversa e abre o trabalho é o serviço de conversas, dentro do ledger.
 */
import type { ConversationMessage, JobStatus } from "../ledger/journey-ledger.ts";

/** Um tipo de trabalho que a instalação sabe executar e que pode ser aberto pela conversa. */
export interface ConversationOffer {
  id: string;
  /** Nome curto mostrado ao gestor. */
  title: string;
  /** Termos que identificam o pedido (comparados sem acento e sem maiúsculas). */
  keywords: string[];
}

export interface ChiefTurn {
  /** Texto da mensagem atual do gestor. */
  text: string;
  /** Mensagens da conversa, em ordem (inclui a atual). */
  history: ConversationMessage[];
  /** Último trabalho aberto nesta conversa, se houver. */
  lastJob: { id: string; status: JobStatus } | null;
  /** Trabalhos que podem ser abertos agora. Pode ser vazio. */
  offers: ConversationOffer[];
}

/**
 * Como a decisão foi tomada, para auditoria e custo. Nunca contém o texto da conversa.
 * `fallback` explica por que o modelo não foi usado (por exemplo, `timeout`).
 */
export interface ChiefTrace {
  engine: "rules" | "model";
  provider?: string;
  model?: string;
  seconds?: number;
  usage?: Record<string, unknown>;
  fallback?: string;
}

export type ChiefDecision = (
  | { kind: "reply"; text: string }
  /** Abrir o trabalho `offerId`; `text` é a resposta mostrada junto com o trabalho. */
  | { kind: "open_job"; offerId: string; text: string }
) & { trace?: ChiefTrace };

export interface ChiefOfStaff {
  decide(turn: ChiefTurn): Promise<ChiefDecision>;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  created: "criado",
  queued: "na fila",
  running: "em execução",
  awaiting_approval: "aguardando sua aprovação",
  completed: "concluído",
  failed: "com falha",
  interrupted: "interrompido",
  recovery_required: "aguardando revisão na central de recuperação",
  closed_unknown: "encerrado sem resultado confirmado",
  rejected: "rejeitado",
};

/** Minúsculas e sem acentos, para comparar intenções de forma tolerante. */
export const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const STATUS_INTENT = /\b(status|andamento|situacao|progresso|como (esta|anda|vai))\b/;
/** Verbos e substantivos de pedido genérico, usados quando só há um trabalho possível. */
const GENERIC_WORK = /\b(analis\w*|avali\w*|relatorio\w*|propost\w*|propon\w*|prepar\w*|faca|fazer|elabor\w*)\b/;

const containsTerm = (text: string, term: string) =>
  new RegExp(`\\b${normalize(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);

const list = (offers: ConversationOffer[]) =>
  offers.length === 1
    ? offers[0].title
    : offers.slice(0, -1).map((o) => `"${o.title}"`).join(", ") + ` ou "${offers.at(-1)!.title}"`;

/**
 * Versão determinística. Reconhece pedidos de status e escolhe o trabalho cujos termos mais
 * aparecem na mensagem. Se houver empate, pergunta qual; se nada couber, explica o que está
 * disponível em vez de inventar.
 */
export class RuleBasedChiefOfStaff implements ChiefOfStaff {
  async decide({ text, lastJob, offers }: ChiefTurn): Promise<ChiefDecision> {
    const intent = normalize(text);
    if (STATUS_INTENT.test(intent))
      return {
        kind: "reply",
        text: lastJob
          ? `O trabalho ${lastJob.id.slice(0, 8)} está ${STATUS_LABEL[lastJob.status]}.`
          : "Ainda não abri nenhum trabalho nesta conversa.",
      };
    if (!offers.length)
      return {
        kind: "reply",
        text: "Neste perfil eu ainda não abro trabalhos pela conversa. Use o painel de pedidos.",
      };

    const scored = offers
      .map((offer) => ({ offer, score: offer.keywords.filter((k) => containsTerm(intent, k)).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored.filter((s) => s.score === scored[0]?.score).map((s) => s.offer);

    if (best.length === 1 || (!best.length && offers.length === 1 && GENERIC_WORK.test(intent))) {
      const offer = best[0] ?? offers[0];
      return {
        kind: "open_job",
        offerId: offer.id,
        text:
          `Entendido. Abri um trabalho de "${offer.title}". ` +
          "Vou planejar com os especialistas e aviso aqui quando houver um parecer para você aprovar.",
      };
    }
    if (best.length > 1)
      return { kind: "reply", text: `Seu pedido combina com mais de um trabalho: ${list(best)}. Qual deles?` };
    return {
      kind: "reply",
      text: `Nesta instalação eu consigo abrir: ${list(offers)}. Diga qual, ou descreva o pedido com mais detalhes.`,
    };
  }
}
