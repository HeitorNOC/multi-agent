"""Evaluate question-only semantic planning against the mixed document corpus."""

import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
import tempfile
import time
from contextlib import closing
from functools import partial
from pathlib import Path

from compare_chief_search import validate_queries
from compare_evidence_slots import evaluate
from compare_page_retrieval import batched_scores
from decomposed_retrieval import reciprocal_rank_fusion
from independent_retrieval import IndependentSearch
from rerank_experiment import local_reranker
from run_mixed_corpus import DOCUMENTS, GOAL, OTHER_PAGES, prepare_mixed
from validate_knowledge import APP, HybridRetriever, PilotCorpus, local_embedder

from apps.aurora.runtime.pilot_retrieval import normalized
from apps.aurora.runtime.services.codex_provider import CodexProvider

INSTRUCTIONS = """Planeje uma investigação documental para a tarefa recebida.
Se a tarefa tiver partes distintas, formule até três perguntas curtas e independentes
que um especialista possa pesquisar em documentação técnica. Explicite as condições
e entidades da tarefa quando elas ajudarem a distinguir documentos de outros domínios.
Separe comportamento descrito de garantias que precisam de comprovação. Não tente
responder, não invente identificadores e não suponha nomes de documentos. Se a tarefa
já for uma pergunta simples, use lista vazia. Retorne somente {"queries":["..."]}."""
SCOPED_INSTRUCTIONS = """Planeje buscas documentais a partir da tarefa, sem respondê-la.
Use uma consulta por fato observável necessário. Uma frase com mais de uma pergunta
ou condição exige consultas separadas, mesmo se houver apenas um ponto de interrogação.
Se relevantes ao pedido, separe estado operacional, estado da entidade, evento registrado
e mecanismo de proteção. Preserve o canal ou ambiente explícito para evitar homônimos.
Formule consultas concretas que um manual técnico poderia responder. Não presuma
que uma garantia exista. Não invente nomes técnicos ou de arquivos. Devolva até três
consultas, ou lista vazia se houver apenas um fato e o pedido já for preciso.
Retorne somente {"queries":["..."]}."""

FORMATS = {
    "training-markdown": (
        "Operação de treinamento do Webchat",
        "# Webchat de treinamento\n## Transferência para atendente\n"
        "| Atendimento assumido | DEMO_READY | Apenas no emulador Webchat |\n",
    ),
    "rehearsal-csv": (
        "Exportação CSV do teste de continuidade",
        "ambiente;cenario;controle;aprovador\n"
        "laboratorio-azul;retomada de fila;revalidar a versão da fila;Equipe Delta\n",
    ),
    "rehearsal-note": (
        "Nota informal de um ensaio anterior",
        "retomada da fila, acho que era no laboratório verde, confirmar com Equipe Gama\n",
    ),
}


def mixed_formats(folder, extra_formats=None):
    manifest, pages, documents = prepare_mixed(folder, DOCUMENTS + OTHER_PAGES)
    for source, (title, content) in (FORMATS | (extra_formats or {})).items():
        path = folder / f"{source}.txt"
        data = content.encode("utf-8")
        path.write_bytes(data)
        documents.append(
            {
                "source": source,
                "title": title,
                "version": 1,
                "current": True,
                "area": "Validação",
                "origin": "Controle sintético",
                "file": path.name,
                "classification": "model-approved",
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
        pages[source] = dict.fromkeys(range(1, len(content.splitlines()) + 1))
    manifest.write_text(
        json.dumps({"version": 1, "documents": documents}), encoding="utf-8"
    )
    return manifest, pages, documents


def plan(provider, case, number, instructions):
    started = time.perf_counter()
    try:
        reply = provider.run(
            case["goal"], instructions, [], {"id": case["id"], "number": number}
        )
        queries = validate_queries(reply, case["goal"])
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        return [], type(exc).__name__, time.perf_counter() - started
    return queries, None, time.perf_counter() - started


def compare(output, scoped_planner=False):
    challenge = Path(__file__).with_name("chief-search-cases.json")
    cases = json.loads(challenge.read_text(encoding="utf-8"))
    handoff = next(case for case in cases if case["id"] == "handoff")
    cases += [
        {**handoff, "id": "handoff-original", "goal": GOAL},
        {
            "id": "csv-control",
            "goal": "No laboratório azul, o que deve ser conferido na retomada de fila e quem aprova?",
            "evidence": [
                ["rehearsal-csv", 2, "revalidar a versão da fila"],
                ["rehearsal-csv", 2, "Equipe Delta"],
            ],
        },
    ]
    with tempfile.TemporaryDirectory(prefix="aurora-semantic-") as tmp:
        folder = Path(tmp)
        evidence = folder / "evidence"
        evidence.mkdir()
        empty = folder / "empty"
        empty.mkdir()
        shutil.copy2(APP / "runtime/services/provider.schema.json", folder)
        provider = CodexProvider(
            {
                "model_budget": str(folder / "unused"),
                "evidence": str(evidence),
                "model_cwd": str(empty),
                "instance": "semantic-plan-eval",
                "model_name": "gpt-6.1-terra",
                "retain_model_content": False,
            }
        )
        manifest, pages, documents = mixed_formats(folder)
        corpus = PilotCorpus(manifest)
        titles = {doc["source"]: doc["title"] for doc in documents}
        titled = {
            row["id"]: {**row, "quote": f"{titles[row['source']]} | {row['quote']}"}
            for row, _ in corpus.passages
        }
        results = []
        with (
            local_embedder(folder) as (embed, revision, _),
            local_reranker(APP) as (score, reranker),
            closing(sqlite3.connect(":memory:")) as db,
        ):
            search = IndependentSearch(db, HybridRetriever(corpus.passages, embed))
            title_vectors = dict(
                zip(titles, map(normalized, embed(list(titles.values()))), strict=True)
            )
            for number, case in enumerate(cases, 1):
                instructions = SCOPED_INSTRUCTIONS if scoped_planner else INSTRUCTIONS
                queries, error, seconds = plan(provider, case, number, instructions)
                row = {
                    "id": case["id"],
                    "expected": len(case["evidence"]),
                    "planner_error": error,
                    "planner_seconds": round(seconds, 3),
                }
                for mode, parts in (
                    ("direct", [case["goal"]]),
                    ("semantic", queries or [case["goal"]]),
                ):
                    started = time.perf_counter()
                    vectors = embed(parts)
                    pools = [
                        list(
                            reciprocal_rank_fusion(
                                [search.vector(vector), search.lexical(query)]
                            )
                        )
                        for query, vector in zip(parts, vectors, strict=True)
                    ]
                    args = (
                        parts,
                        titled,
                        partial(batched_scores, score),
                        case["evidence"],
                        pages,
                    )
                    row[mode] = evaluate(pools, *args, started)
                    if mode == "semantic":
                        started = time.perf_counter()
                        scoped = [
                            prioritize_sources(pool, vector, title_vectors)
                            for pool, vector in zip(pools, vectors, strict=True)
                        ]
                        row["semantic_sources"] = evaluate(scoped, *args, started)
                results.append(row)
                print(
                    case["id"],
                    error,
                    [
                        row[key]["found"]
                        for key in ("direct", "semantic", "semantic_sources")
                    ],
                    flush=True,
                )
        calls = evidence / "model-calls.jsonl"
        result = {
            "manifest_sha256": corpus.sha256,
            "planner": "scoped" if scoped_planner else "initial",
            "embedding_revision": revision,
            "reranker": reranker,
            "documents": len(documents),
            "passages": len(corpus.passages),
            "cases": results,
            "model_calls": [json.loads(line) for line in calls.read_text().splitlines()]
            if calls.exists()
            else [],
        }
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2, ensure_ascii=False)


def prioritize_sources(pool, embedding, title_vectors):
    vector = normalized(embedding)
    sources = sorted(
        title_vectors,
        key=lambda key: -sum(
            a * b for a, b in zip(vector, title_vectors[key], strict=True)
        ),
    )[:3]
    scoped = [row for row in pool if row["source"] in sources]
    return (
        list({row["id"]: row for row in [*scoped, *pool[:4]]}.values())
        if scoped
        else pool
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scoped-planner", action="store_true")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Informe um arquivo de saída novo.")
    compare(args.output, args.scoped_planner)
