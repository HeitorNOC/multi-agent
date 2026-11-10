/** O que o Cérebro guarda. Implementação em `infrastructure/`. */
import type { ActorId, SourceId } from "../../../shared/ids.ts";
import type { IndexableVersion, KnowledgeSource, SourceVersion, StoredVersion } from "./source.ts";

export interface SourceRepository {
  get(id: SourceId): Promise<KnowledgeSource | undefined>;
  add(source: KnowledgeSource): Promise<void>;
  /** Grava revogação e última versão. */
  save(source: KnowledgeSource): Promise<void>;
  /** Da mais antiga para a mais nova. */
  list(): Promise<KnowledgeSource[]>;
  /** Passa dono e leitura de uma pessoa para outra (a conta que assume o operador local). */
  transferActor(from: ActorId, to: ActorId): Promise<void>;
}

export interface VersionRepository {
  add(version: StoredVersion): Promise<void>;
  /** Com o arquivo original. */
  get(sourceId: SourceId, version: number): Promise<StoredVersion | undefined>;
  /** Da mais nova para a mais antiga, sem o arquivo. */
  list(sourceId: SourceId): Promise<SourceVersion[]>;
  /** Todas as versões de fontes não revogadas, com o texto. */
  listIndexable(): Promise<IndexableVersion[]>;
}
