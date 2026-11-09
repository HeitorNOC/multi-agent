"""Compare Aurora's retrieval modes on a frozen rubric."""

import argparse
import hashlib
import hmac
import json
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing, contextmanager
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from urllib.request import Request, urlopen

from run import ROOT, prepare

sys.path.insert(0, str(ROOT))

from apps.aurora.runtime.pilot_corpus import PilotCorpus  # noqa: E402
from apps.aurora.runtime.pilot_retrieval import HybridRetriever  # noqa: E402
from decomposed_retrieval import (  # noqa: E402
    interleave,
    rank_queries,
    reciprocal_rank_fusion,
    retrieve,
    subqueries,
)
from rerank_experiment import local_reranker, rerank  # noqa: E402
from independent_retrieval import DEPTH, IndependentSearch  # noqa: E402
from lightrag_graph_experiment import graph_search  # noqa: E402

CASES = Path(__file__).with_name("knowledge-cases.json")
APP = ROOT / "apps/aurora"
SERVICE = APP / "runtime/services/embedding_server.py"


@contextmanager
def local_embedder(folder):
    model_manifest = json.loads(
        SERVICE.with_name("embedding-manifest.json").read_text()
    )
    revision = model_manifest["revision"]
    secret = secrets.token_bytes(32)
    settings = {
        "weights": str(APP / ".models" / revision),
        "secret": secret.hex(),
        "evidence": str(folder / "embedding.jsonl"),
        "pool_long_inputs": True,
    }
    with subprocess.Popen(
        [
            str(APP / ".embedding-venv/Scripts/python.exe"),
            "-X",
            "utf8",
            "-m",
            "apps.aurora.runtime.services.embedding_server",
        ],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        encoding="utf-8",
    ) as server:
        try:
            server.stdin.write(json.dumps(settings) + "\n")
            server.stdin.close()
            ready = server.stdout.readline()
            if not ready:
                raise RuntimeError(
                    "Serviço local de embeddings encerrou na inicialização"
                )
            address = f"http://127.0.0.1:{json.loads(ready)['port']}/embed"

            def embed(texts):
                body = json.dumps({"texts": texts, "issued": time.time()}).encode()
                signature = hmac.digest(secret, body, "sha256").hex()
                request = Request(address, body, {"x-signature": signature})
                with urlopen(request, timeout=45) as response:
                    return json.load(response)["vectors"]

            yield embed, revision, {"address": address, "secret": secret.hex()}
        finally:
            server.terminate()
            server.wait(timeout=15)


def matches(passage, expected):
    source, line, text = expected
    return (
        passage["source"] == source
        and passage["line"] == line
        and text in passage["quote"]
    )


def score(cases, retrieve, pages, protocol):
    rows = []
    for case in cases:
        start = time.perf_counter()
        candidates = retrieve(case["goal"])
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        evidence = [
            [rank for rank, p in enumerate(candidates, 1) if matches(p, expected)]
            for expected in case["evidence"]
        ]
        rows.append(
            {
                "id": case["id"],
                "positive": bool(evidence),
                "critical": case.get("critical", False),
                "complete": all(evidence) if evidence else None,
                "evidence_ranks": evidence,
                "latency_ms": elapsed_ms,
                "candidates": [
                    {
                        "id": p["id"],
                        "source": p["source"],
                        "line": p["line"],
                        "page": pages[p["source"]][p["line"]],
                    }
                    for p in candidates
                ],
            }
        )
    positives = [row for row in rows if row["positive"]]
    found = sum(bool(ranks) for row in positives for ranks in row["evidence_ranks"])
    total = sum(len(row["evidence_ranks"]) for row in positives)
    complete = sum(row["complete"] for row in positives)
    all_critical = all(row["complete"] for row in positives if row["critical"])
    return {
        "complete_positives": complete,
        "total_positives": len(positives),
        "evidence_found": found,
        "evidence_total": total,
        "complete_critical_cases": all_critical,
        "negative_cases_without_candidates": sum(
            not row["candidates"] for row in rows if not row["positive"]
        ),
        "retrieval_gate_passed": (
            complete >= protocol["minimum_complete_positives"]
            and found / total >= protocol["minimum_evidence_recall"]
            and all_critical
        ),
        "cases": rows,
    }


def diagnose_pool(cases, lookup, contexts):
    rows = {}
    for case in cases:
        if not case["evidence"]:
            continue
        goal = case["goal"]
        rankings = lookup(goal)
        rows[case["id"]] = [
            [
                next(
                    (
                        rank
                        for rank, p in enumerate(ranking, 1)
                        if matches(contexts.get(p["id"], p), expected)
                    ),
                    None,
                )
                for ranking in rankings
            ]
            for expected in case["evidence"]
        ]
    return {"depth_per_query": DEPTH, "evidence_ranks_by_query": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "reports/aurora-validacao-conhecimento.json",
        help="Caminho novo para o registro do ensaio",
    )
    parser.add_argument(
        "--context-layout", type=Path, help="Linhas de contexto revisadas por fonte"
    )
    parser.add_argument("--decompose", action="store_true")
    parser.add_argument("--rerank", action="store_true")
    parser.add_argument("--independent", action="store_true")
    parser.add_argument("--graph", action="store_true")
    args = parser.parse_args()
    if (args.decompose or args.rerank) and not args.context_layout:
        parser.error("--decompose e --rerank requerem --context-layout")
    if args.independent and not args.rerank:
        parser.error("--independent requer --rerank")
    if args.graph and not args.independent:
        parser.error("--graph requer --independent")
    raw = CASES.read_bytes()
    protocol = json.loads(raw)
    cases = protocol["cases"]
    with tempfile.TemporaryDirectory(
        prefix="aurora-knowledge-", dir=CASES.parent
    ) as temp:
        folder = Path(temp)
        manifest, pages, _ = prepare(folder)
        corpus = PilotCorpus(manifest)
        if corpus.sha256 != protocol["manifest_sha256"]:
            raise ValueError("O corpus diverge da referência do piloto")
        for case in cases:
            for evidence in case["evidence"]:
                if not any(
                    matches(passage, evidence) for passage, _ in corpus.passages
                ):
                    raise ValueError(
                        f"Evidência de referência ausente do índice: {case['id']}"
                    )
        lexical = score(cases, corpus.retrieve, pages, protocol)
        context_results = {}
        if args.context_layout:
            layout_raw = args.context_layout.read_bytes()
            layout = json.loads(layout_raw)
            publication = json.loads(manifest.read_bytes())
            for doc in publication["documents"]:
                doc["context_lines"] = layout[doc["source"]]
            context_manifest = folder / "context-manifest.json"
            context_manifest.write_text(json.dumps(publication), encoding="utf-8")
            contextual = PilotCorpus(context_manifest)
            if contextual.passages != corpus.passages:
                raise ValueError(
                    "As anotações de contexto alteraram as frases ranqueadas"
                )
            context_results = {
                "context_layout_sha256": hashlib.sha256(layout_raw).hexdigest(),
                "context_manifest_sha256": contextual.sha256,
                "lexical_context": score(cases, contextual.retrieve, pages, protocol),
            }
        with local_embedder(folder) as (embed, revision, connection):
            start = time.perf_counter()
            corpus.hybrid = HybridRetriever(corpus.passages, embed)
            index_seconds = round(time.perf_counter() - start, 3)
            hybrid = score(cases, corpus.retrieve, pages, protocol)
            if args.context_layout:
                contextual.hybrid = corpus.hybrid
                context_results["automatic_hybrid_context"] = score(
                    cases, contextual.retrieve, pages, protocol
                )
            if args.decompose:
                context_results["candidate_pool_diagnostic"] = diagnose_pool(
                    cases,
                    lambda goal: rank_queries(
                        corpus.hybrid, [goal, *subqueries(goal)], DEPTH
                    ),
                    contextual.contexts,
                )
                context_results["subqueries"] = {
                    case["id"]: parts
                    for case in cases
                    if (parts := subqueries(case["goal"]))
                }
                for name, merge in (
                    ("interleaved", interleave),
                    ("rrf", reciprocal_rank_fusion),
                ):
                    contextual.hybrid = SimpleNamespace(
                        retrieve=partial(retrieve, corpus.hybrid, merge)
                    )
                    context_results[f"decomposed_{name}"] = score(
                        cases, contextual.retrieve, pages, protocol
                    )
            if args.rerank:
                with local_reranker(APP) as (score_pairs, reranker):
                    context_results["reranker"] = reranker
                    for name, depth, by_clause in (
                        ("rerank_depth_6", 6, False),
                        ("rerank_depth_24", 24, False),
                        ("rerank_clauses_depth_24", 24, True),
                    ):
                        lookup = partial(
                            rerank,
                            corpus.hybrid,
                            contextual.contexts,
                            score_pairs,
                            depth,
                            by_clause=by_clause,
                        )
                        context_results[name] = score(cases, lookup, pages, protocol)
                    if args.independent:
                        with closing(sqlite3.connect(":memory:")) as db:
                            channels = IndependentSearch(db, corpus.hybrid)
                            for mode in ("bm25", "vector", "fusion"):
                                context_results[f"independent_{mode}"] = score(
                                    cases,
                                    partial(
                                        channels.retrieve,
                                        mode,
                                        contextual.contexts,
                                        score_pairs,
                                    ),
                                    pages,
                                    protocol,
                                )
                                context_results[f"independent_{mode}_pool"] = (
                                    diagnose_pool(
                                        cases,
                                        partial(channels.rankings, mode=mode),
                                        contextual.contexts,
                                    )
                                )
                            if args.graph:
                                with graph_search(
                                    APP, folder, connection, contextual
                                ) as (graph, metadata):
                                    lookup = partial(
                                        channels.retrieve,
                                        "fusion",
                                        contextual.contexts,
                                        score_pairs,
                                        graph=graph,
                                    )
                                    context_results["independent_fusion_graph"] = score(
                                        cases, lookup, pages, protocol
                                    )
                                    context_results["independent_fusion_graph_pool"] = (
                                        diagnose_pool(
                                            cases,
                                            partial(
                                                channels.rankings,
                                                mode="fusion",
                                                graph=graph,
                                            ),
                                            contextual.contexts,
                                        )
                                    )
                                    context_results["graph"] = metadata
    result = {
        "protocol_sha256": hashlib.sha256(raw).hexdigest(),
        "manifest_sha256": corpus.sha256,
        "passages": len(corpus.passages),
        "embedding_revision": revision,
        "hybrid_index_seconds": index_seconds,
        "lexical": lexical,
        "automatic_hybrid": hybrid,
        **context_results,
    }
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    for mode, metrics in result.items():
        if isinstance(metrics, dict) and "cases" in metrics:
            print(mode, {key: val for key, val in metrics.items() if key != "cases"})


if __name__ == "__main__":
    main()
