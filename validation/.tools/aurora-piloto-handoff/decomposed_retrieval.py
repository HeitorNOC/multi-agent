"""Bounded local experiment for explicit compound questions in Portuguese."""

import re
from collections import defaultdict
from itertools import zip_longest

from apps.aurora.runtime.pilot_corpus import MAX_PASSAGES, terms

CLAUSE = re.compile(
    r"\s+e\s+(?=(?:o que|qual|quais|como|onde|quando|por que|quanto|quantos|"
    r"quantas|após quanto|em quanto|em qual)\b)",
    re.IGNORECASE,
)
SCOPE = re.compile(
    r"^(?:ao|quando|no|na|durante|enquanto|após)\b[^,]+,\s*", re.IGNORECASE
)


def subqueries(question):
    first, *rest = CLAUSE.split(question.strip().rstrip("?"), maxsplit=2)
    if not rest:
        return []
    scope = SCOPE.match(first)
    prefix = scope.group() if scope else ""
    clauses = [first, *rest]
    if any(len(terms(clause)) < 2 for clause in clauses):
        return []
    return [first + "?", *(prefix + clause + "?" for clause in rest)]


def interleave(rankings):
    return (passage for row in zip_longest(*rankings) for passage in row if passage)


def reciprocal_rank_fusion(rankings):
    scores = defaultdict(float)
    passages = {}
    for ranking in rankings:
        for rank, passage in enumerate(ranking, 1):
            id_ = passage["id"]
            scores[id_] += 1 / (60 + rank)
            passages[id_] = passage
    return (
        passages[id_] for id_ in sorted(scores, key=lambda id_: (-scores[id_], id_))
    )


def retrieve(hybrid, merge, goal):
    parts = subqueries(goal)
    if not parts:
        return hybrid.retrieve(goal)

    rankings = rank_queries(hybrid, [goal, *parts], MAX_PASSAGES)
    if not rankings[0]:
        return []

    selected = {}
    for passage in merge(rankings):
        selected.setdefault(passage["id"], passage)
        if len(selected) == MAX_PASSAGES:
            break
    return list(selected.values())


def rank_queries(hybrid, queries, limit):
    return [
        hybrid.rank(query, vector)[:limit]
        for query, vector in zip(queries, hybrid.embed(queries), strict=True)
    ]
