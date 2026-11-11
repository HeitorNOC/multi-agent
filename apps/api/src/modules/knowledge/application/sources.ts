/**
 * Casos de uso das fontes do Cérebro: enviar (arquivo ou texto escrito), versionar, mudar de área,
 * revogar, listar, ver e baixar o original.
 *
 * Cada versão guarda o arquivo exatamente como chegou (para a citação abrir o original) e o texto
 * extraído (o que a busca lê). Texto escrito no Aurora vira uma versão Markdown com origem `text`.
 */
import { createHash } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { AppError, conflict, ensure, forbidden, invalid, notFound } from "../../../shared/errors.ts";
import { SourceId, type ActorId } from "../../../shared/ids.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { originalUrl } from "../domain/search-index.ts";
import {
  canRead,
  currentVersions,
  statusOf,
  EVERYONE,
  GENERAL_AREA,
  type ContentOrigin,
  type CurrentVersion,
  type IndexableVersion,
  type KnowledgeSource,
  type SourceVersion,
} from "../domain/source.ts";
import { extractText, FORMATS, formatOf, SUPPORTED_MEDIA_TYPES } from "../domain/text.ts";
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
  /** Áreas da empresa em que as fontes podem ser organizadas (além de `general`). */
  areas?: readonly { id: string; title: string }[];
  /** Extrai texto de qualquer formato aceito (PDF e Word inclusive). Padrão: só formatos de texto. */
  extract?: TextExtractor;
}

export type TextExtractor = (bytes: Uint8Array, mediaType: string) => Promise<string>;

/**
 * Uma versão nova: um arquivo (`filename`, `mediaType`, `contentBase64`) ou um texto escrito no
 * Aurora (`text`). Vigência padrão: agora.
 */
export interface FileInput {
  filename?: string;
  mediaType?: string;
  contentBase64?: string;
  text?: string;
  validFrom?: string;
}

export interface UploadInput extends FileInput {
  title: string;
  readers?: string[];
  supersedes?: SourceId | null;
  area?: string;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export async function uploadSource(deps: KnowledgeDeps, actor: ActorId, input: UploadInput) {
  const file = await prepareFile(deps, input, input.title);
  const area = checkArea(deps, input.area);
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
      area,
      createdAt: now,
      revokedAt: null,
      revokedBy: null,
      latestVersion: 1,
    });
    await s.versions.add({ ...file, sourceId: id, version: 1, uploadedBy: actor, createdAt: now });
    await s.events.append(stream.knowledge(id), {
      kind: "knowledge_source_created",
      detail: { actor, version: 1, content_sha: file.contentSha, supersedes: input.supersedes ?? null, area, origin: file.origin },
    });
  });
  deps.search.invalidate();
  return viewSource(deps, actor, id);
}

/** Publica uma versão nova (só o dono). As transações são serializadas, então o número é único. */
export async function addVersion(deps: KnowledgeDeps, actor: ActorId, id: SourceId, input: FileInput) {
  const title = (await deps.uow.read.sources.get(id))?.title ?? "texto";
  const file = await prepareFile(deps, input, title);
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

/** Muda a fonte de área (só o dono). Não cria versão: o conteúdo é o mesmo. */
export async function moveSource(deps: KnowledgeDeps, actor: ActorId, id: SourceId, rawArea: string) {
  const area = checkArea(deps, rawArea);
  await deps.uow.run(async (s) => {
    const source = await owned(s, actor, id);
    if (source.area === area) return;
    await s.sources.save({ ...source, area });
    await s.events.append(stream.knowledge(id), { kind: "knowledge_source_moved", detail: { actor, from: source.area, to: area } });
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
  const { current, latest } = await versionsById(deps);
  return {
    sources: sources.map((s) => summary(s, current.get(s.id), latest.get(s.id))),
    areas: areaList(deps).map((a) => ({ ...a, sources: sources.filter((s) => s.area === a.id && !s.revokedAt).length })),
    /** Busca por significado: modelo e quantos trechos já têm vetor; `null` se desligada. */
    semantic: await deps.search.semanticStatus(),
    media_types: SUPPORTED_MEDIA_TYPES,
    formats: SUPPORTED_MEDIA_TYPES.map((m) => ({ media_type: m, label: FORMATS[m].label, extensions: FORMATS[m].extensions })),
  };
}

export async function viewSource(deps: KnowledgeDeps, actor: ActorId, id: SourceId) {
  const source = await readable(deps.uow.read, actor, id);
  const { current, latest } = await versionsById(deps);
  const versions = await deps.uow.read.versions.list(id);
  return { ...summary(source, current.get(id), latest.get(id)), versions: versions.map(versionView) };
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

/** A versão que vale agora e a mais recente de cada fonte (não revogada). */
async function versionsById(deps: KnowledgeDeps) {
  const items = await deps.uow.read.versions.listIndexable();
  const current = new Map<string, CurrentVersion>(currentVersions(items, deps.clock.now()).map((c) => [c.sourceId, c]));
  const latest = new Map<string, IndexableVersion>();
  for (const v of items) if ((latest.get(v.sourceId)?.version ?? 0) < v.version) latest.set(v.sourceId, v);
  return { current, latest };
}

const areaList = (deps: KnowledgeDeps) => [{ id: GENERAL_AREA, title: "Geral" }, ...(deps.areas ?? []).filter((a) => a.id !== GENERAL_AREA)];

function checkArea(deps: KnowledgeDeps, area: string | undefined) {
  if (area === undefined || area === "") return GENERAL_AREA;
  ensure(areaList(deps).some((a) => a.id === area), () => invalid("unknown_area", `Área desconhecida: ${area}`));
  return area;
}

const slug = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "texto";

/** Bytes, texto extraído e metadados de uma versão: arquivo enviado ou texto escrito. */
async function prepareFile(deps: KnowledgeDeps, input: FileInput, title: string) {
  if (input.text !== undefined) {
    ensure(input.text.trim(), () => invalid("empty_text", "O texto está vazio"));
    return finish(deps, input, { bytes: new TextEncoder().encode(input.text), filename: `${slug(title)}.md`, mediaType: "text/markdown", origin: "text" });
  }
  const { filename, mediaType, contentBase64 } = input;
  ensure(filename && mediaType && contentBase64, () => invalid("missing_content", "Envie um arquivo ou um texto"));
  ensure(!/[\\/\0]/.test(filename), () => invalid("invalid_filename", "Nome de arquivo inválido"));
  const content = contentBase64.replace(/\s+/g, "");
  ensure(BASE64.test(content), () => invalid("invalid_base64", "content_base64 inválido"));
  const bytes = new Uint8Array(Buffer.from(content, "base64"));
  return finish(deps, input, { bytes, filename, mediaType, origin: "file" });
}

async function finish(
  deps: KnowledgeDeps,
  input: FileInput,
  file: { bytes: Uint8Array; filename: string; mediaType: string; origin: ContentOrigin },
) {
  const { bytes, mediaType } = file;
  ensure(bytes.length > 0, () => invalid("empty_file", "Arquivo vazio"));
  ensure(bytes.length <= deps.maxBytes, () => new AppError("too_large", "file_too_large", `Arquivo maior que ${deps.maxBytes} bytes`));
  const validFrom = input.validFrom === undefined ? deps.clock.now() : new Date(input.validFrom).toISOString();
  const text = deps.extract ? await deps.extract(bytes, mediaType) : extractText(bytes, mediaType);
  return { ...file, text, contentSha: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, validFrom };
}

function summary(s: KnowledgeSource, current: CurrentVersion | undefined, latest: IndexableVersion | undefined) {
  const shown = current ?? latest;
  return {
    id: s.id,
    title: s.title,
    owner: s.owner,
    readers: s.readers,
    supersedes: s.supersedes,
    area: s.area,
    /** Formato da versão que vale (ou da mais recente) e se veio de texto escrito. */
    format: shown ? { media_type: shown.mediaType, label: formatOf(shown.mediaType)?.label ?? shown.mediaType, origin: shown.origin } : null,
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
  origin: v.origin,
  format: formatOf(v.mediaType)?.label ?? v.mediaType,
  url: originalUrl(v.sourceId, v.version),
});
