/**
 * Alçadas do Chief of Staff sobre o time: o que ele faz sozinho e o que propõe ao CEO.
 *
 * - `hire`: trazer do catálogo um agente que falta para um pedido — nunca, propor (o CEO aprova na
 *   conversa) ou contratar sozinho dentro dos limites.
 * - `engagement`: quem o Chief contrata entra só para aquele trabalho (sai ao final) ou fica.
 * - `maxAgents`: quantos agentes um trabalho pode envolver.
 * - `areas`: em quais áreas do catálogo o Chief pode contratar (`null` = todas).
 * - `edit` / `remove`: ajustar orientações e hierarquia, ou tirar alguém do time. Guardados desde
 *   já; o Chief passa a usá-los quando revisar o time durante a execução (N3).
 *
 * O CEO sempre pode tudo pela tela de Agentes; as alçadas valem para o que o Chief decide.
 */
import { ensure, invalid } from "../../../shared/errors.ts";

export type HireMode = "never" | "propose" | "auto";
export type Engagement = "job" | "permanent";
export type EditMode = "never" | "propose" | "auto";
export type RemoveMode = "never" | "propose";

export interface ChiefAutonomy {
  readonly hire: HireMode;
  readonly engagement: Engagement;
  readonly maxAgents: number;
  readonly areas: readonly string[] | null;
  readonly edit: EditMode;
  readonly remove: RemoveMode;
}

export const AGENTS_PER_JOB = { min: 1, max: 12 } as const;

/** Padrão: o Chief propõe, quem ele traz fica só no trabalho, até 8 agentes por trabalho. */
export const DEFAULT_AUTONOMY: ChiefAutonomy = { hire: "propose", engagement: "job", maxAgents: 8, areas: null, edit: "propose", remove: "never" };

const oneOf = <T extends string>(value: unknown, options: readonly T[], code: string, label: string): T => {
  ensure(typeof value === "string" && (options as readonly string[]).includes(value), () => invalid(code, `${label}: escolha ${options.join(", ")}`));
  return value as T;
};

/** Valida e completa as alçadas (o que não vier fica como está). */
export function applyAutonomy(current: ChiefAutonomy, input: Partial<Record<keyof ChiefAutonomy, unknown>>, knownAreas: ReadonlySet<string>): ChiefAutonomy {
  const next = { ...current } as { -readonly [K in keyof ChiefAutonomy]: ChiefAutonomy[K] };
  if (input.hire !== undefined) next.hire = oneOf(input.hire, ["never", "propose", "auto"], "invalid_hire_mode", "Contratar");
  if (input.engagement !== undefined) next.engagement = oneOf(input.engagement, ["job", "permanent"], "invalid_engagement", "Tipo de contratação");
  if (input.edit !== undefined) next.edit = oneOf(input.edit, ["never", "propose", "auto"], "invalid_edit_mode", "Ajustar o time");
  if (input.remove !== undefined) next.remove = oneOf(input.remove, ["never", "propose"], "invalid_remove_mode", "Tirar do time");
  if (input.maxAgents !== undefined) {
    const n = input.maxAgents;
    ensure(Number.isInteger(n) && (n as number) >= AGENTS_PER_JOB.min && (n as number) <= AGENTS_PER_JOB.max, () =>
      invalid("invalid_max_agents", `Agentes por trabalho: de ${AGENTS_PER_JOB.min} a ${AGENTS_PER_JOB.max}`),
    );
    next.maxAgents = n as number;
  }
  if (input.areas !== undefined) {
    if (input.areas === null) next.areas = null;
    else {
      ensure(Array.isArray(input.areas) && input.areas.length > 0 && input.areas.every((a) => typeof a === "string" && knownAreas.has(a)), () =>
        invalid("invalid_areas", "Escolha áreas do catálogo (ou todas)"),
      );
      next.areas = [...new Set(input.areas as string[])];
    }
  }
  return next;
}

/** O Chief pode trazer este agente? (modo e área) */
export const mayHire = (a: ChiefAutonomy, area: string) => a.hire !== "never" && (a.areas === null || a.areas.includes(area));
