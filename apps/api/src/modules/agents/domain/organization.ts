/** A empresa desta instalação: identidade, objetivos e políticas gerais, e se o primeiro uso terminou. */
import { ensure, invalid } from "../../../shared/errors.ts";

export interface Organization {
  readonly name: string;
  readonly sector: string;
  readonly objectives: string;
  readonly policies: string;
  /** Quando o assistente "Montar sua empresa" foi concluído. */
  readonly setupCompletedAt: string | null;
  readonly updatedAt: string;
}

export const EMPTY_ORGANIZATION: Organization = { name: "", sector: "", objectives: "", policies: "", setupCompletedAt: null, updatedAt: "" };

export function describeOrganization(current: Organization, input: { name: string; sector?: string; objectives?: string; policies?: string }, now: string): Organization {
  const name = input.name.trim();
  ensure(name.length >= 2 && name.length <= 120, () => invalid("invalid_name", "Nome da empresa deve ter de 2 a 120 caracteres"));
  return {
    ...current,
    name,
    sector: (input.sector ?? current.sector).trim().slice(0, 120),
    objectives: (input.objectives ?? current.objectives).trim().slice(0, 2000),
    policies: (input.policies ?? current.policies).trim().slice(0, 4000),
    updatedAt: now,
  };
}
