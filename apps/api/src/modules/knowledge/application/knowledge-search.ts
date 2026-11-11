/**
 * Busca nos trechos vigentes, com evidência mínima e corte relativo.
 *
 * Híbrida quando há modelo de embeddings: por palavras (BM25, bom em nomes, números e termos
 * exatos) e por significado (vetores, bom em sinônimos e perguntas com outras palavras). As duas
 * listas são juntadas por posição (RRF). Sem modelo, ou enquanto ele não responde, só palavras. Mantém em memória o índice
 * do conjunto vigente; a chave é o próprio conjunto (`fonte@versão:leitores`) no instante da
 * consulta, então uma versão com vigência futura entra exatamente na data, sem expiração por tempo.
 */
import type { Clock } from "../../../shared/clock.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import type { IndexBuilder, KnowledgeIndex, Passage } from "../domain/search-index.ts";
import { originalUrl } from "../domain/search-index.ts";
import type { ActorId } from "../../../shared/ids.ts";
import { agentsCanRead, canRead, currentVersions, type IndexableVersion } from "../domain/source.ts";
import { reciprocalRankFusion } from "../domain/embeddings.ts";
import { chunk, terms } from "../domain/text.ts";
import { documentSummary, parseCsv, tableSummaries } from "../domain/table.ts";
import type { SemanticIndex } from "./semantic-index.ts";
import type { KnowledgeStore } from "../infrastructure/sql-knowledge.ts";

/** Fração mínima da pontuação do melhor trecho para um trecho secundário ser citado. */
const RELATIVE_SCORE = 0.5;
/**
 * Peso extra para trechos da área de quem pergunta (por exemplo, fontes de Compras para o
 * analista de compras). Preferência, não filtro: uma fonte Geral muito melhor continua na frente.
 */
const AREA_BOOST = 1.3;
/** Trechos mínimos para o destaque sobre a média ser confiável. */
const MIN_COMPARED = 5;

export interface SearchOptions {
  /** Área preferida: trechos dela ganham peso. */
  preferArea?: string;
  /** Só esta área. */
  onlyArea?: string;
}

interface IndexedMeta {
  id: string;
  sourceId: string;
  title: string;
  version: number;
  validFrom: string;
  text: string;
  area: string;
  /** Seção do documento (título mais próximo), quando houver. */
  section?: string;
  owner: string;
  readers: readonly string[];
}

/** Trecho entregue a agentes (sem pontuação; com o link do original). */
export interface AgentPassage {
  /** Começo do trecho anterior e do seguinte no mesmo documento (contexto, não para citar). */
  around?: string;
  id: string;
  sourceId: string;
  title: string;
  version: number;
  validFrom: string;
  text: string;
  url: string;
}

/** O texto de um trecho como a busca o lê: fonte, seção e conteúdo (o contexto ajuda os dois índices). */
const contextual = (p: { title: string; section?: string; text: string }) => [p.section ? `${p.title} › ${p.section}` : p.title, p.text].join("\n");

export class KnowledgeSearch {
  private readonly uow: UnitOfWork<KnowledgeStore>;
  private readonly clock: Clock;
  private readonly build: IndexBuilder;
  /** Versões lidas do banco; descartadas quando algo muda (`invalidate`). */
  private items: IndexableVersion[] | undefined;
  private cache: { key: string; index: KnowledgeIndex; passages: Map<string, IndexedMeta>; order: Map<string, string[]> } | undefined;

  private readonly semantic: SemanticIndex | undefined;
  /**
   * Quando um trecho achado só pelo significado conta como evidência: similaridade muito alta, ou
   * destaque claro sobre a média (com pelo menos `MIN_COMPARED` trechos para comparar). Valores
   * calibrados com perguntas reais no multilingual-e5-small (docs/DADOS_CEREBRO_AGENTES.md).
   */
  private readonly minSimilarity: number;
  private readonly minGap: number;

  constructor(
    uow: UnitOfWork<KnowledgeStore>,
    clock: Clock,
    build: IndexBuilder,
    options: { semantic?: SemanticIndex; minSimilarity?: number; minGap?: number } = {},
  ) {
    this.uow = uow;
    this.clock = clock;
    this.build = build;
    this.semantic = options.semantic;
    this.minSimilarity = options.minSimilarity ?? 0.86;
    this.minGap = options.minGap ?? 0.025;
  }

  /** Estado da busca por significado (para a tela do Cérebro); `null` sem modelo. */
  async semanticStatus() {
    if (!this.semantic) return null;
    await this.index();
    return this.semantic.status();
  }

  /** Chamado depois de envio, versão nova ou revogação. */
  invalidate() {
    this.items = undefined;
    // Com busca por significado, já prepara o índice novo para vetorizar o que mudou.
    // Também tenta de novo os vetores que falharam antes (modelo fora do ar, por exemplo).
    if (this.semantic) void this.index().then(() => this.semantic!.retry(), () => undefined);
  }

  /** Busca; `allow` decide quem pode ver cada trecho. */
  async search(question: string, allow: (p: { owner: string; readers: readonly string[] }) => boolean, limit: number, options: SearchOptions = {}) {
    const { index, passages } = await this.index();
    const wanted = index.queryTerms(question);
    // Com 3 termos ou mais, exige pelo menos 2 no mesmo trecho; com menos, 1 basta.
    const needed = wanted.length >= 3 ? 2 : 1;
    const visible = (id: string) => {
      const p = passages.get(id);
      return !!p && (!options.onlyArea || p.area === options.onlyArea) && allow(p);
    };
    const lexical = index.search(question, { limit: limit * 4, allow: visible }).filter((h) => h.matched.length >= needed);
    const result = this.semantic ? await this.semantic.search(question, visible, limit * 4) : { hits: [], compared: 0 };
    const semantic = result.hits.filter((h) => h.similarity >= this.minSimilarity || (result.compared >= MIN_COMPARED && h.gap >= this.minGap));
    let hits: { id: string; score: number; matched: string[] }[];
    if (!semantic.length) hits = lexical;
    else {
      // Híbrida: junta as duas listas por posição; quem aparece nas duas sobe.
      const fused = reciprocalRankFusion([lexical.map((h) => h.id), semantic.map((h) => h.id)]);
      const matchedOf = new Map(lexical.map((h) => [h.id, h.matched]));
      const want = new Set(wanted);
      hits = [...fused].map(([id, score]) => ({
        id,
        score,
        matched: matchedOf.get(id) ?? [...new Set(terms(passages.get(id)!.text))].filter((t) => want.has(t)),
      }));
    }
    hits = hits
      .map((h) => (options.preferArea && passages.get(h.id)!.area === options.preferArea ? { ...h, score: h.score * AREA_BOOST } : h))
      .sort((a, b) => b.score - a.score);
    // Trechos secundários só entram se forem comparáveis ao melhor; termos genéricos não bastam.
    const best = hits[0]?.score ?? 0;
    const found: Passage[] = hits
      .filter((h) => h.score >= best * RELATIVE_SCORE)
      .slice(0, limit)
      .map((h, i) => {
        const { owner: _o, readers: _r, ...p } = passages.get(h.id)!;
        return { ...p, n: i + 1, matched: h.matched, score: Math.round(h.score * 100000) / 100000 };
      });
    return { wanted, found };
  }

  /**
   * Trechos para agentes: fontes abertas a toda a empresa e as restritas em que algum dos agentes
   * foi incluído como leitor (`agent:<id>`). As demais nunca chegam a eles. Com `onBehalfOf`, o
   * agente responde a uma pessoa: só entra o que ela também pode ler (o agente não abre para
   * ninguém uma fonte que estava fechada para essa pessoa).
   */
  async forAgents(
    query: string,
    limit: number,
    agentIds: readonly string[] = [],
    options: { onBehalfOf?: ActorId; preferArea?: string } = {},
  ): Promise<AgentPassage[]> {
    const { onBehalfOf } = options;
    const allow = (p: { owner: string; readers: readonly string[] }) => agentsCanRead(p, agentIds) && (!onBehalfOf || canRead(p, onBehalfOf));
    const found = await this.searchMany(queriesOf(query), allow, limit, { preferArea: options.preferArea });
    const around = await this.neighbors();
    return found.map(({ n: _n, matched: _m, score: _s, ...p }) => ({ ...p, url: originalUrl(p.sourceId, p.version), ...(around(p.id) ? { around: around(p.id) } : {}) }));
  }

  /**
   * Trechos vigentes de fontes específicas (anexadas a um pedido) que os agentes podem ler. Com
   * `query`, os mais relevantes para ela primeiro; depois, na ordem do documento.
   */
  async passagesOfSources(sourceIds: readonly string[], agentIds: readonly string[], limit: number, query?: string): Promise<AgentPassage[]> {
    const { passages } = await this.index();
    const wanted = new Set(sourceIds);
    const candidates = [...passages.values()].filter((p) => wanted.has(p.sourceId) && agentsCanRead(p, agentIds));
    let ordered = candidates;
    if (query && candidates.length > limit) {
      const allowed = new Set(candidates.map((p) => p.id));
      const { found } = await this.search(query, (p) => agentsCanRead(p, agentIds), candidates.length);
      const ranked = found.map((f) => f.id).filter((id) => allowed.has(id));
      ordered = [...ranked.map((id) => passages.get(id)!), ...candidates.filter((p) => !ranked.includes(p.id))];
    }
    return ordered.slice(0, limit).map(({ owner: _o, readers: _r, ...p }) => ({ ...p, url: originalUrl(p.sourceId, p.version) }));
  }

  /**
   * Busca com várias consultas (as partes do pedido) fundidas por posição e reordenadas pela
   * cobertura dos termos pedidos e pelo título. Um pedido longo ("conduzir compras acima de 10 mil
   * e o orçamento do trimestre") acha os trechos de cada assunto, não só do mais forte.
   */
  async searchMany(queries: readonly string[], allow: (p: { owner: string; readers: readonly string[] }) => boolean, limit: number, options: SearchOptions = {}): Promise<Passage[]> {
    const runs = await Promise.all(queries.map((q) => this.search(q, allow, limit * 2, options)));
    const wanted = new Set(runs.flatMap((r) => r.wanted));
    // Pela fonte: documento cujo título traz um termo do pedido (o "Roteiro de atendimento por
    // WhatsApp" para "microserviço de WhatsApp") entra como candidato, mesmo que o texto de cada
    // trecho tenha só um termo em comum. Só o primeiro trecho de cada fonte, ordenado pela sobreposição.
    const titleRun = await this.byTitle(wanted, allow, options);
    if (!titleRun.length && queries.length <= 1) return runs[0]?.found.slice(0, limit) ?? [];
    const byId = new Map([...runs.flatMap((r) => r.found.map((p) => [p.id, p] as const)), ...titleRun.map((p) => [p.id, p] as const)]);
    const fused = reciprocalRankFusion([...runs.map((r) => r.found.map((p) => p.id)), titleRun.map((p) => p.id)]);
    const scored = [...fused].map(([id, score]) => {
      const p = byId.get(id)!;
      const seen = new Set(terms(`${p.title} ${p.section ?? ""} ${p.text}`));
      const coverage = [...wanted].filter((t) => seen.has(t)).length;
      const titled = terms(p.title).some((t) => wanted.has(t));
      return { p, score: score * (1 + 0.1 * coverage) * (titled ? 1.15 : 1) };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x, i) => ({ ...x.p, n: i + 1, score: Math.round(x.score * 100000) / 100000 }));
  }

  /** Primeiro trecho das fontes cujo título tem termos (de 5 letras ou mais) do pedido. */
  private async byTitle(wanted: ReadonlySet<string>, allow: (p: { owner: string; readers: readonly string[] }) => boolean, options: SearchOptions): Promise<Passage[]> {
    const { passages, order } = await this.index();
    const strong = [...wanted].filter((t) => t.length >= 5);
    if (!strong.length) return [];
    const hits: { p: IndexedMeta; overlap: number }[] = [];
    for (const ids of order.values()) {
      const first = ids.length ? passages.get(ids[0]!) : undefined;
      if (!first || !allow(first) || (options.onlyArea && first.area !== options.onlyArea)) continue;
      const title = new Set(terms(first.title));
      const overlap = strong.filter((t) => title.has(t)).length;
      if (overlap) hits.push({ p: first, overlap });
    }
    return hits
      .sort((a, b) => b.overlap - a.overlap)
      .map(({ p }, i) => {
        const { owner: _o, readers: _r, ...rest } = p;
        return { ...rest, n: i + 1, matched: [], score: 0 };
      });
  }

  /** Começo dos trechos vizinhos de um trecho (no mesmo documento e versão). */
  private async neighbors() {
    const { passages, order } = await this.index();
    return (id: string) => {
      const [doc, ordinal] = id.split("#");
      const ids = order.get(doc!) ?? [];
      const i = ids.indexOf(id);
      if (i < 0 || ordinal?.startsWith("calc") || ordinal === "sum") return undefined;
      const prev = i > 0 ? passages.get(ids[i - 1]!)?.text.slice(-200) : undefined;
      const next = i + 1 < ids.length ? passages.get(ids[i + 1]!)?.text.slice(0, 200) : undefined;
      const text = [prev && `…${prev}`, next && `${next}…`].filter(Boolean).join("\n");
      return text || undefined;
    };
  }

  /** Um trecho vigente que algum dos agentes pode ler, pelo id; `undefined` se deixou de valer ou perdeu o acesso. */
  async passageForAgents(id: string, agentIds: readonly string[] = []): Promise<AgentPassage | undefined> {
    const p = (await this.index()).passages.get(id);
    if (!p || !agentsCanRead(p, agentIds)) return undefined;
    const { owner: _o, readers: _r, ...rest } = p;
    const around = (await this.neighbors())(id);
    return { ...rest, url: originalUrl(p.sourceId, p.version), ...(around ? { around } : {}) };
  }

  private async index() {
    this.items ??= await this.uow.read.versions.listIndexable();
    const current = currentVersions(this.items, this.clock.now()).filter((c) => !c.supersededBy);
    const key = current.map((c) => `${c.sourceId}@${c.version}:${c.area}:${c.readers.join(",")}`).sort().join("|");
    if (this.cache?.key === key) return this.cache;
    const passages = new Map<string, IndexedMeta>();
    const order = new Map<string, string[]>();
    for (const item of current) {
      const ids: string[] = [];
      order.set(`${item.sourceId}@${item.version}`, ids);
      // Tabela: o resumo calculado (total e por categoria) entra como trechos da própria fonte.
      if (item.mediaType === "text/csv")
        tableSummaries(item.title, parseCsv(item.text)).forEach((s, k) => {
          const id = `${item.sourceId}@${item.version}#calc${k}`;
          passages.set(id, { id, sourceId: item.sourceId, title: item.title, version: item.version, validFrom: item.validFrom, text: s.text, area: item.area, section: s.section, owner: item.owner, readers: item.readers });
        });
      // Documento com várias seções: um resumo extrativo, como trecho da própria fonte.
      const summary = item.mediaType === "text/csv" ? null : documentSummary(item.title, item.text);
      if (summary) {
        const id = `${item.sourceId}@${item.version}#sum`;
        passages.set(id, { id, sourceId: item.sourceId, title: item.title, version: item.version, validFrom: item.validFrom, text: summary, area: item.area, section: "Resumo do documento", owner: item.owner, readers: item.readers });
      }
      for (const piece of chunk(item.text, undefined, item.mediaType)) {
        const id = `${item.sourceId}@${item.version}#${piece.ordinal}`;
        ids.push(id);
        passages.set(id, {
          id,
          sourceId: item.sourceId,
          title: item.title,
          version: item.version,
          validFrom: item.validFrom,
          text: piece.text,
          area: item.area,
          ...(piece.section ? { section: piece.section } : {}),
          owner: item.owner,
          readers: item.readers,
        });
      }
    }
    // O que a busca lê de cada trecho: título da fonte, seção e o texto (o título e a seção dão
    // contexto a trechos que, sozinhos, não dizem do que tratam).
    const readable = [...passages.values()].map((p) => ({ id: p.id, text: contextual(p) }));
    const index = this.build(readable);
    this.cache = { key, index, passages, order };
    // Vetoriza em segundo plano o que ainda não tem vetor (o resto já está guardado no banco).
    this.semantic?.sync(readable);
    return this.cache;
  }
}

/**
 * As partes de um pedido que valem uma busca própria: cada linha e, numa linha longa, cada frase
 * com pelo menos três palavras de conteúdo. A consulta inteira sempre entra; no máximo 5.
 */
export function queriesOf(query: string): string[] {
  const parts = [...query.split("\n"), ...query.split("\n").flatMap((l) => l.split(/[.;!?]+\s|,\s+(?:e|ou)\s+|\s+e\s+(?=o |a |os |as )/))]
    .map((q) => q.trim())
    .filter((q) => terms(q).length >= 3);
  return [...new Set([query.trim(), ...parts])].filter(Boolean).slice(0, 5);
}
