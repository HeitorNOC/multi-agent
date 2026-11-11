/**
 * Chief of Staff: decide o que fazer com cada mensagem do gestor — responder ou abrir um
 * trabalho, e só entre os trabalhos que a instalação oferece. Quem grava a conversa e abre o
 * trabalho é o caso de uso, numa transação. Há duas implementações com o mesmo contrato: por
 * regras (determinística) e por modelo (que volta às regras quando falha).
 */
import type { JobStatus } from "../../jobs/domain/job.ts";
import type { Message } from "./conversation.ts";

/** Um tipo de trabalho que a conversa pode abrir. */
export interface ConversationOffer {
  readonly id: string;
  /** Nome curto mostrado ao gestor. */
  readonly title: string;
  /** Termos que identificam o pedido (comparados sem acento e sem maiúsculas). */
  readonly keywords: readonly string[];
}

export interface ChiefTurn {
  /** Texto da mensagem atual. */
  text: string;
  /** Mensagens da conversa, em ordem (inclui a atual). */
  history: readonly Message[];
  /** Último trabalho aberto nesta conversa, se houver. */
  lastJob: { id: string; status: JobStatus } | null;
  /** Trabalhos que podem ser abertos agora. Pode ser vazio. */
  offers: readonly ConversationOffer[];
  /** Situação da empresa agora (o que espera o gestor, o que anda, quem trabalha). Sem ela, só a conversa. */
  briefing?: CompanyBriefing | null;
}

/**
 * Situação da empresa para o Chief of Staff responder como quem trabalha logo abaixo do gestor:
 * o que espera uma decisão, o que está andando e quem do time está trabalhando. Só leitura; listas
 * curtas (as mais recentes) para caber no contexto.
 */
export interface CompanyBriefing {
  /** Pareceres aguardando aprovação. */
  approvals: { id: string; goal: string }[];
  /** Entregas aguardando revisão (aceitar ou pedir ajustes). */
  reviews: { id: string; title: string }[];
  /** Trabalhos na central de recuperação (resultado desconhecido). */
  recovery: { id: string; goal: string }[];
  /** Trabalhos na fila ou em execução, com quem participa. */
  running: { id: string; goal: string; agents: string[] }[];
  /** Agentes trabalhando agora (nome · cargo) e o tamanho do time. */
  team: { working: string[]; size: number };
  /** Rotinas que desistiram nos últimos 7 dias. */
  routines_gave_up: number;
}

/** Como a decisão foi tomada, para auditoria e custo. Nunca contém o texto da conversa. */
export interface ChiefTrace {
  engine: "rules" | "model";
  provider?: string;
  model?: string;
  seconds?: number;
  usage?: Record<string, number>;
  /** Por que o modelo não foi usado (por exemplo, `timeout`). */
  fallback?: string;
}

export type ChiefDecision = ({ kind: "reply"; text: string } | { kind: "open_job"; offerId: string; text: string }) & { trace?: ChiefTrace };

export interface ChiefOfStaff {
  decide(turn: ChiefTurn): Promise<ChiefDecision>;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
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
export const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const STATUS_INTENT = /\b(status|andamento|situacao|progresso|como (esta|anda|vai))\b/;
/** O que espera o gestor. */
const PENDING_INTENT = /\b(aprova\w*|pendenc\w*|pendente\w*|decidir|decisao|decisoes|revisar|esperando (por )?mim|me espera)\b/;
/** Quem do time está trabalhando. */
const TEAM_INTENT = /\b(time|equipe|agentes?|especialistas?|quem esta trabalhando|quem esta fazendo)\b/;
/** Panorama geral. */
const BRIEF_INTENT = /\b(resumo|briefing|panorama|novidades|bom dia|boa tarde|boa noite|o que (esta )?acontec\w*)\b/;

const quote = (items: string[], max = 3) => {
  const shown = items.slice(0, max).map((t) => `"${t.length > 70 ? t.slice(0, 67) + "…" : t}"`);
  return shown.join(", ") + (items.length > max ? ` e mais ${items.length - max}` : "");
};

/** O que espera o gestor, em frases curtas (vazio se nada). */
export function pendingText(b: CompanyBriefing): string {
  const parts: string[] = [];
  if (b.approvals.length) parts.push(`${b.approvals.length} parecer(es) aguardando sua aprovação: ${quote(b.approvals.map((a) => a.goal))}`);
  if (b.reviews.length) parts.push(`${b.reviews.length} entrega(s) para revisar: ${quote(b.reviews.map((r) => r.title))}`);
  if (b.recovery.length) parts.push(`${b.recovery.length} caso(s) na central de recuperação`);
  return parts.length ? parts.join(". ") + "." : "";
}

export function teamText(b: CompanyBriefing): string {
  if (!b.team.size) return "Seu time ainda está vazio. Contrate especialistas em Agentes.";
  if (!b.team.working.length) return `Ninguém do time está trabalhando agora (${b.team.size} no time).`;
  return `Trabalhando agora: ${b.team.working.slice(0, 5).join("; ")}${b.team.working.length > 5 ? ` e mais ${b.team.working.length - 5}` : ""}.`;
}

export function runningText(b: CompanyBriefing): string {
  if (!b.running.length) return "Nenhum trabalho andando agora.";
  return `${b.running.length} trabalho(s) andando: ${quote(b.running.map((r) => r.goal))}.`;
}

/** Panorama: pendências, o que anda e quem trabalha. */
export function briefingText(b: CompanyBriefing): string {
  const pending = pendingText(b);
  const gaveUp = b.routines_gave_up ? ` ${b.routines_gave_up} rotina(s) desistiram nesta semana; veja em Rotinas.` : "";
  return `${pending || "Nada esperando sua decisão."} ${runningText(b)} ${teamText(b)}${gaveUp}`.trim();
}
/** Pedido genérico de trabalho, usado quando só há um trabalho possível. */
const GENERIC_WORK = /\b(analis\w*|avali\w*|relatorio\w*|propost\w*|propon\w*|prepar\w*|faca|fazer|elabor\w*)\b/;

const containsTerm = (text: string, term: string) => new RegExp(`\\b${normalize(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);

const list = (offers: readonly ConversationOffer[]) =>
  offers.length === 1 ? offers[0]!.title : offers.slice(0, -1).map((o) => `"${o.title}"`).join(", ") + ` ou "${offers.at(-1)!.title}"`;

/**
 * Por regras: reconhece pedidos de status e escolhe o trabalho cujos termos mais aparecem.
 * Empate pergunta qual; se nada couber, explica o que está disponível em vez de inventar.
 */
export class RuleBasedChiefOfStaff implements ChiefOfStaff {
  async decide({ text, lastJob, offers, briefing }: ChiefTurn): Promise<ChiefDecision> {
    const intent = normalize(text);
    if (briefing) {
      if (PENDING_INTENT.test(intent)) return { kind: "reply", text: pendingText(briefing) || "Nada esperando sua decisão agora." };
      if (TEAM_INTENT.test(intent) && !GENERIC_WORK.test(intent)) return { kind: "reply", text: teamText(briefing) };
      if (BRIEF_INTENT.test(intent)) return { kind: "reply", text: briefingText(briefing) };
      // Andamento sem trabalho nesta conversa: o panorama da empresa.
      if (STATUS_INTENT.test(intent) && !lastJob) return { kind: "reply", text: `${runningText(briefing)} ${pendingText(briefing)}`.trim() };
    }
    if (STATUS_INTENT.test(intent))
      return {
        kind: "reply",
        text: lastJob ? `O trabalho ${lastJob.id.slice(0, 8)} está ${STATUS_LABEL[lastJob.status]}.` : "Ainda não abri nenhum trabalho nesta conversa.",
      };
    if (!offers.length) return { kind: "reply", text: "Neste perfil eu ainda não abro trabalhos pela conversa. Use o painel de pedidos." };

    const scored = offers
      .map((offer) => ({ offer, score: offer.keywords.filter((k) => containsTerm(intent, k)).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored.filter((s) => s.score === scored[0]?.score).map((s) => s.offer);

    if (best.length === 1 || (!best.length && offers.length === 1 && GENERIC_WORK.test(intent))) {
      const offer = best[0] ?? offers[0]!;
      return {
        kind: "open_job",
        offerId: offer.id,
        text: `Entendido. Abri um trabalho de "${offer.title}". Vou planejar com os especialistas e aviso aqui quando houver um parecer para você aprovar.`,
      };
    }
    if (best.length > 1) return { kind: "reply", text: `Seu pedido combina com mais de um trabalho: ${list(best)}. Qual deles?` };
    return { kind: "reply", text: `Nesta instalação eu consigo abrir: ${list(offers)}. Diga qual, ou descreva o pedido com mais detalhes.` };
  }
}
