/**
 * Memória (N5), sem modelo e determinística:
 *
 * - Da conversa: decisões registradas à parte (aprovou o plano, aceitou contratar, "fica decidido
 *   usar Kafka"), um resumo das mensagens antigas e as mensagens antigas que voltam a importar
 *   quando o assunto reaparece. Assim um projeto de semanas não perde o fio.
 * - Da empresa: fatos estáveis que o CEO edita (produtos, tom de voz, stack, clientes).
 * - Orçamento de contexto: cada parte do prompt entra por prioridade, dentro de um limite.
 */
import { normalize } from "./chief-of-staff.ts";
import type { Message } from "./conversation.ts";

export interface MemoryDecision {
  readonly text: string;
  /** De onde veio: o CEO aprovando algo, uma afirmação na conversa, ou o Chief registrando. */
  readonly kind: "plan_approved" | "plan_cancelled" | "staffing" | "stated";
  readonly seq: number;
  readonly at: string;
}

export interface ConversationMemory {
  readonly conversationId: string;
  readonly summary: string;
  readonly decisions: readonly MemoryDecision[];
  /** Até onde o resumo cobre (seq da última mensagem resumida). */
  readonly summarizedSeq: number;
  readonly updatedAt: string;
}

/** Mensagens recentes que o Chief lê inteiras; as anteriores entram pelo resumo. */
export const MEMORY_WINDOW = 24;
export const MAX_DECISIONS = 40;

/** "Fica decidido…", "decidimos…", "vamos usar…": a frase vira decisão registrada (sem modelo). */
const STATED = /\b(fica decidido|ficou decidido|decidimos|decidido que|vamos usar|vamos seguir com|a decisao e|nossa decisao)\b/;

export function statedDecisions(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    // Pergunta ("o que decidimos?") não é decisão.
    .filter((s) => s.length >= 12 && s.length <= 300 && !s.endsWith("?") && STATED.test(normalize(s)))
    .slice(0, 3);
}

/** Pergunta sobre o que foi combinado ("o que decidimos?", "quais as decisões?"). */
export const asksDecisions = (text: string) => /\b(o que (nos )?decidimos|quais (foram )?as decisoes|o que ficou (decidido|combinado)|decisoes (ate agora|tomadas))\b/.test(normalize(text));

/** Junta decisões novas sem repetir (mesmo texto normalizado) e mantém as mais recentes. */
export function addDecisions(current: readonly MemoryDecision[], fresh: readonly MemoryDecision[]): MemoryDecision[] {
  const seen = new Set(current.map((d) => normalize(d.text)));
  const merged = [...current];
  for (const d of fresh) {
    const key = normalize(d.text);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(d);
  }
  return merged.slice(-MAX_DECISIONS);
}

const firstSentence = (text: string, max = 180) => {
  const s = /^(.{10,}?[.!?])(\s|$)/s.exec(text.trim())?.[1] ?? text.trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * Resumo das mensagens fora da janela: uma linha por troca (o que o gestor pediu e o que o Chief
 * fez). Extrativo: nada que não esteja nas mensagens.
 */
export function summarizeOlder(messages: readonly Message[], window = MEMORY_WINDOW): { summary: string; upTo: number } {
  const older = messages.slice(0, Math.max(0, messages.length - window));
  if (!older.length) return { summary: "", upTo: 0 };
  const lines: string[] = [];
  for (const m of older) {
    if (m.role === "user") lines.push(`Gestor: ${firstSentence(m.text)}`);
    else if (m.jobId) lines.push(`Chief: abriu trabalho — ${firstSentence(m.text, 140)}`);
    else lines.push(`Chief: ${firstSentence(m.text, 140)}`);
  }
  // As últimas linhas importam mais: mantém o fim se passar do limite.
  let summary = "";
  for (const line of lines.reverse()) {
    if (summary.length + line.length > 2400) break;
    summary = summary ? `${line}\n${summary}` : line;
  }
  return { summary, upTo: older.at(-1)!.seq };
}

const words = (text: string) => new Set(normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 5));

/** Mensagens antigas (fora da janela) que têm a ver com a mensagem atual, as mais parecidas primeiro. */
export function recallOlder(messages: readonly Message[], text: string, window = MEMORY_WINDOW, limit = 3): { de: string; texto: string }[] {
  const older = messages.slice(0, Math.max(0, messages.length - window));
  const want = words(text);
  if (!want.size) return [];
  return older
    .map((m) => ({ m, n: [...words(m.text)].filter((w) => want.has(w)).length }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ m }) => ({ de: m.role === "user" ? "gestor" : "chief_of_staff", texto: m.text.slice(0, 800) }));
}

/**
 * Monta partes do contexto por prioridade dentro de um orçamento de caracteres: entra inteira a
 * parte que cabe; uma parte que não cabe é cortada ou fica de fora (as de menor prioridade primeiro).
 */
export function withinBudget<T extends Record<string, unknown>>(parts: { key: keyof T & string; value: unknown; priority: number }[], budget: number): Partial<T> {
  const out: Record<string, unknown> = {};
  let used = 0;
  for (const part of [...parts].sort((a, b) => a.priority - b.priority)) {
    if (part.value === null || part.value === undefined) {
      out[part.key] = null;
      continue;
    }
    const size = JSON.stringify(part.value).length;
    if (used + size <= budget) {
      out[part.key] = part.value;
      used += size;
    } else if (Array.isArray(part.value)) {
      // Lista: entram os itens do fim (os mais recentes), enquanto couber.
      const kept: unknown[] = [];
      for (const item of [...part.value].reverse()) {
        const s = JSON.stringify(item).length;
        if (used + s > budget) break;
        kept.unshift(item);
        used += s;
      }
      out[part.key] = kept;
    } else out[part.key] = null;
  }
  return out as Partial<T>;
}
