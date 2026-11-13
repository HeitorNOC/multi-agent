/**
 * Composição do time na conversa (N1): ao abrir um trabalho, o Chief of Staff vê se o time cobre
 * o pedido. Se faltar alguém, e as alçadas permitirem, propõe trazer do catálogo (o CEO aprova na
 * conversa) ou traz sozinho. Este arquivo tem os tipos e a regra determinística (sem modelo).
 */
import type { Transaction } from "../../../platform/database/unit-of-work.ts";
import { normalize } from "./chief-of-staff.ts";

export type HireMode = "never" | "propose" | "auto";
export type Engagement = "job" | "permanent";

export interface StaffingCandidate {
  id: string;
  name: string;
  title: string;
  area: string;
  role: "director" | "lead" | "specialist";
  focus: string;
  skills: readonly string[];
}

export interface TeamMemberBrief {
  id: string;
  name: string;
  title: string;
  area: string;
  role?: "director" | "lead" | "specialist";
  focus: string;
  skills: readonly string[];
}

/** O que o Chief sabe do time ao decidir (alçada, quem está, quem poderia vir). */
export interface StaffingSnapshot {
  autonomy: { hire: HireMode; engagement: Engagement; maxAgents: number };
  team: TeamMemberBrief[];
  candidates: StaffingCandidate[];
}

/** Implementado pelo módulo de agentes; a conversa só conhece esta forma. */
export interface StaffingDirectory {
  snapshot(): Promise<StaffingSnapshot>;
  hire(tx: Transaction, templateIds: readonly string[], terms: { engagement: Engagement; engagedJob: string; hiredBy: "chief"; actor: string }): Promise<{ id: string; name: string; title: string }[]>;
}

export type ProposalStatus = "pending" | "accepted" | "declined";

export interface StaffingProposal {
  readonly id: string;
  readonly conversationId: string;
  /** Mensagem do CEO que originou o pedido e resposta do Chief que traz a proposta. */
  readonly questionSeq: number;
  readonly replySeq: number;
  /** Trabalho que será aberto quando o CEO decidir. */
  readonly offerId: string;
  readonly request: string;
  readonly templates: readonly { id: string; name: string; title: string; area: string }[];
  readonly engagement: Engagement;
  readonly status: ProposalStatus;
  readonly jobId: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
}

/** No máximo quantos agentes o Chief traz num pedido. */
export const MAX_HIRES = 2;

// Palavras que não dizem nada sobre a capacidade.
const STOP = new Set(
  "sobre entre todas todos todo toda como para pelos pelas pelo pela nossa nosso nossos nossas empresa equipe trabalho quero queria preciso precisa fazer criar analise analisar avalie avaliar mes semana este esta esse essa isso aquele ainda muito mais menos quando onde quais qual cada".split(" "),
);

/** Raízes de 5 letras das palavras relevantes (o bastante para "campanha"/"campanhas"). */
const stems = (text: string) =>
  new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );

const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

/**
 * Por regras: quem do catálogo cobre o pedido melhor do que todo o time? Pontua pela sobreposição
 * de palavras entre o pedido e o cargo, o foco e as habilidades. Só sugere com pelo menos duas
 * palavras em comum e vantagem sobre o melhor do time; especialista antes de diretor no empate.
 */
export function suggestHires(request: string, s: StaffingSnapshot): string[] {
  if (s.autonomy.hire === "never" || !s.candidates.length) return [];
  const want = stems(request);
  const score = (x: { title: string; focus: string; skills: readonly string[] }) => overlap(want, stems([x.title, x.focus, ...x.skills].join(" ")));
  const teamBest = Math.max(0, ...s.team.map(score));
  const order = { specialist: 0, lead: 1, director: 2 } as const;
  const best = s.candidates
    .map((c) => ({ c, n: score(c) }))
    .filter((x) => x.n >= 2 && x.n > teamBest)
    .sort((a, b) => b.n - a.n || order[a.c.role] - order[b.c.role]);
  return best.slice(0, 1).map((x) => x.c.id);
}

/** Texto da proposta, montado pelo servidor (exato, sem depender do modelo). */
export function proposalText(templates: StaffingProposal["templates"], engagement: Engagement) {
  const who = templates.map((t) => `${t.name} (${t.title})`).join(" e ");
  const how = engagement === "job" ? "só para este trabalho" : "para o time";
  return `Para este pedido o time ainda não tem quem cubra essa parte. Proponho trazer ${who} ${how}. Posso contratar e seguir, ou sigo com o time atual?`;
}
