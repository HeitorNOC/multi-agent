/**
 * Especialistas que o Chief of Staff pode escalar num trabalho aberto. Hoje vêm de um catálogo
 * JSON; o módulo de agentes (F2) passa a fornecer os agentes instalados na empresa, com a mesma forma.
 */
import { readFileSync } from "node:fs";

export interface CatalogAgent {
  readonly id: string;
  readonly title: string;
  readonly focus: string;
  readonly domain: string;
}

/** Lê os especialistas de um catálogo no formato `{ agents: [{ id, kind, title, focus, domain }] }`. */
export function loadSpecialists(path: string | URL): CatalogAgent[] {
  const catalog = JSON.parse(readFileSync(path, "utf8")) as { agents?: Record<string, unknown>[] };
  return (catalog.agents ?? [])
    .filter((a) => a.kind === "specialist")
    .map((a) => ({ id: String(a.id), title: String(a.title), focus: String(a.focus), domain: String(a.domain) }));
}
