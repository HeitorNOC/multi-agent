"""Bounded webhook engineering workflow shared by the Aurora worker and lab."""

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from apps.aurora.runtime.subdelegation import (
    LAB_BACKENDS,
    LAB_DEVELOPERS,
    TECH as TECH,
    dispatch_subtasks,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).with_name("engineering_fixtures")
SCENARIO = "engineering_webhook"
TEAM_SCENARIO = "engineering_webhook_team"
SLOTS = {
    "chief",
    "director_assign",
    "tech_lead_design",
    "backend_implement",
    "qa_review",
    "tech_lead_review",
    "director_review",
}
MAX_CALLS = 11

BASELINE = (FIXTURES / "webhook-baseline.cjs").read_text(encoding="utf-8")
GOAL = (
    "Implemente ingestão idempotente de webhooks num módulo CommonJS para Node 24. "
    "O adaptador HTTP já existe. Exporte initialize(db) e ingest(db, {tenantId,eventId,payload}), "
    "síncronas, com db de node:sqlite. Todos os campos são strings validadas pelo adaptador. "
    "A tabela effects deve expor tenant_id, event_id e payload. A primeira entrega retorna "
    "accepted. A repetição do mesmo evento e payload retorna duplicate sem novo efeito. "
    "A mesma chave com payload diferente retorna conflict sem sobrescrever o original. "
    "A chave inclui o tenant. O efeito precisa ser persistente e uma falha de escrita deve "
    "permitir nova tentativa. Sem serviços ou dependências externas. Banco novo de laboratório."
)
REQUIRED = {"tech_lead", "backend_engineer", "qa_engineer"}
ROLES = REQUIRED | {"frontend_engineer", "platform_engineer"}
ORDER = ("tech_lead", "backend_engineer", "qa_engineer")
TEAM_SLOTS = {
    "director_propose",
    *(f"chief_subdelegation_review:{agent}" for agent in (TECH, *LAB_BACKENDS)),
    *(f"specialist_subtask:{agent}" for agent in (*LAB_BACKENDS, *LAB_DEVELOPERS)),
    *(f"specialist_consolidate:{agent}" for agent in LAB_BACKENDS),
}


class State(TypedDict, total=False):
    roster: list[str]
    assignments: list[dict]
    design: str
    code: str
    attempt: int
    tests: dict
    qa: dict
    technical_review: dict
    decision: dict
    review_history: list[dict]
    review: dict
    receipt: dict
    subdelegation: dict


def run_tests(source, directory=None):
    """Run candidate code in a disposable container with a read-only input mount."""
    name = "aurora-webhook-" + uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix="executor-", dir=directory) as temp:
        inputs = Path(temp)
        (inputs / "webhook.cjs").write_text(source, encoding="utf-8")
        shutil.copyfile(FIXTURES / "webhook-acceptance.cjs", inputs / "acceptance.cjs")
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            name,
            "--pull=never",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit=64",
            "--memory=192m",
            "--cpus=1",
            "--user=65534:65534",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=16m",
            "--mount",
            f"type=bind,source={inputs},target=/input,readonly",
            "--entrypoint",
            "node",
            "adaptive-webchat-executor:local",
            "--test",
            "--test-reporter=tap",
            "/input/acceptance.cjs",
        ]
        try:
            run = subprocess.run(
                command, capture_output=True, text=True, encoding="utf-8", timeout=25
            )
        except subprocess.TimeoutExpired:
            subprocess.run(
                ["docker", "rm", "-f", name], capture_output=True, timeout=15
            )
            raise
    checks = ("duplicate", "conflict", "tenant", "reopen", "rollback")
    return {
        "exit_code": run.returncode,
        "passed": run.returncode == 0
        and "# pass 1" in run.stdout
        and all(f"CHECK {check}:" in run.stdout for check in checks),
        "log": re.sub(
            r"^\s*(?:# )?duration_ms:.*\n",
            "",
            run.stdout + run.stderr,
            flags=re.MULTILINE,
        )[-6000:],
    }


def validate_assignments(rows, roster):
    if any(row["agent"] not in roster for row in rows):
        raise ValueError("Diretora tentou delegar fora do grupo autorizado")
    if (
        tuple(row["agent"] for row in rows) != ORDER
        or len({row["task"].strip() for row in rows if row["task"].strip()}) != 3
    ):
        raise ValueError("Atribuições incompatíveis com as dependências do ensaio")
    return rows


def build_graph(
    ask,
    *,
    test_code=run_tests,
    instrument=lambda _name, action: action,
    finish=END,
    baseline=BASELINE,
    filename="webhook.cjs",
    allow_subdelegation=False,
    delegation_event=lambda _detail: None,
):
    catalog = json.loads(
        (ROOT / "demo-enterprise/catalog.json").read_text(encoding="utf-8")
    )
    team = {
        item["id"]: item["focus"]
        for item in catalog["agents"]
        if item["parent"] == TECH
    }
    assert ROLES <= team.keys()

    def chief(_state):
        result = ask(
            "chief",
            'Escolha o diretor e um grupo de quatro especialistas disponíveis. Use {"director":"id","roster":["id",...]}. Autorize liderança técnica, backend e QA, mais um papel de reserva que pode ficar sem tarefa.',
            {"director": TECH, "roles": {id_: team[id_] for id_ in sorted(ROLES)}},
        )
        roster = result["roster"]
        if (
            result["director"] != TECH
            or len(roster) != 4
            or not REQUIRED <= set(roster) <= ROLES
        ):
            raise ValueError("Grupo de engenharia inválido")
        return {"roster": roster}

    def assign(state):
        result = ask(
            "director_assign",
            'Escolha no grupo autorizado somente quem precisa atuar. Proponha subtarefas e ordem em {"assignments":[{"agent":"id","task":"descrição"}]}. Neste recorte a definição técnica precede a implementação, que precede QA. O papel de reserva fica disponível.',
            {id_: team[id_] for id_ in state["roster"]},
        )
        return {
            "assignments": validate_assignments(result["assignments"], state["roster"])
        }

    def design(state):
        result = ask(
            "tech_lead_design",
            state["assignments"][0]["task"]
            + ' Retorne {"design":"decisões e critérios"}.',
            baseline,
        )
        return {"design": result["design"]}

    def implement(state):
        attempt = state.get("attempt", 0) + 1
        result = ask(
            f"backend_implement:{attempt}",
            state["assignments"][1]["task"]
            + f' Retorne {{"code":"conteúdo completo de {filename}"}}.',
            {
                "design": state["design"],
                "previous_code": state.get("code", baseline),
                "revision": state.get("decision"),
                "tests": state.get("tests"),
                **(
                    {"subdelegation": state["subdelegation"]}
                    if "subdelegation" in state
                    else {}
                ),
            },
        )
        code = result["code"]
        if not isinstance(code, str) or not code.strip() or code == baseline:
            raise ValueError("Implementação ausente")
        return {"code": code, "attempt": attempt}

    def subdelegate(state):
        decisions = []

        def audit(parent, entry):
            detail = {"requester": parent, **entry}
            decisions.append(detail)
            delegation_event(detail)

        def progress(parent, task, status):
            delegation_event(
                {
                    "requester": parent,
                    "capability": task["agent"],
                    "task": task["id"],
                    "status": status,
                }
            )

        contract = (
            ' Cada proposta usa {"id":"curto","agent":"id autorizado","task":"análise",'
            '"depends_on":["id de outra proposta"]}. Use requests=[] quando dispensável. '
            "Somente análise sem ferramentas ou efeitos externos."
        )
        agents = {**LAB_BACKENDS, **LAB_DEVELOPERS}
        context = {
            "goal": state["assignments"][1]["task"],
            "design": state["design"],
        }
        request = ask(
            "director_propose",
            "Como Diretor de Tecnologia, proponha especialistas Backend para frentes distintas "
            'somente quando necessário. Retorne {"requests":[]}. ' + contract,
            {**context, "available_agents": LAB_BACKENDS},
        )

        def approve(parent, proposed, depth, remaining):
            available = LAB_BACKENDS if parent == TECH else LAB_DEVELOPERS
            identities = {task["agent"] for task in proposed}
            if len(identities) != len(proposed) or not identities <= available.keys():
                raise ValueError("Composição da equipe delegada inválida")
            return ask(
                "chief_subdelegation_review",
                'Decida quais subtarefas são necessárias. Retorne {"approved":["id"]}, '
                "com dependências aprovadas e dentro do orçamento. Use [] para rejeitar todas.",
                {
                    **context,
                    "requester": parent,
                    "requests": proposed,
                    "available_agents": available,
                    "depth": depth,
                    "remaining": remaining,
                },
            )["approved"]

        def execute(task, dependencies):
            agent = task["agent"]
            available = LAB_DEVELOPERS if agent in LAB_BACKENDS else {}
            result = ask(
                "specialist_subtask",
                "Execute a análise delegada. Proponha ajuda somente entre os agentes "
                'disponíveis. Retorne {"result":"...","requests":[]}. ' + contract,
                {
                    **context,
                    "assignment": task,
                    "role": agents[agent],
                    "dependencies": dependencies,
                    "available_agents": available,
                },
            )
            if (
                not isinstance(result.get("result"), str)
                or not result["result"].strip()
            ):
                raise ValueError("Resultado de subtarefa inválido")
            return result

        def consolidate(task, initial, children):
            result = ask(
                "specialist_consolidate",
                'Consolide apenas os resultados dos seus subordinados. Retorne {"result":"..."}.',
                {"assignment": task, "initial_result": initial, "children": children},
            )["result"]
            if not isinstance(result, str) or not result.strip():
                raise ValueError("Consolidação de subtarefas inválida")
            return result

        results = dispatch_subtasks(
            TECH,
            request["requests"],
            agents.keys(),
            approve,
            execute,
            audit,
            consolidate=consolidate,
            progress=progress,
        )
        return {
            "subdelegation": {
                "roles": agents,
                "decisions": decisions,
                "results": results,
            }
        }

    def qa(state):
        tests = test_code(state["code"])
        result = ask(
            f"qa_review:{state['attempt']}",
            state["assignments"][2]["task"]
            + ' Interprete o resultado real e responda {"verdict":"pass ou fail","evidence":"avaliação"}.',
            tests,
        )
        if result["verdict"] not in {"pass", "fail"}:
            raise ValueError("Parecer de QA inválido")
        return {"tests": tests, "qa": result}

    def review(state):
        result = ask(
            f"tech_lead_review:{state['attempt']}",
            'Revise o código contra a tarefa. Responda {"verdict":"pass ou fail","evidence":"achados"}.',
            {"code": state["code"], "tests": state["tests"], "design": state["design"]},
        )
        if result["verdict"] not in {"pass", "fail"}:
            raise ValueError("Parecer técnico inválido")
        return {"technical_review": result}

    def director(state):
        ready = (
            state["tests"]["passed"]
            and state["qa"]["verdict"] == state["technical_review"]["verdict"] == "pass"
        )
        result = ask(
            f"director_review:{state['attempt']}",
            'Decida entre encaminhar à revisão humana e devolver a Backend. Use {"action":"human_review ou rework","reason":"justificativa ou correção solicitada"}. Só encaminhe se todos os testes e pareceres passarem.',
            {
                "ready": ready,
                "attempt": state["attempt"],
                "qa": state["qa"],
                "technical_review": state["technical_review"],
            },
        )
        if (
            not isinstance(result.get("reason"), str)
            or result["action"] not in {"human_review", "rework"}
            or (result["action"] == "human_review" and not ready)
        ):
            raise ValueError("Diretora tentou encaminhar uma entrega reprovada")
        return {
            "decision": result,
            "review_history": [
                *state.get("review_history", []),
                {"attempt": state["attempt"], "passed": ready, "decision": result},
            ],
        }

    graph = StateGraph(State)
    for node, action in (
        ("chief", chief),
        ("assign", assign),
        ("design", design),
        ("implement", implement),
        ("qa", qa),
        ("review", review),
        ("director", director),
    ):
        graph.add_node(node, instrument(node, action))
    graph.add_edge(START, "chief")
    stages = ["chief", "assign", "design", "implement", "qa", "review", "director"]
    if allow_subdelegation:
        graph.add_node("subdelegate", instrument("subdelegate", subdelegate))
        stages.insert(stages.index("implement"), "subdelegate")
    for source, target in zip(stages, stages[1:]):
        graph.add_edge(source, target)
    graph.add_conditional_edges(
        "director",
        lambda state: "implement"
        if state["decision"]["action"] == "rework" and state["attempt"] < 2
        else finish,
        ["implement", finish],
    )
    return graph
