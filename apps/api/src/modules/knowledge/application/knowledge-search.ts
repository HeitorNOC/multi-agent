/**
 * Busca nos trechos vigentes, com evidência mínima e corte relativo. Mantém em memória o índice
 * do conjunto vigente; a chave é o próprio conjunto (`fonte@versão:leitores`) no instante da
 * consulta, então uma versão com vigência futura entra exatamente na data, sem expiração por tempo.
 */
import type { Clock } from "../../../shared/clock.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import type { IndexBuilder, KnowledgeIndex, Passage } from "../domain/search-index.ts";
import { originalUrl } from "../domain/search-index.ts";
import { currentVersions, isOpenToEveryone, type IndexableVersion } from "../domain/source.ts";
import { chunk } from "../domain/text.ts";
import type { KnowledgeStore } from "../infrastructure/sql-knowledge.ts";

/** Fração mínima da pontuação do melhor trecho para um trecho secundário ser citado. */
const RELATIVE_SCORE = 0.5;

interface IndexedMeta {
  id: string;
  sourceId: string;
  title: string;
  version: number;
  validFrom: string;
  text: string;
  owner: string;
  readers: readonly string[];
}

/** Trecho entregue a agentes (sem pontuação; com o link do original). */
export interface AgentPassage {
  id: string;
  sourceId: string;
  title: string;
  version: number;
  validFrom: string;
  text: string;
  url: string;
}

export class KnowledgeSearch {
  private readonly uow: UnitOfWork<KnowledgeStore>;
  private readonly clock: Clock;
  private readonly build: IndexBuilder;
  /** Versões lidas do banco; descartadas quando algo muda (`invalidate`). */
  private items: IndexableVersion[] | undefined;
  private cache: { key: string; index: KnowledgeIndex; passages: Map<string, IndexedMeta> } | undefined;

  constructor(uow: UnitOfWork<KnowledgeStore>, clock: Clock, build: IndexBuilder) {
    this.uow = uow;
    this.clock = clock;
    this.build = build;
  }

  /** Chamado depois de envio, versão nova ou revogação. */
  invalidate() {
    this.items = undefined;
  }

  /** Busca; `allow` decide quem pode ver cada trecho. */
  async search(question: string, allow: (p: { owner: string; readers: readonly string[] }) => boolean, limit: number) {
    const { index, passages } = await this.index();
    const wanted = index.queryTerms(question);
    // Com 3 termos ou mais, exige pelo menos 2 no mesmo trecho; com menos, 1 basta.
    const needed = wanted.length >= 3 ? 2 : 1;
    const hits = index
      .search(question, { limit: limit * 3, allow: (id) => !!passages.get(id) && allow(passages.get(id)!) })
      .filter((h) => h.matched.length >= needed);
    // Trechos secundários só entram se forem comparáveis ao melhor; termos genéricos não bastam.
    const best = hits[0]?.score ?? 0;
    const found: Passage[] = hits
      .filter((h) => h.score >= best * RELATIVE_SCORE)
      .slice(0, limit)
      .map((h, i) => {
        const { owner: _o, readers: _r, ...p } = passages.get(h.id)!;
        return { ...p, n: i + 1, matched: h.matched, score: Math.round(h.score * 1000) / 1000 };
      });
    return { wanted, found };
  }

  /**
   * Trechos para os agentes de um trabalho. Sem identidade corporativa ainda, agentes só leem
   * fontes abertas a toda a instalação; fontes restritas nunca chegam a eles.
   */
  async forAgents(query: string, limit: number): Promise<AgentPassage[]> {
    const { found } = await this.search(query, isOpenToEveryone, limit);
    return found.map(({ n: _n, matched: _m, score: _s, ...p }) => ({ ...p, url: originalUrl(p.sourceId, p.version) }));
  }

  /** Um trecho vigente e aberto a todos, pelo id; `undefined` se deixou de valer. */
  async passageForAgents(id: string): Promise<AgentPassage | undefined> {
    const p = (await this.index()).passages.get(id);
    if (!p || !isOpenToEveryone(p)) return undefined;
    const { owner: _o, readers: _r, ...rest } = p;
    return { ...rest, url: originalUrl(p.sourceId, p.version) };
  }

  private async index() {
    this.items ??= await this.uow.read.versions.listIndexable();
    const current = currentVersions(this.items, this.clock.now()).filter((c) => !c.supersededBy);
    const key = current.map((c) => `${c.sourceId}@${c.version}:${c.readers.join(",")}`).sort().join("|");
    if (this.cache?.key === key) return this.cache;
    const passages = new Map<string, IndexedMeta>();
    for (const item of current)
      for (const piece of chunk(item.text)) {
        const id = `${item.sourceId}@${item.version}#${piece.ordinal}`;
        passages.set(id, {
          id,
          sourceId: item.sourceId,
          title: item.title,
          version: item.version,
          validFrom: item.validFrom,
          text: piece.text,
          owner: item.owner,
          readers: item.readers,
        });
      }
    const index = this.build([...passages.values()].map((p) => ({ id: p.id, text: `${p.title}\n${p.text}` })));
    this.cache = { key, index, passages };
    return this.cache;
  }
}
