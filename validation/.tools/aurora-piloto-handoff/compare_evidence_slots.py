"""Measure per-question evidence slots with and without candidate pruning."""

import argparse
import json
import sqlite3
import tempfile
import time
from contextlib import closing
from functools import partial
from pathlib import Path

from compare_page_retrieval import batched_scores, evidence_found
from decomposed_retrieval import interleave, reciprocal_rank_fusion, subqueries
from independent_retrieval import IndependentSearch
from rerank_experiment import local_reranker, rerank_rankings
from run import GOAL
from run_mixed_corpus import DOCUMENTS, OTHER_PAGES, prepare_mixed
from validate_knowledge import APP, HybridRetriever, PilotCorpus, local_embedder
from apps.aurora.runtime.pilot_corpus import MAX_PASSAGES

HANDOFF_QUESTIONS = [
    "Qual status indica que um atendente iniciou o atendimento?",
    "O que muda no tipo da sessão de mensageria quando é aberto um atendimento digital?",
    "Qual evento do WhatsApp representa transferência de controle em vez de mensagem recebida?",
]


def compare(output):
    root = Path(__file__).parent
    rubric = json.loads((root / "knowledge-cases.json").read_text(encoding="utf-8"))
    challenge = json.loads((root / "chief-search-cases.json").read_text(encoding="utf-8"))
    cases = [*rubric["cases"], *challenge]
    handoff = next(case for case in challenge if case["id"] == "handoff")
    cases.append({**handoff, "id": "handoff-original", "goal": GOAL})

    with tempfile.TemporaryDirectory(prefix="aurora-slots-") as tmp:
        folder = Path(tmp)
        manifest, pages, docs = prepare_mixed(folder, DOCUMENTS + OTHER_PAGES)
        corpus = PilotCorpus(manifest)
        passages = [row for row, _ in corpus.passages]
        titles = {doc["source"]: doc["title"] for doc in docs}
        titled = {
            row["id"]: {**row, "quote": f"{titles[row['source']]} | {row['quote']}"}
            for row in passages
        }
        results = []
        with (
            local_embedder(folder) as (embed, revision, _),
            local_reranker(APP) as (score, reranker),
            closing(sqlite3.connect(":memory:")) as db,
        ):
            search = IndependentSearch(db, HybridRetriever(corpus.passages, embed))
            score_pairs = partial(batched_scores, score)
            for case in cases:
                goal, expected = case["goal"], case["evidence"]
                parts = subqueries(goal) or [goal]
                modes = {"automatic": parts}
                if case["id"] in {"handoff", "handoff-original"}:
                    modes["manual_concepts"] = HANDOFF_QUESTIONS
                measurements = {}
                for mode, queries in modes.items():
                    started = time.perf_counter()
                    vectors = embed(queries)
                    pools = [
                        list(reciprocal_rank_fusion([
                            search.vector(vector), search.lexical(query)
                        ]))
                        for query, vector in zip(queries, vectors, strict=True)
                    ]
                    measurements[f"{mode}_shortlist"] = evaluate(
                        pools, queries, titled, score_pairs, expected, pages, started
                    )
                    started = time.perf_counter()
                    measurements[f"{mode}_full_scan"] = evaluate(
                        [passages] * len(queries),
                        queries, titled, score_pairs, expected, pages, started,
                    )
                results.append({
                    "id": case["id"],
                    "critical": case.get("critical", False),
                    "expected": len(expected),
                    "modes": measurements,
                })
                counts = {key: row["found"] for key, row in measurements.items()}
                print(case["id"], counts, flush=True)

    with output.open("x", encoding="utf-8") as stream:
        json.dump({
            "manifest_sha256": corpus.sha256,
            "embedding_revision": revision,
            "reranker": reranker,
            "passages": len(passages),
            "cases": results,
        }, stream, indent=2)


def evaluate(pools, queries, titled, score_pairs, expected, pages, started):
    rankings = [
        rerank_rankings([pool], titled, score_pairs, [query])
        for pool, query in zip(pools, queries, strict=True)
    ]
    distinct = {row["id"]: row for row in interleave(rankings)}
    selected = list(distinct.values())[:MAX_PASSAGES]
    return {
        "queries": queries,
        "found_in_pool": evidence_found(list(reciprocal_rank_fusion(pools)), expected),
        "found": evidence_found(selected, expected),
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
        "candidates": [
            [row["source"], pages[row["source"]][row["line"]], row["line"]]
            for row in selected
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Informe um arquivo de saída novo.")
    compare(args.output)
