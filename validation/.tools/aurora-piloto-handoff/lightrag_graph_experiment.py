"""Map LightRAG candidates back to the exact passages of the approved manifest."""

import json
import subprocess
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def graph_search(app, folder, connection, corpus):
    unique = {}
    representatives = {}
    for sentence, _ in corpus.passages:
        passage = corpus.contexts.get(sentence["id"], sentence)
        unique.setdefault(passage["quote"], passage)
        representatives.setdefault(passage["id"], sentence)
    allowed = {p["id"] + ".txt": p for p in unique.values()}
    graph_dir = folder / "lightrag-scratch"
    graph_dir.mkdir()
    settings = {
        **connection,
        "folder": str(graph_dir),
        "passages": list(allowed.values()),
    }
    command = [
        str(app / ".venv/Scripts/python.exe"),
        "-X",
        "utf8",
        str(Path(__file__).with_name("lightrag_graph_worker.py")),
    ]
    with subprocess.Popen(
        command,
        cwd=folder,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        encoding="utf-8",
    ) as worker:
        try:

            def request(value):
                worker.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
                worker.stdin.flush()
                reply = worker.stdout.readline()
                if not reply:
                    raise RuntimeError("LightRAG encerrou antes de responder")
                return json.loads(reply)

            metadata = request(settings)
            metadata["rejected_chunks"] = 0
            metadata["queries_with_chunks"] = 0

            def retrieve(query):
                result = []
                for chunk in request(query):
                    item = allowed.get(chunk.get("file_path"))
                    if item and item["quote"] == chunk.get("content"):
                        result.append(representatives[item["id"]])
                    else:
                        metadata["rejected_chunks"] += 1
                metadata["queries_with_chunks"] += bool(result)
                return result

            yield retrieve, metadata
        finally:
            worker.stdin.close()
            try:
                worker.wait(timeout=15)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=10)
