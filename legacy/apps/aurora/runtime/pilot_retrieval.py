"""Local hybrid retrieval with optional task-scoped technical vocabulary."""

import json
import math
from functools import lru_cache

from apps.aurora.runtime.pilot_corpus import MAX_PASSAGES, terms

MAX_INDEXED_PASSAGES = 4096


def normalized(vector):
    size = math.hypot(*vector)
    if not size or not math.isfinite(size):
        raise ValueError("Vetor de busca inválido")
    return tuple(value / size for value in vector)


def load_facets(path):
    with path.open("rb") as stream:
        raw = stream.read(8193)
    if len(raw) > 8192:
        raise ValueError("Vocabulário de busca excede 8 KiB")
    data = json.loads(raw)
    goal, facets = data["goal"], data["facets"]
    if (
        not isinstance(goal, str)
        or not 8 <= len(goal) <= 600
        or not isinstance(facets, list)
        or not 1 <= len(facets) <= MAX_PASSAGES
    ):
        raise ValueError("Vocabulário de busca do piloto inválido")
    for facet in facets:
        if (
            not isinstance(facet["query"], str)
            or not 1 <= len(facet["query"]) <= 400
            or not isinstance(facet["anchors"], list)
            or not 1 <= len(facet["anchors"]) <= 8
            or not all(
                isinstance(anchor, str) and len(terms(anchor)) == 1
                for anchor in facet["anchors"]
            )
        ):
            raise ValueError("Consulta técnica ou âncoras inválidas")
    return goal, facets


class HybridRetriever:
    def __init__(self, passages, embed, task_facets=None):
        if len(passages) > MAX_INDEXED_PASSAGES:
            raise ValueError("A busca híbrida do piloto aceita até 4096 trechos")
        self.passages = passages
        self.embed = embed
        self.task_facets = task_facets
        self.vectors = []
        for start in range(0, len(passages), 64):
            batch = [p["quote"] for p, _ in passages[start : start + 64]]
            self.vectors.extend(normalized(vector) for vector in embed(batch))
        if len(self.vectors) != len(passages):
            raise ValueError(
                "Quantidade de embeddings diverge da quantidade de trechos"
            )
        self.retrieve = lru_cache(maxsize=32)(self.retrieve)

    def rank(self, query, vector, anchors=None):
        vector = normalized(vector)
        keywords = terms(query)
        ranked = []
        for (passage, words), candidate in zip(
            self.passages, self.vectors, strict=True
        ):
            overlap = len(keywords & words)
            similarity = sum(a * b for a, b in zip(vector, candidate, strict=True))
            if anchors:
                if not anchors & words or similarity < 0.26:
                    continue
            elif similarity < 0.38 and overlap < 2:
                continue
            ranked.append((similarity + 0.045 * min(overlap, 4), passage))
        ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
        return [passage for _, passage in ranked]

    def retrieve(self, goal):
        if not self.passages or not terms(goal):
            return []
        facets = (
            self.task_facets[1]
            if self.task_facets and goal == self.task_facets[0]
            else []
        )
        question, *vectors = self.embed([goal, *(facet["query"] for facet in facets)])
        original = self.rank(goal, question)
        if not original:
            return []
        selected = {}
        for facet, vector in zip(facets, vectors, strict=True):
            anchors = set().union(*(terms(anchor) for anchor in facet["anchors"]))
            candidates = self.rank(facet["query"], vector, anchors)
            passage = next((p for p in candidates if p["id"] not in selected), None)
            if passage:
                selected[passage["id"]] = passage
        for passage in original:
            if len(selected) == MAX_PASSAGES:
                break
            selected.setdefault(passage["id"], passage)
        return list(selected.values())
