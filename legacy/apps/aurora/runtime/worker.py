"""Selected directors delegate to selected specialists in nested native LangGraph graphs."""

import asyncio
import difflib
import json
import operator
import os
import pathlib
import sys
import urllib.error
import urllib.request
from typing import Annotated, TypedDict

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, Send, interrupt

from apps.aurora.runtime.diagnostics import diagnostic
from apps.aurora.runtime.prompts import (
    director_prompt,
    plan_prompt,
    specialist_prompt,
    synthesis_prompt,
)
from apps.aurora.runtime.telemetry import Outbox, digest, reconcile_sources

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
FIXTURES = pathlib.Path(__file__).resolve().parents[3] / "demo-enterprise"
CATALOG = json.loads((FIXTURES / "catalog.json").read_text(encoding="utf-8"))
AGENTS = {a["id"]: a for a in CATALOG["agents"]}


class State(TypedDict, total=False):
    plan: dict
    department_reports: Annotated[list[dict], operator.add]
    review: dict
    receipt: dict


class Department(TypedDict, total=False):
    team: dict
    agent: str
    findings: Annotated[list[dict], operator.add]
    department_reports: Annotated[list[dict], operator.add]


def request(url, token, data):
    try:
        with urllib.request.urlopen(
            urllib.request.Request(
                url,
                json.dumps(data, ensure_ascii=False).encode(),
                {"content-type": "application/json", "x-demo-token": token},
            ),
            timeout=360,
        ) as res:
            return json.load(res)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error


async def main(c):
    worker = {"job": c["job"], "model_lease": c.get("model_lease")}
    pilot = c.get("pilot") is True
    engineering = next(
        (
            scenario["id"]
            for scenario in CATALOG["scenarios"]
            if not pilot
            and scenario["id"]
            in {
                "engineering_webhook",
                "engineering_webhook_team",
                "engineering_que_run",
            }
            and scenario["goal"] == c["goal"]
        ),
        None,
    )

    async def local(path, **extra):
        return await asyncio.to_thread(
            request, c["api"] + "/internal/" + path, c["token"], {**extra, **worker}
        )

    async def backend(action, **extra):
        return await asyncio.to_thread(
            request,
            c["backend"] + "/rpc",
            c["token"],
            {"action": action, **extra, **worker},
        )

    outbox = (
        Outbox(
            c["telemetry_path"],
            c["job"],
            lambda body: request(
                c["api"] + "/internal/event", c["token"], {**body, **worker}
            ),
        )
        if c.get("telemetry_path")
        else None
    )

    def span(name):
        return digest(
            {"job": c["job"], "run": outbox.run if outbox else None, "span": name}
        )[:16]

    async def log(node, **detail):
        capability = detail.get("capability")
        parent = AGENTS[capability]["parent"] if capability else None
        detail["telemetry"] = {
            "span_id": span("agent:" + capability if capability else node),
            "parent_span_id": span("agent:" + parent if parent else "chief"),
            **detail.get("telemetry", {}),
        }
        if outbox:
            await asyncio.to_thread(outbox.emit, node, detail)
        else:
            await local("event", node=node, detail=detail)

    async def llm(slot, prompt=None):
        artifact = (
            await asyncio.to_thread(
                outbox.artifact, "model_input", {"slot": slot, "prompt": prompt}
            )
            if outbox and not pilot
            else None
        )
        await log(
            "inference_requested",
            capability=slot[6:] if slot.startswith("agent:") else None,
            telemetry={"model_slot": slot, "input_artifact_id": artifact},
        )
        result = (
            await backend("llm", slot=slot)
            if pilot
            else await backend("llm", slot=slot, prompt=prompt)
        )
        value = json.loads(result["text"])
        output = (
            await asyncio.to_thread(outbox.artifact, "model_output", value)
            if outbox and not pilot
            else None
        )
        if outbox and not pilot:
            for fact in value.get("facts", []):
                await asyncio.to_thread(outbox.artifact, "fact", fact)
        await log(
            "inference_completed",
            capability=slot[6:] if slot.startswith("agent:") else None,
            telemetry={
                "model_slot": slot,
                "input_artifact_id": artifact,
                "output_artifact_id": output,
                "fact_ids": [digest(f) for f in value.get("facts", [])],
            },
        )
        return value

    async def sources(agent):
        rows = await backend("retrieve", agent=agent)
        if pilot:
            await log(
                "retrieval_completed",
                capability=agent,
                telemetry={
                    "evidence": [
                        {
                            "source_id": row["source"],
                            "source_version": row["version"],
                            "source_hash": row["sha256"],
                            "retrieved_fragment_id": row["passage_id"],
                        }
                        for row in rows
                    ]
                },
            )
            return rows
        if outbox:
            for row in rows:
                await asyncio.to_thread(
                    outbox.artifact, "retrieved_fragment", row["context"]
                )
        refs = [
            {
                "source_id": r["source"],
                "source_version": r["version"],
                "source_hash": r["sha256"],
                "projection_id": r.get("projection_id"),
                "retrieved_fragment_id": digest(r["context"]),
            }
            for r in rows
        ]
        artifact = (
            await asyncio.to_thread(outbox.artifact, "retrieved_context", rows)
            if outbox
            else None
        )
        await log(
            "retrieval_completed",
            capability=agent,
            telemetry={"evidence": refs, "output_artifact_id": artifact},
        )
        if c.get("evidence_contract"):
            published = (await backend("status"))["sources"]
            rows = reconcile_sources(rows, published)
            if outbox:
                for row in rows:
                    await asyncio.to_thread(
                        outbox.artifact, "canonical_fragment", row["canonical_text"]
                    )
            refs = [
                {**ref, "canonical_fragment_id": digest(row["canonical_text"])}
                for ref, row in zip(refs, rows)
            ]
            artifact = (
                await asyncio.to_thread(outbox.artifact, "canonical_evidence", rows)
                if outbox
                else None
            )
            await log(
                "canonical_evidence_verified",
                capability=agent,
                telemetry={"evidence": refs, "output_artifact_id": artifact},
            )
        return rows

    if outbox:
        await asyncio.to_thread(outbox.flush)

    async def cos(state):
        await log(
            "chief_of_staff",
            message=f"Escolhendo uma equipe a partir do catálogo completo de {len(AGENTS)} agentes.",
        )
        catalog = [
            {k: a[k] for k in ["id", "title", "kind", "domain", "parent", "focus"]}
            for a in CATALOG["agents"]
        ]
        prompt = None if pilot else plan_prompt(c["goal"], catalog)
        p = await llm("plan", prompt)
        return {"plan": await local("plan", plan=p)}

    def dispatch(state):
        return [Send("department", {"team": team}) for team in state["plan"]["teams"]]

    def specialists(state):
        return [
            Send("specialist", {"agent": a, "team": state["team"]})
            for a in state["team"]["specialists"]
        ]

    async def specialist(state):
        agent = state["agent"]
        meta = AGENTS[agent]
        await log("specialist_started", capability=agent, parent=meta["parent"])
        evidence = await sources(agent)
        value = await llm(
            "agent:" + agent,
            None if pilot else specialist_prompt(c["goal"], meta, evidence),
        )
        await log(
            "specialist_completed",
            capability=agent,
            parent=meta["parent"],
            sources=[x["source"] for x in evidence],
            output=value,
        )
        return {"findings": [{"agent": agent, "output": value}]}

    async def director(state):
        agent = state["team"]["lead"]
        meta = AGENTS[agent]
        await log(
            "director_started", capability=agent, children=state["team"]["specialists"]
        )
        evidence = await sources(agent)
        value = await llm(
            "agent:" + agent,
            None
            if pilot
            else director_prompt(c["goal"], meta, evidence, state["findings"]),
        )
        await log(
            "director_completed",
            capability=agent,
            children=state["team"]["specialists"],
            output=value,
        )
        return {
            "department_reports": [
                {
                    "lead": agent,
                    "specialists": state["team"]["specialists"],
                    "output": value,
                }
            ]
        }

    async def synthesize(state):
        await log("synthesis", departments=len(state["department_reports"]))
        if pilot:
            selection = await llm("synthesis")
            if selection["evidence_ids"] or c.get("directive_review"):
                await llm("citation_verification")
            return {"review": await local("review", report=selection)}
        scenario = next(s for s in CATALOG["scenarios"] if s["goal"] == c["goal"])
        keys = (
            "available_stock_units, combined_demand_units, shortfall_units, discount_margin_pct, minimum_margin_pct, cash_headroom_brl, requested_budget_brl, cash_gap_brl, inbound_confirmed, carbon_claim_supported"
            if scenario["id"] == "campaign"
            else "potential_records, confirmed_exfiltration, response_sla_minutes, minutes_elapsed, minutes_remaining"
        )
        value = await llm(
            "synthesis",
            synthesis_prompt(c["goal"], state["department_reports"], keys),
        )
        return {"review": await local("review", report=value)}

    async def approval(state):
        interrupt(
            {
                "hash": state["review"]["hash"],
                "payload": state["review"]["payload"],
                "approval_required": True,
            }
        )
        return {}

    async def effect(state):
        receipt = await local("effect", hash=state["review"]["hash"])
        if c.get("crash_after_effect"):
            os._exit(88)
        return {"receipt": receipt}

    sub = StateGraph(Department)
    sub.add_node("specialist", specialist)
    sub.add_node("director_review", director)
    sub.add_conditional_edges(START, specialists, ["specialist"])
    sub.add_edge("specialist", "director_review")
    sub.add_edge("director_review", END)
    async with AsyncPostgresSaver.from_conn_string(c["dsn"]) as saver:
        if c.get("durable_queue"):
            # The connection releases the lock even when the worker crashes.
            cursor = await saver.conn.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                ("aurora:" + c["job"],),
            )
            if not (await cursor.fetchone())["acquired"]:
                raise RuntimeError(
                    "Outro executor ainda possui o checkpoint deste trabalho"
                )
            # Different jobs may open the same empty checkpoint schema together.
            setup_key = "aurora:checkpoint-schema"
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 30
            while True:
                cursor = await saver.conn.execute(
                    "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                    (setup_key,),
                )
                if (await cursor.fetchone())["acquired"]:
                    break
                if loop.time() >= deadline:
                    raise RuntimeError(
                        "Prazo excedido aguardando o esquema de checkpoints"
                    )
                # A blocking SQL wait keeps a virtual transaction open while
                # CREATE INDEX CONCURRENTLY waits for that transaction to end.
                await asyncio.sleep(0.05)
            try:
                await saver.setup()
            finally:
                await saver.conn.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (setup_key,)
                )
        else:
            await saver.setup()
        if engineering:
            from apps.aurora.runtime.engineering import (
                BASELINE,
                GOAL,
                TEAM_SCENARIO,
                build_graph,
            )
            from apps.aurora.runtime.subdelegation import TEAM_MODEL_PREFIX
            from apps.aurora.runtime.engineering_que import (
                OBJECTIVE,
                REVISION,
                SPEC,
                QueExecutor,
            )

            que = (
                await asyncio.to_thread(QueExecutor, FIXTURES.parent, c["que_volume"])
                if engineering == "engineering_que_run"
                else None
            )

            team_run = engineering == TEAM_SCENARIO

            def ask(role, task, context=None):
                slot = role
                if role == "chief_subdelegation_review":
                    slot += ":" + context["requester"]
                elif role in {"specialist_subtask", "specialist_consolidate"}:
                    slot += ":" + context["assignment"]["agent"]
                prompt = json.dumps(
                    {
                        "objective": OBJECTIVE if que else GOAL,
                        "role": role,
                        "task": task,
                        "context": context,
                        **(
                            {"implementation": que.implementation}
                            if que
                            and role.startswith(
                                ("tech_lead_design", "backend_implement")
                            )
                            else {}
                        ),
                    },
                    ensure_ascii=False,
                )
                result = request(
                    c["backend"] + "/rpc",
                    c["token"],
                    {
                        **worker,
                        "action": "llm",
                        "slot": (TEAM_MODEL_PREFIX if team_run else "engineering:")
                        + slot,
                        "prompt": prompt,
                    },
                )
                value = json.loads(result["text"])
                if not isinstance(value, dict) or len(result["text"]) > 12_000:
                    raise ValueError("Resposta de engenharia inválida")
                return value

            def delegation_event(detail):
                node = "engineering_delegation"
                request(
                    c["api"] + "/internal/event",
                    c["token"],
                    {
                        **worker,
                        "node": node,
                        "detail": detail,
                        "event_id": digest([c["job"], node, detail]),
                    },
                )

            def instrument(name, action):
                async def run(state):
                    result = await asyncio.to_thread(action, state)
                    fields = {
                        "chief": "roster",
                        "assign": "assignments",
                        "qa": "tests",
                        "review": "technical_review",
                        "director": "decision",
                    }
                    if name in fields:
                        field = fields[name]
                        node = "engineering_" + name
                        detail = {
                            "attempt": state.get("attempt", 0),
                            field: result[field],
                        }
                        await local(
                            "event",
                            node=node,
                            detail=detail,
                            event_id=digest([c["job"], node, detail]),
                        )
                    return result

                return run

            async def engineering_report(state):
                if state["decision"]["action"] != "human_review":
                    raise ValueError("Entrega de engenharia exige retrabalho")
                patch = (
                    state["tests"]["diff"]
                    if que
                    else "".join(
                        difflib.unified_diff(
                            BASELINE.splitlines(keepends=True),
                            (state["code"].rstrip() + "\n").splitlines(keepends=True),
                            fromfile="a/webhook.cjs",
                            tofile="b/webhook.cjs",
                        )
                    )
                )
                report = {
                    key: state[key]
                    for key in (
                        "roster",
                        "assignments",
                        "tests",
                        "qa",
                        "technical_review",
                        "decision",
                        "review_history",
                    )
                }
                if que:
                    report["repository"] = {"name": "que", "revision": REVISION}
                if team_run:
                    report["delegation"] = state["subdelegation"]["decisions"]
                return {
                    "review": await local(
                        "review",
                        report={**report, "kind": "engineering", "diff": patch},
                    )
                }

            builder = build_graph(
                ask,
                instrument=instrument,
                finish="synthesis",
                allow_subdelegation=team_run,
                delegation_event=delegation_event,
                **(
                    {
                        "baseline": que.baseline,
                        "filename": SPEC.name,
                        "test_code": que.check,
                    }
                    if que
                    else {}
                ),
            )
            builder.add_node("synthesis", engineering_report)
        else:
            builder = StateGraph(State)
            builder.add_node("chief_of_staff", cos)
            builder.add_node("department", sub.compile())
            builder.add_node("synthesis", synthesize)
            builder.add_edge(START, "chief_of_staff")
            builder.add_conditional_edges("chief_of_staff", dispatch, ["department"])
            builder.add_edge("department", "synthesis")
        builder.add_node("approval", approval)
        builder.add_node("effect", effect)
        builder.add_edge("synthesis", "approval")
        builder.add_edge("approval", "effect")
        builder.add_edge("effect", END)
        graph = builder.compile(checkpointer=saver)
        cfg = {"configurable": {"thread_id": "aurora:" + c["job"]}}
        snap = await graph.aget_state(cfg)
        job = await local("snapshot")
        await log(
            "checkpoint_loaded",
            next=list(snap.next),
            process=os.getpid(),
            has_state=bool(snap.values),
            telemetry={
                "checkpoint_id": (snap.config or {})
                .get("configurable", {})
                .get("checkpoint_id")
            },
        )
        value = {} if not snap.values else None
        if any(t.interrupts for t in snap.tasks) and job["approval"]:
            value = Command(resume={"hash": job["review"]["hash"]})
        await graph.ainvoke(value, cfg, durability="sync")
        snap = await graph.aget_state(cfg)
        await log(
            "checkpoint_saved",
            next=list(snap.next),
            completed=bool(snap.values.get("receipt")),
            telemetry={
                "checkpoint_id": (snap.config or {})
                .get("configurable", {})
                .get("checkpoint_id")
            },
        )
        print(
            json.dumps(
                {"completed": bool(snap.values.get("receipt")), "next": list(snap.next)}
            ),
            flush=True,
        )


if __name__ == "__main__":
    # Node writes UTF-8 bytes. Windows' locale decoder can corrupt accented goals.
    config = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    try:
        asyncio.run(main(config))
    except BaseException as error:
        import traceback

        if config.get("pilot"):
            record = json.dumps(diagnostic(error, "worker", config))
            print(record, file=sys.stderr, flush=True)
            if config.get("telemetry_path"):
                path = pathlib.Path(config["telemetry_path"]).with_name(
                    "worker-diagnostics.jsonl"
                )
                with path.open("a", encoding="utf-8") as output:
                    output.write(record + "\n")
            raise SystemExit(1) from None
        with (FIXTURES / ".state/worker-errors.log").open(
            "a", encoding="utf-8"
        ) as output:
            traceback.print_exc(file=output)
        raise
