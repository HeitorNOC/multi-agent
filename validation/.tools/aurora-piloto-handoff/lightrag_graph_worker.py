"""Disposable LightRAG graph of literal technical mentions in approved passages."""

import asyncio
import hmac
import json
import logging
import re
import sys
import time
from urllib.request import Request, urlopen

import lightrag
import numpy as np
from lightrag import LightRAG, QueryParam
from lightrag.utils import EmbeddingFunc, Tokenizer

IDENTIFIER = re.compile(
    r"\b(?:[a-zA-Z][\w]*(?:[._-][\w]+)+|[A-Z][A-Z0-9_]{2,}|[a-z]+[A-Z]\w+)\b"
)


def graph(passages):
    chunks, entities, edges = [], {}, []
    for p in passages:
        alias = p["id"]
        quote = p["quote"]
        path = alias + ".txt"
        chunks.append({"content": quote, "source_id": alias, "file_path": path})
        mentions = sorted(set(IDENTIFIER.findall(quote)), key=str.casefold)
        if not mentions:
            continue
        block = "TRECHO " + alias[:16]
        provenance = {"source_id": alias, "file_path": path}
        entities[block] = {
            **provenance,
            "entity_name": block,
            "entity_type": "trecho",
            "description": quote,
        }
        for mention in sorted({term.upper() for term in mentions}):
            entities.setdefault(
                mention,
                {
                    **provenance,
                    "entity_name": mention,
                    "entity_type": "identificador",
                    "description": mention,
                },
            )
            edges.append(
                {
                    **provenance,
                    "src_id": mention,
                    "tgt_id": block,
                    "keywords": mention,
                    "description": "Menção literal no trecho",
                    "weight": 1.0,
                }
            )
    return {
        "chunks": chunks,
        "entities": list(entities.values()),
        "relationships": edges,
    }


def embed_local(settings, texts):
    body = json.dumps({"texts": texts, "issued": time.time()}).encode()
    signature = hmac.digest(bytes.fromhex(settings["secret"]), body, "sha256").hex()
    request = Request(settings["address"], body, {"x-signature": signature})
    with urlopen(request, timeout=45) as response:
        return np.array(json.load(response)["vectors"], dtype=np.float32)


async def forbidden_llm(*args, **kwargs):
    raise RuntimeError("Este perfil do ensaio proíbe geração e extração por LLM")


class ByteTokenizer:
    def encode(self, text):
        return list(text.encode("utf-8"))

    def decode(self, ids):
        return bytes(ids).decode("utf-8", errors="replace")


async def main(settings):
    async def embed(texts, **kwargs):
        return await asyncio.to_thread(embed_local, settings, texts)

    start = time.perf_counter()
    rag = LightRAG(
        working_dir=settings["folder"],
        tokenizer=Tokenizer("utf8-bytes", ByteTokenizer()),
        embedding_func=EmbeddingFunc(embedding_dim=384, max_token_size=128, func=embed),
        embedding_batch_num=32,
        embedding_func_max_async=1,
        cosine_better_than_threshold=0.38,
        llm_model_func=forbidden_llm,
    )
    await rag.initialize_storages()
    try:
        kg = graph(settings["passages"])
        await rag.ainsert_custom_kg(kg)
        print(
            json.dumps(
                {
                    "version": lightrag.__version__,
                    "counts": {name: len(items) for name, items in kg.items()},
                    "build_seconds": round(time.perf_counter() - start, 3),
                }
            ),
            flush=True,
        )
        for line in sys.stdin:
            query = json.loads(line)
            result = await rag.aquery_data(
                query,
                QueryParam(
                    mode="local",
                    ll_keywords=[query],
                    hl_keywords=[],
                    top_k=8,
                    chunk_top_k=12,
                    max_total_tokens=16000,
                    enable_rerank=False,
                ),
            )
            chunks = result.get("data", {}).get("chunks", [])
            print(json.dumps(chunks, ensure_ascii=False), flush=True)
    finally:
        await rag.finalize_storages()


if __name__ == "__main__":
    logging.getLogger("lightrag").setLevel(logging.ERROR)
    asyncio.run(main(json.loads(sys.stdin.readline())))
