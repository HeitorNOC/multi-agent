/**
 * Cérebro (E3): fontes de conhecimento com dono, acesso, versões e vigência, e consulta com
 * citação até o arquivo original.
 *
 * Regras que decidem o que entra numa resposta, nesta ordem:
 *  1. Acesso: só fontes que o usuário pode ler (dono, lista de leitores ou "*").
 *  2. Revogação: fonte revogada sai das respostas imediatamente (o histórico continua guardado).
 *  3. Vigência: de cada fonte vale a versão mais nova cuja data de vigência já chegou.
 *  4. Substituição: se uma fonte vigente substitui outra, a substituída sai das respostas.
 *  5. Evidência mínima: o trecho precisa conter termos suficientes da pergunta; sem trecho
 *     suficiente, a resposta é uma abstenção, nunca um palpite.
 * Assim um conflito entre fontes é resolvido por metadado explícito e auditável.
 */
import { createHash, randomUUID } from "node:crypto";
import type { IndexableKnowledge, JourneyLedger, KnowledgeSource } from "../ledger/journey-ledger.ts";
import type { KnowledgeAnswerer, Passage, AnswerTrace } from "./answerer.ts";
import { Bm25Index, type KnowledgeIndex } from "./bm25.ts";
import { chunk, extractText, KnowledgeError, SUPPORTED_MEDIA_TYPES } from "./text.ts";

export { KnowledgeError };

export interface KnowledgeDeps {
  ledger: JourneyLedger;
  answerer: KnowledgeAnswerer;
  now?: () => string;
  maxBytes?: number;
  /** Troca o índice (por exemplo, por um semântico). Padrão: BM25. */
  buildIndex?: (passages: { id: string; text: string }[]) => KnowledgeIndex;
}

const MAX_TITLE = 200;
const MAX_QUESTION = 1000;
const MAX_READERS = 200;
const PASSAGES = 5;
const INDEX_TTL_MS = 60_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function requireThat(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new KnowledgeError(status, message);
}
function onlyFields(body: unknown, allowed: string[]): asserts body is Record<string, any> {
  requireThat(
    body !== null && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((k) => allowed.includes(k)),
    400,
    "Campo não permitido",
  );
}
const canRead = (s: { owner: string; readers: string[] }, actor: string) =>
  s.owner === actor || s.readers.includes("*") || s.readers.includes(actor);

interface Current extends IndexableKnowledge {
  supersededBy: string | null;
}

/** Aplica vigência e substituição: de cada fonte, a versão vigente; substituídas ficam de fora. */
export function currentKnowledge(items: IndexableKnowledge[], now: string): Current[] {
  const latest = new Map<string, IndexableKnowledge>();
  for (const item of items) {
    if (item.validFrom > now) continue;
    const prior = latest.get(item.source);
    if (!prior || item.version > prior.version) latest.set(item.source, item);
  }
  const supersededBy = new Map<string, string>();
  for (const item of latest.values()) if (item.supersedes) supersededBy.set(item.supersedes, item.source);
  return [...latest.values()].map((item) => ({ ...item, supersededBy: supersededBy.get(item.source) ?? null }));
}

export class KnowledgeService {
  private readonly ledger: JourneyLedger;
  private readonly answerer: KnowledgeAnswerer;
  private readonly now: () => string;
  private readonly maxBytes: number;
  private readonly buildIndex: (passages: { id: string; text: string }[]) => KnowledgeIndex;
  private generation = 0;
  private cache: { key: string; built: number; index: KnowledgeIndex; passages: Map<string, Omit<Passage, "n" | "matched" | "score"> & { readers: string[]; owner: string }> } | null = null;

  constructor(deps: KnowledgeDeps) {
    this.ledger = deps.ledger;
    this.answerer = deps.answerer;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.maxBytes = deps.maxBytes ?? 5_000_000;
    this.buildIndex = deps.buildIndex ?? ((p) => new Bm25Index(p));
  }

  /** Cria a fonte com a primeira versão, numa única transação. */
  async upload(actor: string, body: unknown) {
    onlyFields(body, ["title", "filename", "media_type", "content_base64", "readers", "supersedes", "valid_from"]);
    const title = this.title(body.title);
    const readers = this.readers(body.readers);
    const file = this.file(body);
    const validFrom = this.validFrom(body.valid_from);
    const supersedes = body.supersedes === undefined || body.supersedes === null ? null : body.supersedes;
    if (supersedes !== null) {
      requireThat(typeof supersedes === "string", 400, "supersedes inválido");
      const target = await this.ledger.getKnowledgeSource(supersedes);
      requireThat(target && canRead(target, actor), 404, "Fonte a substituir não encontrada");
      requireThat(!target.revoked, 409, "A fonte a substituir já foi revogada");
      requireThat(target.owner === actor, 403, "Só o dono da fonte pode substituí-la");
    }
    const id = randomUUID();
    const created = this.now();
    await this.ledger.transaction(async (tx) => {
      await tx.createKnowledgeSource({ id, title, owner: actor, readers, supersedes, created });
      await tx.addKnowledgeVersion({ source: id, version: 1, ...file, validFrom, uploadedBy: actor, created });
      await tx.appendEvent(`knowledge:${id}`, "knowledge_source_created", { actor, version: 1, content_sha: file.contentSha, supersedes });
    });
    this.generation++;
    return this.get(actor, id);
  }

  /** Publica uma versão nova de uma fonte existente (só o dono). */
  async addVersion(actor: string, id: string, body: unknown) {
    onlyFields(body, ["filename", "media_type", "content_base64", "valid_from"]);
    const source = await this.owned(actor, id);
    requireThat(!source.revoked, 409, "Fonte revogada não recebe versões novas");
    const file = this.file(body);
    const validFrom = this.validFrom(body.valid_from);
    const [latest] = await this.ledger.listKnowledgeVersions(id);
    requireThat(!latest || latest.contentSha !== file.contentSha, 409, "Conteúdo idêntico à última versão");
    const version = source.latestVersion + 1;
    try {
      await this.ledger.transaction(async (tx) => {
        await tx.addKnowledgeVersion({ source: id, version, ...file, validFrom, uploadedBy: actor, created: this.now() });
        await tx.appendEvent(`knowledge:${id}`, "knowledge_version_added", { actor, version, content_sha: file.contentSha });
      });
    } catch (error) {
      // Outro envio publicou a mesma versão primeiro; o usuário deve conferir antes de repetir.
      if (error instanceof Error && error.name === "LedgerUsageError")
        throw new KnowledgeError(409, "Outra versão foi publicada ao mesmo tempo; recarregue a fonte");
      throw error;
    }
    this.generation++;
    return this.get(actor, id);
  }

  async revoke(actor: string, id: string) {
    await this.owned(actor, id);
    const at = this.now();
    const changed = await this.ledger.transaction(async (tx) => {
      const revoked = await tx.revokeKnowledgeSource(id, actor, at);
      if (revoked) await tx.appendEvent(`knowledge:${id}`, "knowledge_source_revoked", { actor });
      return revoked;
    });
    this.generation++;
    return { ...(await this.get(actor, id)), repeated: !changed };
  }

  async list(actor: string) {
    const sources = (await this.ledger.listKnowledgeSources()).filter((s) => canRead(s, actor));
    const current = new Map(currentKnowledge(await this.ledger.listIndexableKnowledge(), this.now()).map((c) => [c.source, c]));
    return { sources: sources.map((s) => this.summary(s, current.get(s.id))), media_types: SUPPORTED_MEDIA_TYPES };
  }

  async get(actor: string, id: string) {
    const source = await this.readable(actor, id);
    const current = currentKnowledge(await this.ledger.listIndexableKnowledge(), this.now()).find((c) => c.source === id);
    const versions = await this.ledger.listKnowledgeVersions(id);
    return {
      ...this.summary(source, current),
      versions: versions.map((v) => ({
        version: v.version,
        filename: v.filename,
        media_type: v.mediaType,
        size_bytes: v.sizeBytes,
        content_sha: v.contentSha,
        valid_from: v.validFrom,
        uploaded_by: v.uploadedBy,
        created: v.created,
        url: `/api/knowledge/sources/${id}/versions/${v.version}/original`,
      })),
    };
  }

  /** O arquivo exatamente como foi enviado: o destino de cada citação. */
  async original(actor: string, id: string, version: number) {
    await this.readable(actor, id);
    const v = await this.ledger.getKnowledgeVersion(id, version);
    requireThat(v, 404, "Versão não encontrada");
    return { bytes: v.bytes, mediaType: v.mediaType, filename: v.filename };
  }

  async query(actor: string, body: unknown) {
    onlyFields(body, ["question"]);
    const question = body.question;
    requireThat(
      typeof question === "string" && question.trim().length > 0 && question.length <= MAX_QUESTION,
      400,
      `Pergunta deve ter de 1 a ${MAX_QUESTION} caracteres`,
    );
    const { index, passages } = await this.index();
    const wanted = index.queryTerms(question);
    // Com 3 termos ou mais, exige pelo menos 2 no mesmo trecho; com menos, 1 basta.
    const needed = wanted.length >= 3 ? 2 : 1;
    const hits = index
      .search(question, {
        limit: PASSAGES * 3,
        allow: (id) => {
          const p = passages.get(id);
          return !!p && canRead(p, actor);
        },
      })
      .filter((h) => h.matched.length >= needed)
      .slice(0, PASSAGES);

    const found: Passage[] = hits.map((h, i) => {
      const { readers: _r, owner: _o, ...p } = passages.get(h.id)!;
      return { ...p, n: i + 1, matched: h.matched, score: Math.round(h.score * 1000) / 1000 };
    });
    let result;
    let trace: AnswerTrace;
    if (!wanted.length) {
      result = { kind: "abstain" as const, text: "Reformule a pergunta com termos específicos do assunto." };
      trace = { engine: "extractive" };
    } else if (!found.length) {
      result = { kind: "abstain" as const, text: "Não encontrei nas fontes vigentes que você pode ler evidência suficiente para responder." };
      trace = { engine: "extractive" };
    } else {
      const answer = await this.answerer.answer({ question, passages: found });
      result = answer;
      trace = answer.trace;
    }
    const cited = result.kind === "answer" ? found.filter((p) => result.cited.includes(p.n)) : [];
    await this.ledger.appendEvent("knowledge:queries", "knowledge_query", {
      actor,
      abstained: result.kind === "abstain",
      cited: cited.map((p) => p.id),
      ...trace,
    });
    return {
      abstained: result.kind === "abstain",
      answer: result.text,
      citations: cited.map((p) => ({
        n: p.n,
        source: p.source,
        title: p.title,
        version: p.version,
        valid_from: p.validFrom,
        excerpt: p.text.length > 600 ? `${p.text.slice(0, 597)}…` : p.text,
        url: `/api/knowledge/sources/${p.source}/versions/${p.version}/original`,
      })),
      decision: { engine: trace.engine, ...(trace.provider ? { provider: trace.provider } : {}), ...(trace.fallback ? { fallback: trace.fallback } : {}) },
    };
  }

  /** Índice dos trechos vigentes; reconstruído quando algo muda ou a cada minuto (vigência por data). */
  private async index() {
    const key = String(this.generation);
    if (this.cache && this.cache.key === key && Date.now() - this.cache.built < INDEX_TTL_MS) return this.cache;
    const current = currentKnowledge(await this.ledger.listIndexableKnowledge(), this.now()).filter((c) => !c.supersededBy);
    const passages = new Map<string, Omit<Passage, "n" | "matched" | "score"> & { readers: string[]; owner: string }>();
    for (const item of current)
      for (const piece of chunk(item.text)) {
        const id = `${item.source}@${item.version}#${piece.ordinal}`;
        passages.set(id, {
          id,
          source: item.source,
          title: item.title,
          version: item.version,
          validFrom: item.validFrom,
          text: piece.text,
          readers: item.readers,
          owner: item.owner,
        });
      }
    const index = this.buildIndex([...passages.values()].map((p) => ({ id: p.id, text: `${p.title}\n${p.text}` })));
    this.cache = { key, built: Date.now(), index, passages };
    return this.cache;
  }

  private summary(s: KnowledgeSource, current: Current | undefined) {
    return {
      id: s.id,
      title: s.title,
      owner: s.owner,
      readers: s.readers,
      supersedes: s.supersedes,
      created: s.created,
      revoked: s.revoked,
      latest_version: s.latestVersion,
      /** Versão que entra nas respostas agora; null se revogada ou ainda sem versão vigente. */
      current_version: current?.version ?? null,
      superseded_by: current?.supersededBy ?? null,
      status: s.revoked ? "revoked" : !current ? "not_yet_valid" : current.supersededBy ? "superseded" : "current",
    };
  }

  private async readable(actor: string, id: string) {
    const source = await this.ledger.getKnowledgeSource(id);
    requireThat(source && canRead(source, actor), 404, "Fonte não encontrada");
    return source;
  }

  private async owned(actor: string, id: string) {
    const source = await this.readable(actor, id);
    requireThat(source.owner === actor, 403, "Só o dono da fonte pode alterá-la");
    return source;
  }

  private title(value: unknown) {
    requireThat(typeof value === "string" && value.trim() && value.length <= MAX_TITLE, 400, `Título deve ter de 1 a ${MAX_TITLE} caracteres`);
    return value.trim();
  }

  private readers(value: unknown): string[] {
    if (value === undefined) return ["*"];
    requireThat(
      Array.isArray(value) &&
        value.length > 0 &&
        value.length <= MAX_READERS &&
        value.every((r) => typeof r === "string" && r.length >= 1 && r.length <= 100),
      400,
      "readers deve ser uma lista de identidades ou [\"*\"]",
    );
    return [...new Set(value as string[])];
  }

  private validFrom(value: unknown) {
    if (value === undefined) return this.now();
    requireThat(typeof value === "string" && !Number.isNaN(Date.parse(value)), 400, "valid_from deve ser uma data ISO");
    return new Date(value).toISOString();
  }

  private file(body: Record<string, any>) {
    const { filename, media_type: mediaType, content_base64: content } = body;
    requireThat(
      typeof filename === "string" && filename.length >= 1 && filename.length <= 200 && !/[\\/\0]/.test(filename),
      400,
      "Nome de arquivo inválido",
    );
    requireThat(typeof mediaType === "string", 400, "media_type obrigatório");
    requireThat(typeof content === "string" && BASE64.test(content.replace(/\s+/g, "")), 400, "content_base64 inválido");
    const bytes = new Uint8Array(Buffer.from(content, "base64"));
    requireThat(bytes.length > 0, 400, "Arquivo vazio");
    requireThat(bytes.length <= this.maxBytes, 413, `Arquivo maior que ${this.maxBytes} bytes`);
    const text = extractText(bytes, mediaType);
    return { filename, mediaType, bytes, text, contentSha: createHash("sha256").update(bytes).digest("hex") };
  }
}
