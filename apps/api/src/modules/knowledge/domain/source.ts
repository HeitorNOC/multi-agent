/**
 * Cérebro: fontes de conhecimento com dono, leitores, versões e vigência.
 *
 * Regras que decidem o que entra numa resposta, nesta ordem:
 *  1. Acesso: só fontes que a pessoa pode ler (dono, lista de leitores ou "*").
 *  2. Revogação: fonte revogada sai das respostas na hora (o histórico continua guardado).
 *  3. Vigência: de cada fonte vale a versão mais nova cuja data de vigência já chegou.
 *  4. Substituição: se uma fonte vigente substitui outra, a substituída sai das respostas.
 *  5. Evidência mínima (na busca): sem trecho suficiente, a resposta é abstenção, nunca palpite.
 * Assim um conflito entre fontes é resolvido por metadado explícito e auditável.
 */
import type { ActorId, SourceId } from "../../../shared/ids.ts";

/** Leitor especial: todos da instalação. */
export const EVERYONE = "*";

export interface KnowledgeSource {
  readonly id: SourceId;
  readonly title: string;
  readonly owner: ActorId;
  /** Identidades que podem ler, ou `["*"]`. */
  readonly readers: readonly string[];
  readonly supersedes: SourceId | null;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: ActorId | null;
  readonly latestVersion: number;
}

/** Metadados de uma versão (sem o arquivo). */
export interface SourceVersion {
  readonly sourceId: SourceId;
  readonly version: number;
  readonly filename: string;
  readonly mediaType: string;
  readonly contentSha: string;
  readonly sizeBytes: number;
  readonly validFrom: string;
  readonly uploadedBy: ActorId;
  readonly createdAt: string;
}

/** Uma versão com o arquivo original e o texto extraído. */
export interface StoredVersion extends SourceVersion {
  readonly bytes: Uint8Array;
  readonly text: string;
}

/** O que a busca precisa de cada versão de fonte não revogada. */
export interface IndexableVersion {
  readonly sourceId: SourceId;
  readonly title: string;
  readonly owner: ActorId;
  readonly readers: readonly string[];
  readonly supersedes: SourceId | null;
  readonly version: number;
  readonly validFrom: string;
  readonly text: string;
}

export interface CurrentVersion extends IndexableVersion {
  readonly supersededBy: SourceId | null;
}

export type SourceStatus = "current" | "revoked" | "not_yet_valid" | "superseded";

export const canRead = (source: { owner: string; readers: readonly string[] }, actor: string) =>
  source.owner === actor || source.readers.includes(EVERYONE) || source.readers.includes(actor);

export const isOpenToEveryone = (source: { readers: readonly string[] }) => source.readers.includes(EVERYONE);

/** Como um agente aparece na lista de leitores de uma fonte restrita. */
export const agentReader = (agentId: string) => `agent:${agentId}`;

/** Um agente lê fontes abertas a todos e as restritas em que foi incluído como leitor. */
export const agentsCanRead = (source: { readers: readonly string[] }, agentIds: readonly string[]) =>
  isOpenToEveryone(source) || agentIds.some((id) => source.readers.includes(agentReader(id)));

/** Aplica vigência e substituição: de cada fonte, a versão vigente em `now`. */
export function currentVersions(items: readonly IndexableVersion[], now: string): CurrentVersion[] {
  const latest = new Map<SourceId, IndexableVersion>();
  for (const item of items) {
    if (item.validFrom > now) continue;
    const prior = latest.get(item.sourceId);
    if (!prior || item.version > prior.version) latest.set(item.sourceId, item);
  }
  const supersededBy = new Map<SourceId, SourceId>();
  for (const item of latest.values()) if (item.supersedes) supersededBy.set(item.supersedes, item.sourceId);
  return [...latest.values()].map((item) => ({ ...item, supersededBy: supersededBy.get(item.sourceId) ?? null }));
}

export function statusOf(source: KnowledgeSource, current: CurrentVersion | undefined): SourceStatus {
  if (source.revokedAt) return "revoked";
  if (!current) return "not_yet_valid";
  return current.supersededBy ? "superseded" : "current";
}
