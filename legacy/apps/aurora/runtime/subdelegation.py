"""Dispatch bounded specialist requests after explicit Chief approval."""

from concurrent.futures import ThreadPoolExecutor

MAX_TASKS = 6
MAX_DEPTH = 2
TEAM_MODEL_PREFIX = "engineering-team:"
TEAM_MODEL_LIMIT = 23  # 11 base, 1 proposal, 3 approvals, 6 tasks, 2 consolidations
TECH = "technology_director"
LAB_BACKENDS = {
    "backend_engineer": "Especialista Backend",
    "backend_engineer_2": "Especialista Backend",
}
LAB_DEVELOPERS = {
    "backend_developer_a": "Desenvolvedor Backend",
    "backend_developer_b": "Desenvolvedor Backend",
    "backend_developer_c": "Desenvolvedor Backend",
    "backend_developer_d": "Desenvolvedor Backend",
}


def dispatch_subtasks(
    requester,
    requests,
    roster,
    approve,
    execute,
    audit,
    *,
    consolidate=None,
    progress=lambda _parent, _task, _status: None,
):
    remaining = MAX_TASKS
    owners = {}

    def visit(parent, proposed, depth, ancestors):
        nonlocal remaining
        if not isinstance(proposed, list) or len(proposed) > MAX_TASKS:
            raise ValueError("Lista de subdelegação inválida")
        if not proposed:
            return {}
        if depth > MAX_DEPTH or remaining == 0:
            audit(parent, {"status": "limit_reached", "depth": depth})
            return {}

        tasks = {}
        for task in proposed:
            if not isinstance(task, dict) or set(task) != {
                "id",
                "agent",
                "task",
                "depends_on",
            }:
                raise ValueError("Contrato de subtarefa inválido")
            task_id, agent, description, dependencies = (
                task[key] for key in ("id", "agent", "task", "depends_on")
            )
            if (
                not isinstance(task_id, str)
                or not task_id.isascii()
                or not task_id.isalnum()
                or len(task_id) > 24
                or task_id in tasks
                or not isinstance(agent, str)
                or agent not in roster
                or agent in ancestors
                or not isinstance(description, str)
                or not 1 <= len(description.strip()) <= 500
                or not isinstance(dependencies, list)
                or any(not isinstance(key, str) for key in dependencies)
                or len(set(dependencies)) != len(dependencies)
            ):
                raise ValueError("Subtarefa fora do escopo autorizado")
            tasks[task_id] = task

        ordered = set()
        while len(ordered) < len(tasks):
            ready = {
                key
                for key, task in tasks.items()
                if key not in ordered and set(task["depends_on"]) <= ordered
            }
            if not ready:
                raise ValueError("Dependência cíclica ou inexistente")
            ordered.update(ready)

        assignees = {key: task["agent"] for key, task in tasks.items()}
        audit(
            parent,
            {
                "status": "requested",
                "depth": depth,
                "proposed": list(tasks),
                "assignees": assignees,
            },
        )
        approved = approve(parent, proposed, depth, remaining)
        if (
            not isinstance(approved, list)
            or any(not isinstance(key, str) or key not in tasks for key in approved)
            or len(set(approved)) != len(approved)
            or len(approved) > remaining
            or any(
                not set(tasks[key]["depends_on"]) <= set(approved) for key in approved
            )
        ):
            raise ValueError("Aprovação incompatível com o plano ou orçamento")
        remaining -= len(approved)
        for key in approved:
            agent = tasks[key]["agent"]
            if owners.setdefault(agent, parent) != parent:
                raise ValueError("Agente já vinculado a outro responsável")
        audit(
            parent,
            {
                "status": "reviewed",
                "depth": depth,
                "proposed": list(tasks),
                "approved": approved,
                "assignees": assignees,
            },
        )

        done = {}

        def run(task, dependencies):
            progress(parent, task, "started")
            return execute(task, dependencies)

        while len(done) < len(approved):
            ready = [
                key
                for key in approved
                if key not in done
                and all(dep in done for dep in tasks[key]["depends_on"])
            ]
            with ThreadPoolExecutor(max_workers=min(3, len(ready))) as pool:
                wave = {
                    key: pool.submit(
                        run,
                        tasks[key],
                        {dep: done[dep] for dep in tasks[key]["depends_on"]},
                    )
                    for key in ready
                }
                responses = {key: future.result() for key, future in wave.items()}
            for key, response in responses.items():
                task = tasks[key]
                agent = task["agent"]
                children = visit(
                    agent, response.get("requests", []), depth + 1, (*ancestors, agent)
                )
                result = response["result"]
                if children and consolidate is not None:
                    result = consolidate(task, result, children)
                done[key] = {"agent": agent, "result": result, "children": children}
                progress(parent, task, "completed")
        return done

    return visit(requester, requests, 1, (requester,))
