from threading import Barrier

import pytest

from apps.aurora.runtime.engineering import ORDER, TECH, build_graph
from apps.aurora.runtime.subdelegation import dispatch_subtasks


def task(id_, agent, *dependencies):
    return {
        "id": id_,
        "agent": agent,
        "task": "Analisar o contrato",
        "depends_on": list(dependencies),
    }


def test_engineering_graph_dispatches_only_approved_branches():
    barrier = Barrier(2, timeout=5)
    roster = [*ORDER, "platform_engineer"]
    reviews = []
    responses = {
        "chief": {"director": TECH, "roster": roster},
        "director_assign": {
            "assignments": [{"agent": agent, "task": agent} for agent in ORDER]
        },
        "tech_lead_design": {"design": "Contrato de webhooks"},
        "director_propose": {
            "requests": [
                task("Intake", "backend_engineer"),
                task("Persistence", "backend_engineer_2"),
            ]
        },
        "qa_review:1": {"verdict": "pass", "evidence": "Fixture"},
        "tech_lead_review:1": {"verdict": "pass", "evidence": "Fixture"},
        "director_review:1": {"action": "human_review", "reason": "Fixture"},
    }

    def ask(role, _, context):
        if role == "chief_subdelegation_review":
            parent = context["requester"]
            reviews.append(parent)
            return {
                "approved": {
                    TECH: ["Intake", "Persistence"],
                    "backend_engineer": ["A", "B"],
                    "backend_engineer_2": ["A"],
                }[parent]
            }
        if role == "specialist_subtask":
            key = context["assignment"]["id"]
            agent = context["assignment"]["agent"]
            assert reviews[0] == TECH
            assert agent != "backend_developer_d"
            if key in {"Intake", "Persistence"}:
                assert context["role"] == "Especialista Backend"
                barrier.wait()
                requests = (
                    [
                        task("A", "backend_developer_a"),
                        task("B", "backend_developer_b", "A"),
                    ]
                    if key == "Intake"
                    else [
                        task("A", "backend_developer_c"),
                        task("Denied", "backend_developer_d"),
                    ]
                )
                return {"result": agent, "requests": requests}
            assert context["role"] == "Desenvolvedor Backend"
            if agent in {"backend_developer_a", "backend_developer_b"}:
                assert reviews == [TECH, "backend_engineer"]
            if agent == "backend_developer_b":
                assert context["dependencies"]["A"]["agent"] == "backend_developer_a"
            if agent == "backend_developer_c":
                assert reviews == [TECH, "backend_engineer", "backend_engineer_2"]
            return {"result": agent, "requests": []}
        if role == "specialist_consolidate":
            agents = {row["agent"] for row in context["children"].values()}
            assert agents == (
                {"backend_developer_a", "backend_developer_b"}
                if context["assignment"]["id"] == "Intake"
                else {"backend_developer_c"}
            )
            return {"result": "Consolidado por " + context["assignment"]["agent"]}
        if role == "backend_implement:1":
            results = context["subdelegation"]["results"]
            assert set(results) == {"Intake", "Persistence"}
            assert results["Intake"]["result"] == "Consolidado por backend_engineer"
            assert (
                results["Persistence"]["result"] == "Consolidado por backend_engineer_2"
            )
            return {"code": "module.exports = {}"}
        return responses[role]

    state = (
        build_graph(ask, test_code=lambda _: {"passed": True}, allow_subdelegation=True)
        .compile()
        .invoke({})
    )
    assert state["decision"]["action"] == "human_review"
    assert [row["status"] for row in state["subdelegation"]["decisions"]] == [
        "requested",
        "reviewed",
        "requested",
        "reviewed",
        "requested",
        "reviewed",
    ]


@pytest.mark.parametrize(
    ("requests", "approved", "error"),
    [
        ([task("A", "qa", "B"), task("B", "qa", "A")], ["A", "B"], "cíclica"),
        ([task("A", "qa"), task("B", "qa", "A")], ["B"], "Aprovação incompatível"),
    ],
)
def test_invalid_plan_never_dispatches(requests, approved, error):
    with pytest.raises(ValueError, match=error):
        dispatch_subtasks(
            "backend",
            requests,
            {"qa"},
            lambda *_: approved,
            lambda *_: pytest.fail("Despacho indevido"),
            lambda *_: None,
        )


def test_same_developer_cannot_be_assigned_to_both_branches():
    executed = []

    def execute(item, _):
        executed.append(item["agent"])
        return {
            "result": "ok",
            "requests": [task("Work", "developer")]
            if item["agent"] != "developer"
            else [],
        }

    with pytest.raises(ValueError, match="outro responsável"):
        dispatch_subtasks(
            TECH,
            [task("A", "backend1"), task("B", "backend2")],
            {"backend1", "backend2", "developer"},
            lambda _parent, tasks, *_limits: [item["id"] for item in tasks],
            execute,
            lambda *_: None,
        )
    assert executed.count("developer") == 1
