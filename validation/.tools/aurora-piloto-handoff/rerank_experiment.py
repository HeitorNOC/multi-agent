"""Reorder an authorized shortlist with a pinned multilingual cross-encoder."""

import hashlib
import json
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

from apps.aurora.runtime.pilot_corpus import MAX_PASSAGES
from decomposed_retrieval import (
    interleave,
    rank_queries,
    reciprocal_rank_fusion,
    subqueries,
)

REVISION = "173760f"
FILES = {
    "model_quint8_avx2.onnx": "6c2513767fb63d008a4377bef7a7a3555433d9436342bb53e35a3a72ffc52d4b",
    "tokenizer.json": "3a56def25aa40facc030ea8b0b87f3688e4b3c39eb8b45d5702b3a1300fe2a20",
}


@contextmanager
def local_reranker(app):
    folder = app / ".models" / f"reranker-mmarco-{REVISION}"
    for name, expected in FILES.items():
        with (folder / name).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError(f"Peso ou tokenizador divergente: {name}")
    start = time.perf_counter()
    with subprocess.Popen(
        [
            str(app / ".embedding-venv/Scripts/python.exe"),
            "-X",
            "utf8",
            str(Path(__file__).with_name("rerank_local.py")),
            str(folder),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        encoding="utf-8",
    ) as worker:
        try:
            ready = json.loads(worker.stdout.readline() or "null")
            if not ready or not ready["ready"]:
                raise RuntimeError("Ranqueador local indisponível")

            def score_pairs(query, passages):
                worker.stdin.write(
                    json.dumps([query, passages], ensure_ascii=False) + "\n"
                )
                worker.stdin.flush()
                reply = worker.stdout.readline()
                if not reply:
                    raise RuntimeError(
                        "Ranqueador local encerrou sem pontuar os trechos"
                    )
                return json.loads(reply)

            yield (
                score_pairs,
                {
                    "repository": "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
                    "revision": REVISION,
                    "files": FILES,
                    "onnxruntime": ready["runtime"],
                    "startup_ms": round((time.perf_counter() - start) * 1000, 2),
                },
            )
        finally:
            worker.stdin.close()
            try:
                worker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=10)


def rerank(hybrid, contexts, score_pairs, depth, goal, *, by_clause=False):
    queries = [goal, *subqueries(goal)]
    rankings = rank_queries(hybrid, queries, depth)
    if not rankings[0]:
        return []
    return rerank_rankings(
        rankings, contexts, score_pairs, queries if by_clause else [goal]
    )


def rerank_rankings(rankings, contexts, score_pairs, queries):
    pool = {}
    for sentence in reciprocal_rank_fusion(rankings):
        block = contexts.get(sentence["id"], sentence)
        pool.setdefault(block["id"], block)
    passages = list(pool.values())
    if not passages:
        return []
    quotes = [p["quote"] for p in passages]
    ranked = []
    for query in queries:
        scores = score_pairs(query, quotes)
        order = sorted(zip(scores, passages, strict=True), key=lambda row: -row[0])
        ranked.append([passage for _, passage in order[:MAX_PASSAGES]])
    selected = {}
    for passage in interleave(ranked):
        selected.setdefault(passage["id"], passage)
        if len(selected) == MAX_PASSAGES:
            break
    return list(selected.values())
