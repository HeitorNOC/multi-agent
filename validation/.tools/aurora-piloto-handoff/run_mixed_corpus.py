"""Compare automatic retrieval and final evidence with added distractors."""

import argparse
import hashlib
import json
import tempfile
from pathlib import Path

from run import DOCUMENTS, GOAL, ROOT, execute, prepare
from validate_knowledge import (
    CASES,
    HybridRetriever,
    PilotCorpus,
    local_embedder,
    matches,
)

OTHER_PAGES = [
    ("mba-frontend", "Base-de-Conhecimento-MBA-Frontend.pdf", (4, 7, 15)),
    ("reclame-aqui", "Documentacao-Projetos-Reclame-Aqui.pdf", (3, 7, 10, 12)),
    ("backend", "Guia-Desenvolvimento-Tatodesk-Parte-1.pdf", (8, 24, 39)),
    ("portal", "Portal-Tatodesk-Mapa-de-Conteudo.pdf", (9, 13, 17, 19)),
]

DISTRACTORS = {
    "training-calendar": (
        "Calendário de treinamento do almoxarifado. "
        "A equipe registra presença e inventário na primeira terça-feira do mês."
    ),
    "webchat-sandbox": (
        "Ambiente fictício de demonstração Webchat, sem WhatsApp e sem integração ao MBA. "
        "Quando uma conversa passa do bot de teste para um atendente, os estados e evidências "
        "são DEMO_WAIT e DEMO_READY; o emulador deixa ambos responderem ao mesmo tempo. "
        "Essa regra vale apenas para o emulador Webchat de treinamento."
    ),
    "mba-academic": (
        "MBA acadêmico em administração, sem relação com mensageria. "
        "Quando uma conversa passa do coordenador do MBA para um atendente da secretaria, "
        "o portal registra os estados da matrícula e envia as evidências por e-mail."
    ),
}


def prepare_mixed(folder, sources=DOCUMENTS):
    manifest, pages, documents = prepare(folder, sources)
    for source, content in DISTRACTORS.items():
        filename = f"{source}.txt"
        data = (content + "\n").encode("utf-8")
        (folder / filename).write_bytes(data)
        pages[source] = {1: None}
        documents.append(
            {
                "source": source,
                "version": 1,
                "current": True,
                "classification": "model-approved",
                "title": source,
                "area": "Validação",
                "origin": "Controle sintético do laboratório",
                "file": filename,
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    manifest.write_text(
        json.dumps({"version": 1, "documents": documents}), encoding="utf-8"
    )
    return manifest, pages, documents


def compare_local(output):
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    cases = [{"id": "handoff", "goal": GOAL, "evidence": []}, *cases]
    supplemental = {source for source, _, _ in OTHER_PAGES} | DISTRACTORS.keys()
    results = {}
    with tempfile.TemporaryDirectory(prefix="aurora-mixed-") as directory:
        root = Path(directory)
        with local_embedder(root) as (embed, revision, _):
            for mode in ("focused", "mixed", "real-mixed"):
                folder = root / mode
                folder.mkdir()
                if mode == "real-mixed":
                    manifest, pages, _ = prepare(folder, DOCUMENTS + OTHER_PAGES)
                else:
                    manifest, pages, _ = (
                        prepare_mixed if mode == "mixed" else prepare
                    )(folder)
                corpus = PilotCorpus(manifest)
                corpus.hybrid = HybridRetriever(corpus.passages, embed)
                queries = []
                for case in cases:
                    candidates = corpus.retrieve(case["goal"])
                    queries.append(
                        {
                            "id": case["id"],
                            "evidence_found": sum(
                                any(matches(row, expected) for row in candidates)
                                for expected in case["evidence"]
                            ),
                            "evidence_expected": len(case["evidence"]),
                            "candidates": [
                                {
                                    "source": row["source"],
                                    "line": row["line"],
                                    "page": pages[row["source"]][row["line"]],
                                    "id": row["id"],
                                    "supplemental": row["source"] in supplemental,
                                }
                                for row in candidates
                            ],
                        }
                    )
                results[mode] = {
                    "manifest_sha256": corpus.sha256,
                    "documents": len(corpus.metadata),
                    "passages": len(corpus.passages),
                    "queries": queries,
                }
    with output.open("x", encoding="utf-8") as stream:
        json.dump(
            {"embedding_revision": revision, "corpora": results}, stream, indent=2
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", choices=("focused", "mixed", "local"))
    parser.add_argument("--hybrid-auto", action="store_true", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or ROOT / "reports" / f"aurora-handoff-{args.corpus}-auto.json"
    if output.exists():
        parser.error("Informe um arquivo de saída novo.")
    if args.corpus == "local":
        compare_local(output)
    else:
        execute(prepare if args.corpus == "focused" else prepare_mixed, GOAL, output)
