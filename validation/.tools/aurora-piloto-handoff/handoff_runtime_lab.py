"""Connect the validated handoff retrieval to a disposable Aurora API session."""

import sqlite3
from contextlib import closing
from functools import lru_cache
from threading import Lock

from compare_scope_verifier import HANDOFF_FACTS, fact_candidates
from decomposed_retrieval import interleave
from independent_retrieval import IndependentSearch
from rerank_experiment import local_reranker

from apps.aurora.runtime.pilot_corpus import terms
from apps.aurora.runtime.pilot_retrieval import HybridRetriever


def handoff_questions(goal):
    words = terms(goal)
    if (
        words & {"whatsapp", "mba"}
        and words & {"humano", "humana", "atendente"}
        and words & {"transferencia", "controle", "passagem", "passe", "assumiu"}
    ):
        return HANDOFF_FACTS
    return ()


def retriever_factory(stack, root):
    def create(corpus, embed, facets):
        fallback = HybridRetriever(corpus.passages, embed, facets)
        db = stack.enter_context(
            closing(sqlite3.connect(":memory:", check_same_thread=False))
        )
        search = IndependentSearch(db, fallback)
        score, _ = stack.enter_context(local_reranker(root / "apps/aurora"))
        rows = {row["id"]: row for row, _ in corpus.passages}
        titles = {doc["source"]: doc["title"] for doc in corpus.metadata}
        titled = {
            key: {**row, "quote": f"{titles[row['source']]} | {row['quote']}"}
            for key, row in rows.items()
        }
        allowed = {row["source"] for row in rows.values()}
        lock = Lock()

        @lru_cache(maxsize=32)
        def retrieve(goal):
            questions = handoff_questions(goal)
            if not questions:
                return fallback.retrieve(goal)
            lists = fact_candidates(search, questions, titled, score, allowed)
            return list(
                {row["id"]: rows[row["id"]] for row in interleave(lists)}.values()
            )

        class Retriever:
            questions = staticmethod(handoff_questions)

            def retrieve(self, goal):
                with lock:
                    return retrieve(goal)

        return Retriever()

    return create
