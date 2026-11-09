"""Compare page expansion against vector reranking using the frozen pilot cases."""

import argparse
import json
import sqlite3
import tempfile
import time
from collections import defaultdict
from contextlib import closing
from functools import partial
from pathlib import Path

from decomposed_retrieval import reciprocal_rank_fusion, subqueries
from independent_retrieval import IndependentSearch
from rerank_experiment import local_reranker, rerank_rankings
from run_mixed_corpus import DOCUMENTS, OTHER_PAGES, prepare_mixed
from validate_knowledge import APP, HybridRetriever, PilotCorpus, local_embedder


def batched_scores(score, query, quotes):
    # Keep each request within the local worker's 72-candidate contract.
    return [
        value
        for start in range(0, len(quotes), 72)
        for value in score(query, quotes[start : start + 72])
    ]


def evidence_found(rows, expected):
    return [
        index
        for index, (source, line, phrase) in enumerate(expected, 1)
        if any(
            row["source"] == source
            and (line is None or row["line"] == line)
            and phrase in row["quote"]
            for row in rows
        )
    ]


def compare(output):
    root = Path(__file__).parent
    rubric = json.loads((root / "knowledge-cases.json").read_text(encoding="utf-8"))
    challenge = json.loads((root / "chief-search-cases.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="aurora-pages-") as tmp:
        folder = Path(tmp)
        manifest, pages, docs = prepare_mixed(folder, DOCUMENTS + OTHER_PAGES)
        corpus = PilotCorpus(manifest)
        titles = {doc["source"]: doc["title"] for doc in docs}
        by_page = defaultdict(list)
        titled = {}
        for row, _ in corpus.passages:
            source = row["source"]
            by_page[source, pages[source][row["line"]]].append(row)
            titled[row["id"]] = {**row, "quote": f"{titles[source]} | {row['quote']}"}

        cases = []
        with (
            local_embedder(folder) as (embed, revision, _),
            local_reranker(APP) as (score, reranker),
            closing(sqlite3.connect(":memory:")) as db,
        ):
            search = IndependentSearch(db, HybridRetriever(corpus.passages, embed))
            score_pairs = partial(batched_scores, score)
            for case in [*rubric["cases"], *challenge]:
                goal, expected = case["goal"], case["evidence"]
                queries = [goal, *subqueries(goal)]
                vector = search.rankings(goal, "vector")
                lexical = [search.lexical(query) for query in queries]
                seeds = list(reciprocal_rank_fusion([*vector, *lexical]))[:8]
                nearby = {}
                for row in seeds:
                    source = row["source"]
                    page = pages[source][row["line"]]
                    if page is None:
                        continue
                    for number in (page, page - 1, page + 1):
                        for passage in by_page.get((source, number), []):
                            nearby[passage["id"]] = passage
                modes = {
                    "vector": (vector, [goal]),
                    "union": ([*vector, *lexical], [goal]),
                    "pages": ([*vector, *lexical, list(nearby.values())], [goal]),
                    "pages_by_clause": (
                        [*vector, *lexical, list(nearby.values())], queries
                    ),
                }
                result = {}
                for mode, (rankings, prompts) in modes.items():
                    started = time.perf_counter()
                    rows = rerank_rankings(rankings, titled, score_pairs, prompts)
                    pool = list(reciprocal_rank_fusion(rankings))
                    result[mode] = {
                        "pool_evidence": evidence_found(pool, expected),
                        "selected_evidence": evidence_found(rows, expected),
                        "rerank_ms": round((time.perf_counter() - started) * 1000),
                        "candidates": [
                            [r["source"], pages[r["source"]][r["line"]], r["line"]]
                            for r in rows
                        ],
                    }
                cases.append({
                    "id": case["id"],
                    "critical": case.get("critical", False),
                    "expected": len(expected),
                    "modes": result,
                })
                counts = [len(row["selected_evidence"]) for row in result.values()]
                print(case["id"], counts, flush=True)
    with output.open("x", encoding="utf-8") as stream:
        json.dump({
            "manifest_sha256": corpus.sha256,
            "embedding_revision": revision,
            "reranker": reranker,
            "documents": len(docs),
            "passages": len(corpus.passages),
            "cases": cases,
        }, stream, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Informe um arquivo de saída novo.")
    compare(args.output)
