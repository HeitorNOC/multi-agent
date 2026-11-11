/** Repositórios SQL do Cérebro (mesmo SQL para SQLite e PostgreSQL). */
import type { ActorId, SourceId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Clock } from "../../../shared/clock.ts";
import { fromBytes, toBytes } from "../domain/embeddings.ts";
import type { SourceRepository, VersionRepository } from "../domain/repositories.ts";
import type { ContentOrigin, IndexableVersion, KnowledgeSource, SourceVersion, StoredVersion } from "../domain/source.ts";

type SourceRow = {
  id: string;
  title: string;
  owner: string;
  readers: string;
  supersedes: string | null;
  area: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  latest_version: number | string;
};

type VersionRow = {
  source_id: string;
  version: number | string;
  filename: string;
  media_type: string;
  content_sha: string;
  size_bytes: number | string;
  valid_from: string;
  uploaded_by: string;
  created_at: string;
  origin: string;
};

const toSource = (r: SourceRow): KnowledgeSource => ({
  id: r.id as SourceId,
  title: r.title,
  owner: r.owner as ActorId,
  readers: JSON.parse(r.readers) as string[],
  supersedes: r.supersedes as SourceId | null,
  area: r.area,
  createdAt: r.created_at,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by as ActorId | null,
  latestVersion: Number(r.latest_version),
});

const toVersion = (r: VersionRow): SourceVersion => ({
  sourceId: r.source_id as SourceId,
  version: Number(r.version),
  filename: r.filename,
  mediaType: r.media_type,
  contentSha: r.content_sha,
  sizeBytes: Number(r.size_bytes),
  validFrom: r.valid_from,
  uploadedBy: r.uploaded_by as ActorId,
  createdAt: r.created_at,
  origin: r.origin as ContentOrigin,
});

const VERSION_COLUMNS = "source_id, version, filename, media_type, content_sha, size_bytes, valid_from, uploaded_by, created_at, origin";

export class SqlSourceRepository implements SourceRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: SourceId) {
    const row = await this.sql.one<SourceRow>("SELECT * FROM knowledge_sources WHERE id = $1", [id]);
    return row && toSource(row);
  }

  async add(s: KnowledgeSource) {
    await this.sql.run(
      `INSERT INTO knowledge_sources (id, title, owner, readers, supersedes, created_at, revoked_at, revoked_by, latest_version, area, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM knowledge_sources))`,
      [s.id, s.title, s.owner, JSON.stringify(s.readers), s.supersedes, s.createdAt, s.revokedAt, s.revokedBy, s.latestVersion, s.area],
    );
  }

  async save(s: KnowledgeSource) {
    await this.sql.run("UPDATE knowledge_sources SET revoked_at = $2, revoked_by = $3, latest_version = $4, area = $5 WHERE id = $1", [
      s.id,
      s.revokedAt,
      s.revokedBy,
      s.latestVersion,
      s.area,
    ]);
  }

  async list() {
    return (await this.sql.all<SourceRow>("SELECT * FROM knowledge_sources ORDER BY ordinal")).map(toSource);
  }

  async transferActor(from: ActorId, to: ActorId) {
    await this.sql.run("UPDATE knowledge_sources SET owner = $2 WHERE owner = $1", [from, to]);
    // Leitores são uma lista JSON de textos: troca o item inteiro, com as aspas.
    await this.sql.run("UPDATE knowledge_sources SET readers = REPLACE(readers, $1, $2)", [JSON.stringify(from), JSON.stringify(to)]);
  }
}

export class SqlVersionRepository implements VersionRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async add(v: StoredVersion) {
    await this.sql.run(
      `INSERT INTO knowledge_versions (${VERSION_COLUMNS}, bytes, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [v.sourceId, v.version, v.filename, v.mediaType, v.contentSha, v.sizeBytes, v.validFrom, v.uploadedBy, v.createdAt, v.origin, v.bytes, v.text],
    );
  }

  async get(sourceId: SourceId, version: number) {
    const row = await this.sql.one<VersionRow & { bytes: Uint8Array; text: string }>(
      `SELECT ${VERSION_COLUMNS}, bytes, text FROM knowledge_versions WHERE source_id = $1 AND version = $2`,
      [sourceId, version],
    );
    return row && { ...toVersion(row), bytes: new Uint8Array(row.bytes), text: row.text };
  }

  async list(sourceId: SourceId) {
    const rows = await this.sql.all<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM knowledge_versions WHERE source_id = $1 ORDER BY version DESC`, [sourceId]);
    return rows.map(toVersion);
  }

  async listIndexable(): Promise<IndexableVersion[]> {
    const rows = await this.sql.all<SourceRow & { version: number | string; valid_from: string; media_type: string; origin: string; text: string }>(
      `SELECT s.*, v.version, v.valid_from, v.media_type, v.origin, v.text
         FROM knowledge_versions v JOIN knowledge_sources s ON s.id = v.source_id
        WHERE s.revoked_at IS NULL
        ORDER BY s.ordinal, v.version`,
    );
    return rows.map((r) => {
      const s = toSource(r);
      return {
        sourceId: s.id,
        title: s.title,
        owner: s.owner,
        readers: s.readers,
        supersedes: s.supersedes,
        area: s.area,
        version: Number(r.version),
        validFrom: r.valid_from,
        mediaType: r.media_type,
        origin: r.origin as ContentOrigin,
        text: r.text,
      };
    });
  }
}

/** Vetores dos trechos (busca por significado), por modelo e hash do texto vetorizado. */
export class SqlEmbeddingRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async list(model: string): Promise<Map<string, Float32Array>> {
    const rows = await this.sql.all<{ content_key: string; vector: Uint8Array }>("SELECT content_key, vector FROM knowledge_embeddings WHERE model = $1", [model]);
    return new Map(rows.map((r) => [r.content_key, fromBytes(new Uint8Array(r.vector))]));
  }
  async put(model: string, key: string, vector: Float32Array, at: string) {
    await this.sql.run(
      `INSERT INTO knowledge_embeddings (model, content_key, dims, vector, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (model, content_key) DO NOTHING`,
      [model, key, vector.length, toBytes(vector), at],
    );
  }
}

export interface KnowledgeStore {
  sources: SourceRepository;
  versions: VersionRepository;
  embeddings: SqlEmbeddingRepository;
  events: EventLog;
}

export const knowledgeStore =
  (clock: Clock) =>
  (sql: Sql): KnowledgeStore => ({
    sources: new SqlSourceRepository(sql),
    versions: new SqlVersionRepository(sql),
    embeddings: new SqlEmbeddingRepository(sql),
    events: new SqlEventLog(sql, clock),
  });
