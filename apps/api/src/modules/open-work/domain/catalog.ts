/**
 * Quem o Chief of Staff pode escalar num trabalho aberto: os agentes do time da empresa. O módulo
 * de agentes implementa `TeamDirectory`; o trabalho aberto só conhece esta forma.
 */
export interface CatalogAgent {
  /** Identificador estável, usado no plano e no passo `specialist:<id>`. */
  readonly id: string;
  /** Como o agente se apresenta (por exemplo, "Bruno, Analista de compras"). */
  readonly title: string;
  readonly focus: string;
  readonly domain: string;
  /** Orientações que a empresa deu a este agente. */
  readonly instructions?: string;
  /** O que ele faz e o que entrega (do catálogo); vazio em agentes criados pela empresa. */
  readonly responsibilities?: readonly string[];
  readonly deliverables?: readonly string[];
}

export interface TeamDirectory {
  /** Agentes ativos do time, na ordem de contratação. */
  members(): Promise<CatalogAgent[]>;
}

/** Time fixo (testes e ferramentas). */
export const staticTeam = (agents: readonly CatalogAgent[]): TeamDirectory => ({ members: async () => [...agents] });
