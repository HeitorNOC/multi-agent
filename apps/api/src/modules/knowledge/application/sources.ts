/** Casos de uso das fontes do Cérebro: enviar, versionar, revogar, listar, ver e baixar o original. */
import { createHash } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { AppError, conflict, ensure, forbidden, invalid, notFound } from "../../../shared/errors.ts";
import { SourceId, type ActorId } from "../../../shared/ids.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { originalUrl } from "../domain/search-index.ts";
import { canRead, currentVersions, statusOf, EVERYONE, type CurrentVersion, type KnowledgeSource, type SourceVersion } from "../domain/source.ts";
import { extractText, SUPPORTED_MEDIA_TYPES } from "../domain/text.ts";
import type { KnowledgeStore } from "../infrastructure/sql-knowledge.ts";
import type { KnowledgeAnswerer } from "./answerers.ts";
import type { KnowledgeSearch } from "./knowledge-search.ts";

export interface KnowledgeDeps {
  uow: UnitOfWork<KnowledgeStore>;
  clock: Clock;
  search: KnowledgeSearch;
  answerer: KnowledgeAnswerer;
  /** Tamanho máximo de um arquivo, em bytes. */
  maxBytes: number;
}

export interface FileInput {
  filename: string;
  mediaType: string;
  contentBase64: string;
  /** Quando a versão passa a valer; padrão: agora. */
  validFrom?: string;
}

export interface UploadInput extends FileInput {
  title: string;
  readers?: string[];
  supersedes?: SourceId | null;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export async function uploadSource(deps: KnowledgeDeps, actor: ActorId, input: UploadInput) {
  const file = prepareFile(deps, input);
  const id = SourceId.create();
  const now = deps.clock.now();
  await deps.uow.run(async (s) => {
    if (input.supersedes) {
      const target = await s.sources.get(input.supersedes);
      ensure(target && canRead(target, actor), () => notFound("source_not_found", "Fonte a substituir não encontrada"));
      ensure(!target.revokedAt, () => conflict("source_revoked", "A fonte a substituir já foi revogada"));
      ensure(target.owner === actor, () => forbidden("not_owner", "Só o dono da fonte pode substituí-la"));
    }
    await s.sources.add({
      id,
      title: input.title.trim(),
      owner: actor,
      readers: input.readers ? [...new Set(input.readers)] : [EVERYONE],
      supersedes: input.supersedes ?? null,
      createdAt: now,
      revokedAt: null,
      revokedBy: null,
      latestVersion: 1,
    });
    await s.versions.add({ ...file, sourceId: id, version: 1, uploadedBy: actor, createdAt: now });
    await s.events.append(stream.knowledge(id), {
      kind: "knowledge_source_created",
      detail: { actor, version: 1, content_sha: file.contentSha, supersedes: input.supersedes ?? null },
    });
  });
  deps.search.invalidate();
  return viewSource(deps, actor, id);
}

/** Publica uma versão nova (só o dono). As transações são serializadas, então o número é único. */
export async function addVersion(deps: KnowledgeDeps, actor: ActorId, id: SourceId, input: FileInput) {
  const file = prepareFile(deps, input);
  await deps.uow.run(async (s) => {
    const source = await owned(s, actor, id);
    ensure(!source.revokedAt, () => conflict("source_revoked", "Fonte revogada não recebe versões novas"));
    const [latest] = await s.versions.list(id);
    ensure(latest?.contentSha !== file.contentSha, () => conflict("same_content", "Conteúdo idêntico à última versão"));
    const version = source.latestVersion + 1;
    await s.versions.add({ ...file, sourceId: id, version, uploadedBy: actor, createdAt: deps.clock.now() });
    await s.sources.save({ ...source, latestVersion: version });
    await s.events.append(stream.knowledge(id), { kind: "knowledge_version_added", detail: { actor, version, content_sha: file.contentSha } });
  });
  deps.search.invalidate();
  return viewSource(deps, actor, id);
}

export async function revokeSource(deps: KnowledgeDeps, actor: ActorId, id: SourceId) {
  const changed = await deps.uow.run(async (s) => {
    const source = await owned(s, actor, id);
    if (source.revokedAt) return false;
    await s.sources.save({ ...source, revokedAt: deps.clock.now(), revokedBy: actor });
    await s.events.append(stream.knowledge(id), { kind: "knowledge_source_revoked", detail: { actor } });
    return true;
  });
  deps.search.invalidate();
  return { ...(await viewSource(deps, actor, id)), repeated: !changed };
}

export async function listSources(deps: KnowledgeDeps, actor: ActorId) {
  const sources = (await deps.uow.read.sources.list()).filter((s) => canRead(s, actor));
  const current = await currentById(deps);
  return { sources: sources.map((s) => summary(s, current.get(s.id))), media_types: SUPPORTED_MEDIA_TYPES };
}

export async function viewSource(deps: KnowledgeDeps, actor: ActorId, id: SourceId) {
  const source = await readable(deps.uow.read, actor, id);
  const current = (await currentById(deps)).get(id);
  const versions = await deps.uow.read.versions.list(id);
  return { ...summary(source, current), versions: versions.map(versionView) };
}

/** O arquivo exatamente como foi enviado: o destino de cada citação. */
export async function originalFile(deps: KnowledgeDeps, actor: ActorId, id: SourceId, version: number) {
  await readable(deps.uow.read, actor, id);
  const stored = await deps.uow.read.versions.get(id, version);
  ensure(stored, () => notFound("version_not_found", "Versão não encontrada"));
  return { bytes: stored.bytes, mediaType: stored.mediaType, filename: stored.filename };
}

async function readable(s: KnowledgeStore, actor: ActorId, id: SourceId) {
  const source = await s.sources.get(id);
  ensure(source && canRead(source, actor), () => notFound("source_not_found", "Fonte não encontrada"));
  return source;
}

async function owned(s: KnowledgeStore, actor: ActorId, id: SourceId) {
  const source = await readable(s, actor, id);
  ensure(source.owner === actor, () => forbidden("not_owner", "Só o dono da fonte pode alterá-la"));
  return source;
}

async function currentById(deps: KnowledgeDeps) {
  const current = currentVersions(await deps.uow.read.versions.listIndexable(), deps.clock.now());
  return new Map<string, CurrentVersion>(current.map((c) => [c.sourceId, c]));
}

function prepareFile(deps: KnowledgeDeps, input: FileInput) {
  ensure(!/[\\/\0]/.test(input.filename), () => invalid("invalid_filename", "Nome de arquivo inválido"));
  const content = input.contentBase64.replace(/\s+/g, "");
  ensure(BASE64.test(content), () => invalid("invalid_base64", "content_base64 inválido"));
  const bytes = new Uint8Array(Buffer.from(content, "base64"));
  ensure(bytes.length > 0, () => invalid("empty_file", "Arquivo vazio"));
  ensure(bytes.length <= deps.maxBytes, () => new AppError("too_large", "file_too_large", `Arquivo maior que ${deps.maxBytes} bytes`));
  const validFrom = input.validFrom === undefined ? deps.clock.now() : new Date(input.validFrom).toISOString();
  return {
    filename: input.filename,
    mediaType: input.mediaType,
    bytes,
    text: extractText(bytes, input.mediaType),
    contentSha: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    validFrom,
  };
}

function summary(s: KnowledgeSource, current: CurrentVersion | undefined) {
  return {
    id: s.id,
    title: s.title,
    owner: s.owner,
    readers: s.readers,
    supersedes: s.supersedes,
    created_at: s.createdAt,
    revoked_at: s.revokedAt,
    latest_version: s.latestVersion,
    /** Versão que entra nas respostas agora; null se revogada ou ainda sem versão vigente. */
    current_version: s.revokedAt ? null : (current?.version ?? null),
    superseded_by: current?.supersededBy ?? null,
    status: statusOf(s, current),
  };
}

const versionView = (v: SourceVersion) => ({
  version: v.version,
  filename: v.filename,
  media_type: v.mediaType,
  size_bytes: v.sizeBytes,
  content_sha: v.contentSha,
  valid_from: v.validFrom,
  uploaded_by: v.uploadedBy,
  created_at: v.createdAt,
  url: originalUrl(v.sourceId, v.version),
});
