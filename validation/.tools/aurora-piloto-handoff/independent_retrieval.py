"""Independent BM25 and vector candidate lists for the pilot benchmark."""

from apps.aurora.runtime.pilot_corpus import terms
from apps.aurora.runtime.pilot_retrieval import normalized
from decomposed_retrieval import reciprocal_rank_fusion, subqueries
from rerank_experiment import rerank_rankings

DEPTH = 24


class IndependentSearch:
    def __init__(self, db, hybrid):
        self.db = db
        self.hybrid = hybrid
        self.passages = [p for p, _ in hybrid.passages]
        db.execute(
            """CREATE VIRTUAL TABLE lexical USING fts5(quote,
               tokenize = "unicode61 remove_diacritics 2 tokenchars '_'")"""
        )
        db.executemany(
            "INSERT INTO lexical(rowid, quote) VALUES (?, ?)",
            ((i, p["quote"]) for i, p in enumerate(self.passages)),
        )

    def lexical(self, query):
        words = terms(query)
        if not words:
            return []
        expression = " OR ".join(f'"{word}"' for word in sorted(words))
        rows = self.db.execute(
            "SELECT rowid FROM lexical WHERE lexical MATCH ? ORDER BY bm25(lexical), rowid LIMIT ?",
            (expression, DEPTH),
        )
        return [self.passages[row] for (row,) in rows]

    def vector(self, embedding):
        vector = normalized(embedding)
        ranked = []
        for passage, candidate in zip(self.passages, self.hybrid.vectors, strict=True):
            similarity = sum(a * b for a, b in zip(vector, candidate, strict=True))
            if similarity >= 0.38:
                ranked.append((similarity, passage))
        ranked.sort(key=lambda row: (-row[0], row[1]["id"]))
        return [passage for _, passage in ranked[:DEPTH]]

    def rankings(self, goal, mode, *, graph=None):
        queries = [goal, *subqueries(goal)]
        if mode == "bm25":
            return [self.lexical(query) for query in queries]
        vectors = self.hybrid.embed(queries)
        if mode == "vector":
            return [self.vector(vector) for vector in vectors]
        results = []
        for query, vector in zip(queries, vectors, strict=True):
            channels = [self.lexical(query), self.vector(vector)]
            if graph:
                channels.append(graph(query))
            results.append(list(reciprocal_rank_fusion(channels))[:DEPTH])
        return results

    def retrieve(self, mode, contexts, score_pairs, goal, *, graph=None):
        rankings = self.rankings(goal, mode, graph=graph)
        if not rankings[0]:
            return []
        return rerank_rankings(rankings, contexts, score_pairs, [goal])
