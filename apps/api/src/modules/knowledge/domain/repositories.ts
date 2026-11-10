/** O que o Cérebro guarda. Implementação em `infrastructure/`. */
import type { SourceId } from "../../../shared/ids.ts";
import type { IndexableVersion, KnowledgeSource, SourceVersion, StoredVersion } from "./source.ts";

export interface SourceRepository {
  get(id: SourceId): Promise<KnowledgeSource | undefined>;
  add(source: KnowledgeSource): Promise<void>;
  /** Grava revogação e última versão. */
  save(source: KnowledgeSource): Promise<void>;
  /** Da mais antiga para a mais nova. */
  list(): Promise<KnowledgeSource[]>;
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
