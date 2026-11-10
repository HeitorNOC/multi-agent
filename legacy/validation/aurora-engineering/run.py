"""Isolated engineering exercise with bounded model calls and a durable checkpoint."""

import argparse
import difflib
import json
import os
import shutil
import sys
from pathlib import Path

from langgraph.checkpoint.postgres import PostgresSaver

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from apps.aurora.runtime.services.codex_provider import CodexProvider  # noqa: E402

from apps.aurora.runtime.engineering import (  # noqa: E402
    BASELINE,
    GOAL,
    MAX_CALLS,
    build_graph,
    run_tests,
)

POLICY = (
    "Planejamento de um ensaio isolado. Responda em JSON puro. Nunca use ferramentas."
)


def compile_graph(work, saver, *, first_run):
    logs = work / "model"
    provider = CodexProvider(
        {
            "model_budget": str(work / "unused"),
            "evidence": str(logs),
            "model_cwd": str(work / "empty"),
            "instance": "aurora-engineering-lab",
            "model_name": "gpt-6.1-terra",
            "retain_model_content": False,
        }
    )

    def ask(role, task, context=None):
        calls = logs / "model-calls.jsonl"
        number = len(calls.read_bytes().splitlines()) + 1 if calls.exists() else 1
        if number > MAX_CALLS:
            raise ValueError("Limite de inferência do ensaio atingido")
        prompt = json.dumps(
            {"objective": GOAL, "role": role, "task": task, "context": context},
            ensure_ascii=False,
        )
        text = provider.run(
            prompt, POLICY, [], {"id": role.split(":")[0], "number": number}
        )
        result = json.loads(text)
        if not isinstance(result, dict) or len(text) > 12_000:
            raise ValueError("Resposta inválida")
        return result

    graph = build_graph(ask)
    return graph.compile(
        checkpointer=saver, interrupt_before=["qa"] if first_run else None
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("baseline", "first", "resume"))
    parser.add_argument("work", type=Path)
    args = parser.parse_args()
    work = args.work.resolve()
    if args.mode == "baseline":
        work.mkdir(parents=True, exist_ok=False)
        (work / "model").mkdir()
        (work / "empty").mkdir()
        shutil.copyfile(
            ROOT / "apps/aurora/runtime/services/provider.schema.json",
            work / "provider.schema.json",
        )
        result = run_tests(BASELINE)
        (work / "baseline.json").write_text(
            json.dumps(result, indent=2), encoding="utf-8"
        )
        assert result["exit_code"] == 1 and "ERR_ASSERTION" in result["log"]
        return

    first_run = args.mode == "first"
    config = {"configurable": {"thread_id": "aurora-engineering:" + work.name}}
    with PostgresSaver.from_conn_string(os.environ["AURORA_ENGINEERING_DSN"]) as saver:
        saver.setup()
        graph = compile_graph(work, saver, first_run=first_run)
        snap = graph.get_state(config)
        if first_run:
            assert not snap.values
            graph.invoke({}, config, durability="sync")
            snap = graph.get_state(config)
            assert snap.next == ("qa",) and snap.values["attempt"] == 1
            checkpoint = {
                "id": snap.config["configurable"]["checkpoint_id"],
                "next": list(snap.next),
                "pid": os.getpid(),
            }
            (work / "interrupted.json").write_text(
                json.dumps(checkpoint), encoding="utf-8"
            )
            os._exit(88)
        checkpoint = json.loads((work / "interrupted.json").read_text(encoding="utf-8"))
        assert snap.config["configurable"]["checkpoint_id"] == checkpoint["id"]
        assert list(snap.next) == checkpoint["next"]
        state = graph.invoke(None, config, durability="sync")
    calls = [
        json.loads(line)
        for line in (work / "model/model-calls.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert [row["reservation_id"] for row in calls[:4]] == [
        "chief",
        "director_assign",
        "tech_lead_design",
        "backend_implement",
    ]
    assert calls[4]["reservation_id"] == "qa_review"
    assert all(
        sum(row["reservation_id"] == role for row in calls) == 1
        for role in ("chief", "director_assign", "tech_lead_design")
    )
    assert (
        sum(row["reservation_id"] == "backend_implement" for row in calls)
        == state["attempt"]
    )
    patch = "".join(
        difflib.unified_diff(
            BASELINE.splitlines(keepends=True),
            (state["code"].rstrip() + "\n").splitlines(keepends=True),
            fromfile="a/webhook.cjs",
            tofile="b/webhook.cjs",
        )
    )
    (work / "webhook.patch").write_text(patch, encoding="utf-8")
    (work / "webhook.cjs").write_text(
        state.pop("code").rstrip() + "\n", encoding="utf-8"
    )
    evidence = {
        "checkpoint": checkpoint,
        "resumed_pid": os.getpid(),
        "baseline": json.loads((work / "baseline.json").read_text(encoding="utf-8")),
        "state": state,
        "calls": calls,
    }
    (work / "result.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    assert state["decision"]["action"] == "human_review" and state["tests"]["passed"]


if __name__ == "__main__":
    main()
