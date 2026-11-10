"""Validate a direct worker call against the current Aurora job."""


def call_model(lab, job, slot, prompt, agents, *, pilot=False):
    if job["status"] != "running" or not job["worker_active"]:
        raise ValueError("Worker do trabalho não está ativo")
    plan = job["plan"]
    allowed = (
        ("plan", "synthesis", "citation_verification")
        if pilot
        else ("plan", "synthesis")
    )
    if slot != "plan" and not plan:
        raise ValueError("Plano ausente")
    if slot.startswith("agent:"):
        agent = slot[6:]
        if agent not in agents or not plan or agent not in plan["capabilities"]:
            raise ValueError("Agente não selecionado pelo Chief of Staff")
    elif slot not in allowed:
        raise ValueError("Slot fora do catálogo")
    limit = plan["max_model_calls"] if plan else 1
    if pilot and slot != "citation_verification":
        limit = min(limit, 10)
    return lab.native(
        "model_slot_run", job=job["id"], slot=slot, prompt=prompt, limit=limit
    )
