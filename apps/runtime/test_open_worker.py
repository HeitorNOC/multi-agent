"""Grafo do worker com checkpoint em memória e uma API falsa (sem PostgreSQL nem modelo).

Cobre o que o worker decide: trabalho sem etapas (especialistas, síntese, parecer) e trabalho em
etapas (N3: avança até o fim, síntese e parecer montados pela API), pausando na aprovação humana
e seguindo para o efeito quando o parecer exato é aprovado.

    .venv/Scripts/python.exe -m unittest test_open_worker      (Windows)
    .venv/bin/python -m unittest test_open_worker              (Linux/macOS)
"""

import asyncio
import unittest

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from open_worker import build, paused_for_approval


class FakeApi:
    def __init__(self, plan, advances=0):
        self.plan = plan
        self.advances_left = advances
        self.calls = []

    async def call(self, path, **payload):
        self.calls.append((path, payload))
        if path == "model" and payload["slot"] == "plan":
            return {"output": self.plan}
        if path == "plan":
            return {"plan": payload["plan"]}
        if path == "knowledge":
            return {"fragments": [{"label": "f-00000001", "source": "s1", "title": "Política", "version": 1}]}
        if path == "model" and payload["slot"].startswith("specialist:"):
            return {"output": {"findings": [{"claim": "Três cotações.", "citations": ["f-00000001"]}], "unknowns": []}}
        if path == "model" and payload["slot"] == "synthesis":
            return {"output": {"abstain": False, "summary": "Resumo.", "recommendation": "Aprovar.", "citations": ["f-00000001"]}}
        if path == "advance":
            self.advances_left -= 1
            return {"done": self.advances_left < 0}
        if path == "report":
            return {"report": {"kind": "steps", "summary": "Etapas entregues.", "recommendation": "Aprovar.", "steps": [], "escalations": [], "citations": []}}
        if path == "review":
            return {"review": {"hash": "h-1", "report": payload["report"]}}
        if path == "effect":
            return {"receipt": {"id": "r-1", "hash": payload["hash"]}}
        raise AssertionError(f"chamada inesperada: {path}")


async def run_until_approval(api):
    graph = build(api, False).compile(checkpointer=InMemorySaver())
    thread = {"configurable": {"thread_id": "t"}}
    await graph.ainvoke({}, thread)
    state = await graph.aget_state(thread)
    return graph, thread, state


class WorkerGraphTest(unittest.TestCase):
    def test_sem_etapas_especialistas_sintese_e_aprovacao(self):
        async def scenario():
            api = FakeApi({"agents": ["procurement_analyst"], "reason": "Compras.", "max_model_calls": 3})
            graph, thread, state = await run_until_approval(api)
            self.assertTrue(paused_for_approval(state))
            paths = [p for p, _ in api.calls]
            self.assertIn("knowledge", paths)
            self.assertNotIn("advance", paths)
            report = next(pl["report"] for p, pl in api.calls if p == "review")
            self.assertEqual(report["kind"], "open")
            await graph.ainvoke(Command(resume="h-1"), thread)
            self.assertEqual((await graph.aget_state(thread)).values["receipt"]["hash"], "h-1")

        asyncio.run(scenario())

    def test_com_etapas_avanca_ate_o_fim_e_o_parecer_vem_da_api(self):
        async def scenario():
            plan = {"agents": ["director_technology", "tech_lead"], "reason": "Plano aprovado.", "steps": [{"title": "A"}, {"title": "B"}], "max_model_calls": 13}
            api = FakeApi(plan, advances=3)
            graph, thread, state = await run_until_approval(api)
            self.assertTrue(paused_for_approval(state))
            paths = [p for p, _ in api.calls]
            self.assertEqual(paths.count("advance"), 4, "avança até a API dizer que acabou")
            self.assertNotIn("knowledge", paths, "em etapas, os trechos são buscados pela API")
            self.assertIn(("model", {"slot": "synthesis"}), api.calls)
            report = next(pl["report"] for p, pl in api.calls if p == "review")
            self.assertEqual(report["kind"], "steps")
            await graph.ainvoke(Command(resume="h-1"), thread)
            self.assertEqual((await graph.aget_state(thread)).values["receipt"]["id"], "r-1")

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
