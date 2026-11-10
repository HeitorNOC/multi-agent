/**
 * Especialistas que o Chief of Staff pode escalar num trabalho aberto.
 *
 * Por enquanto vem do catálogo do Aurora (`demo-enterprise/catalog.json`), só os especialistas.
 * O E4 troca esta fonte pelos agentes instalados na empresa, com a mesma forma.
 */
import { readFileSync } from "node:fs";

export interface CatalogAgent {
  id: string;
  title: string;
  focus: string;
  domain: string;
}

export function loadSpecialists(
  path: URL = new URL("../../../demo-enterprise/catalog.json", import.meta.url),
): CatalogAgent[] {
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  return catalog.agents
    .filter((a: any) => a.kind === "specialist")
    .map((a: any) => ({ id: String(a.id), title: String(a.title), focus: String(a.focus), domain: String(a.domain) }));
}
