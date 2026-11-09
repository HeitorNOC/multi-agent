"""Execute one authorized advisory task through the regular Aurora launcher."""

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
PYTHON = ROOT / "apps/aurora/.venv/Scripts/python.exe"
GOAL = "Quais estados e evidências são necessários para que uma conversa passe do MBA para um atendente sem que ambos respondam ao mesmo tempo?"
DOCUMENTS = [
    ("fluxo", "Fluxo-de-Mensageria.pdf", (9, 10, 12)),
    ("mba", "Resumo-Meta-Business-Agent-360dialog.pdf", (3, 4, 8)),
    ("contact", "Contact-Center-e-Workspace.pdf", (9, 11, 13, 15, 16, 17)),
]
FACETS = [
    {
        "query": "WAITING atendimento criado e aguardando um atendente na fila.",
        "anchors": ["waiting"],
    },
    {
        "query": "ACTIVE um atendente iniciou e assumiu o atendimento humano.",
        "anchors": ["active"],
    },
    {
        "query": "control_passed transferência de controle da conversa MESSAGING_HANDOVER.",
        "anchors": ["control_passed"],
    },
    {
        "query": "STANDBY_CUSTOMER cliente falando enquanto o MBA responde: só arquiva, sem resposta concorrente.",
        "anchors": ["standby_customer"],
    },
    {
        "query": "Handoff entre bot e humano muda o tipo de sessão ML_MODEL para HUMAN.",
        "anchors": ["ml_model"],
    },
    {
        "query": "Limitações da transferência de controle do Meta Business Agent ainda incompletas.",
        "anchors": ["incompletas"],
    },
]


def prepare(folder, sources=DOCUMENTS):
    import pdfplumber

    documents = []
    page_by_line = {}
    original = Path(r"C:\Users\PC\Documents\Documentações")
    for id, name, selected in sources:
        lines = []
        pages = {}
        with pdfplumber.open(original / name) as pdf:
            for number in selected:
                text = pdf.pages[number - 1].extract_text()
                # These PDFs have a one-line header and footer. Rejoin layout wraps
                # so the same sentence can be found across visual line breaks.
                body = "\n".join(text.splitlines()[1:-1])
                chunks = re.split(r"\n(?=\(cid:127\)|\d+(?:\.\d+)*\.?(?: |$))", body)
                for chunk in chunks:
                    line = " ".join(chunk.replace("(cid:127)", "").split())
                    if line:
                        lines.append(line)
                        pages[len(lines)] = number
        name_txt = id + ".txt"
        content = ("\n".join(lines) + "\n").encode("utf-8")
        (folder / name_txt).write_bytes(content)
        page_by_line[id] = pages
        documents.append(
            {
                "source": id,
                "version": 1,
                "current": True,
                "classification": "model-approved",
                "title": name,
                "area": "Mensageria",
                "origin": "Transcrição das páginas " + ", ".join(map(str, selected)),
                "file": name_txt,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    manifest = folder / "manifest.json"
    manifest.write_text(
        json.dumps({"version": 1, "documents": documents}), encoding="utf-8"
    )
    return manifest, page_by_line, documents


def launch():
    import getpass
    import runpy
    from contextlib import ExitStack

    password = sys.stdin.readline().strip()
    getpass.getpass = lambda *args: password
    sys.stdin.isatty = lambda: True
    focused = "--handoff-runtime-lab" in sys.argv
    sys.argv = [
        str(ROOT / "demo-enterprise/start.py"),
        *(arg for arg in sys.argv[2:] if arg != "--handoff-runtime-lab"),
    ]
    if not focused:
        runpy.run_path(sys.argv[0], run_name="__main__")
        return
    sys.path.insert(0, str(ROOT))
    from handoff_runtime_lab import retriever_factory

    with ExitStack() as stack:
        runpy.run_module(
            "apps.aurora.ops.launcher",
            init_globals={"pilot_retriever_factory": retriever_factory(stack, ROOT)},
            run_name="__main__",
        )


def execute(prepare_corpus=prepare, goal=GOAL, output=None, *, directive=None):
    sys.path.insert(0, str(ROOT))
    from apps.aurora.runtime.directive_source import DirectiveSource
    from apps.aurora.runtime.pilot_corpus import PilotCorpus

    with tempfile.TemporaryDirectory(
        prefix="aurora-handoff-", dir=ROOT / "validation/.tools"
    ) as temp:
        folder = Path(temp)
        manifest, page_by_line, documents = prepare_corpus(folder)
        corpus = PilotCorpus(manifest)
        directive_passages = []
        candidates = corpus.retrieve(goal)
        print(
            "Corpus validado; candidatos por fonte:",
            [r["source"] for r in candidates],
            flush=True,
        )
        if "--preflight" in sys.argv:
            for row in candidates:
                print(
                    row["source"],
                    page_by_line[row["source"]][row["line"]],
                    row["quote"],
                )
            return
        password = secrets.token_urlsafe(32)
        assisted = "--hybrid" in sys.argv
        focused = "--handoff-runtime-lab" in sys.argv
        hybrid = assisted or focused or "--hybrid-auto" in sys.argv
        args = ["--pilot-retrieval", "hybrid"] if hybrid else []
        body = {"goal": goal}
        if directive:
            raw_directive = directive.read_bytes()
            body = {"directive": hashlib.sha256(raw_directive).hexdigest()}
            directive_passages = DirectiveSource(
                body["directive"], raw_directive.decode("utf-8-sig")
            ).passages
            args.extend(["--pilot-directive", str(directive.resolve())])
        if focused:
            args.append("--handoff-runtime-lab")
        if assisted:
            facets_path = folder / "facets.json"
            facets_path.write_text(
                json.dumps({"goal": goal, "facets": FACETS}, ensure_ascii=False),
                encoding="utf-8",
            )
            args.extend(["--pilot-facets", str(facets_path)])
        with (folder / "launcher.log").open("w", encoding="utf-8") as log:
            launcher = subprocess.Popen(
                [
                    str(PYTHON),
                    "-X",
                    "utf8",
                    __file__,
                    "--launch",
                    "--pilot-manifest",
                    str(manifest),
                    "--pilot-user",
                    "operador-piloto",
                    *args,
                ],
                cwd=ROOT,
                stdout=log,
                stderr=log,
                stdin=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                env={**os.environ, "TMP": str(folder), "TEMP": str(folder)},
            )
            launcher.stdin.write(password + "\n")
            launcher.stdin.close()
            url = cookie = None

            def call(path, body=None, key=None):
                request = Request(
                    url + path,
                    None if body is None else json.dumps(body).encode(),
                    {
                        "Content-Type": "application/json",
                        **({"Cookie": cookie} if cookie else {}),
                        **({"Idempotency-Key": key} if key else {}),
                    },
                )
                with urlopen(request, timeout=12) as response:
                    return json.load(response), response.headers

            try:
                startup = time.monotonic() + 200
                while time.monotonic() < startup and launcher.poll() is None:
                    rows = (
                        (folder / "launcher.log")
                        .read_text(encoding="utf-8")
                        .splitlines()
                    )
                    url = next(
                        (
                            json.loads(row)["url"]
                            for row in rows
                            if row.startswith('{"url":')
                        ),
                        None,
                    )
                    if url:
                        break
                    time.sleep(0.25)
                if not url:
                    raise RuntimeError(
                        "Launcher não publicou a URL; saída: " + str(launcher.poll())
                    )
                _, headers = call(
                    "/api/pilot/login", {"id": "operador-piloto", "password": password}
                )
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                while time.monotonic() < startup and launcher.poll() is None:
                    state, _ = call("/api/state")
                    if state["runtime"]["phase"] == "ready":
                        break
                    time.sleep(0.6)
                else:
                    raise RuntimeError("Aurora não ficou pronto")
                admitted_at = time.monotonic()
                key = uuid4().hex
                admission = None
                if "--admission-replay" in sys.argv:
                    barrier = Barrier(2, timeout=5)

                    def submit():
                        barrier.wait()
                        return call("/api/jobs", body, key)[0]

                    with ThreadPoolExecutor(max_workers=2) as pool:
                        first = pool.submit(submit)
                        second = pool.submit(submit)
                        job, concurrent = first.result(), second.result()
                    replay, _ = call("/api/jobs", body, key)
                    ids = [job["id"], concurrent["id"], replay["id"]]
                    admission = {"job_ids": ids, "same_job": len(set(ids)) == 1}
                else:
                    job, _ = call("/api/jobs", body, key)
                print("Tarefa admitida no Aurora.", flush=True)
                prior = None
                deadline = time.monotonic() + 1750
                while time.monotonic() < deadline and launcher.poll() is None:
                    state, _ = call("/api/state")
                    current = next(
                        row for row in state["jobs"] if row["id"] == job["id"]
                    )
                    stages = [row["node"] for row in current["events"]]
                    progress = (
                        current["status"],
                        stages[-1] if stages else "",
                        len(stages),
                    )
                    if progress != prior:
                        print("Estado:", *progress, flush=True)
                        prior = progress
                    if not current["worker_active"] and current["status"] not in {
                        "queued",
                        "created",
                        "running",
                    }:
                        break
                    time.sleep(1.5)
                else:
                    raise RuntimeError("Tarefa não chegou a um estado terminal")
                observed = next(
                    (
                        row["detail"]["telemetry"]["evidence"]
                        for row in current["events"]
                        if row["node"] == "retrieval_completed"
                    ),
                    None,
                )
                if observed is not None:
                    by_id = {p["id"]: p for p, _ in corpus.passages}
                    by_id.update((p["id"], p) for p in directive_passages)
                    candidates = [
                        by_id[row["retrieved_fragment_id"]] for row in observed
                    ]
                result = {
                    "goal": current.get("goal", goal),
                    "status": current["status"],
                    "error": current.get("error"),
                    "plan": current["plan"],
                    "model": "gpt-6.1-terra",
                    "usage": state["runtime"]["usage"],
                    "manifest_sha256": corpus.sha256,
                    "documents": documents,
                    "retrieval": (
                        "hybrid-handoff-runtime-lab"
                        if focused
                        else "hybrid-with-task-vocabulary"
                        if assisted
                        else "hybrid"
                        if hybrid
                        else "lexical"
                    ),
                    "facets": FACETS if assisted else [],
                    "job_seconds": round(time.monotonic() - admitted_at, 2),
                    "event_kinds": stages,
                    "retrieval_observed": observed is not None,
                    "candidates": [
                        {
                            "source": row["source"],
                            "page": page_by_line.get(row["source"], {}).get(row["line"]),
                            "line": row["line"],
                        }
                        for row in candidates
                    ],
                    "report": current["review"]["report"]
                    if current["review"]
                    else None,
                }
                if admission is not None:
                    admission["jobs_visible"] = len(state["jobs"])
                    admission["worker_starts"] = stages.count("worker_started")
                    result["admission_replay"] = admission
                if directive:
                    result["directive"] = body["directive"]
                    result["retrieval_by_agent"] = [
                        {
                            "agent": event["detail"].get("capability"),
                            "sources": sorted(
                                {
                                    item["source_id"]
                                    for item in event["detail"]["telemetry"]["evidence"]
                                }
                            ),
                        }
                        for event in current["events"]
                        if event["node"] == "retrieval_completed"
                    ]
                    result["directive_dispatches"] = [
                        json.loads(line)
                        for line in (folder / "launcher.log")
                        .read_text(encoding="utf-8")
                        .splitlines()
                        if line.startswith('{"pilot_directive":')
                    ]
                if result["report"]:
                    for row in result["report"]["citations"]:
                        row["pdf_page"] = page_by_line.get(row["source"], {}).get(row["line"])
                result["diagnostics"] = [
                    json.loads(line)
                    for path in folder.rglob("service-*.log")
                    for line in path.read_text(
                        encoding="utf-8", errors="replace"
                    ).splitlines()
                    if line.startswith('{"native_error":')
                ]
                result["diagnostics"].extend(
                    json.loads(line)
                    for path in folder.rglob("backend-errors.log")
                    for line in path.read_text(encoding="utf-8").splitlines()
                    if line.startswith('{"service":')
                )
                result["diagnostics"].extend(
                    json.loads(line)
                    for path in folder.rglob("worker-diagnostics.jsonl")
                    for line in path.read_text(encoding="utf-8").splitlines()
                )
                result["diagnostics"].extend(
                    row["detail"]
                    for row in current["events"]
                    if row["node"] == "plan_rejected"
                )
                result["model_call_metadata"] = [
                    {
                        key: row.get(key)
                        for key in (
                            "call",
                            "seconds",
                            "exit_code",
                            "unexpected_tool_events",
                        )
                    }
                    for path in folder.rglob("model-calls.jsonl")
                    for row in map(
                        json.loads, path.read_text(encoding="utf-8").splitlines()
                    )
                ]
                target = output or ROOT / (
                    "reports/aurora-piloto-handoff-hibrido-reexecucao.json"
                    if hybrid
                    else "reports/aurora-piloto-handoff.json"
                )
                with target.open("x" if output else "w", encoding="utf-8") as stream:
                    stream.write(
                        json.dumps(result, ensure_ascii=False, indent=2) + "\n"
                    )
                print("Resultado salvo. Status:", result["status"], flush=True)
            finally:
                if launcher.poll() is None and url and cookie:
                    try:
                        call("/api/pilot/stop", {})
                        launcher.wait(timeout=90)
                        print("Sessão temporária encerrada.", flush=True)
                    except (HTTPError, URLError, subprocess.TimeoutExpired):
                        print(
                            "A sessão precisa de verificação de encerramento.",
                            flush=True,
                        )


if __name__ == "__main__":
    if sys.argv[1:2] == ["--launch"]:
        launch()
    else:
        execute()
