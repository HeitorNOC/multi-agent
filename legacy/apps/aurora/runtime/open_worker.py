"""Worker do trabalho aberto: o LangGraph decide a ordem dos passos; o servidor decide o que vale.

Fluxo: plano (Chief of Staff) -> pesquisa (cada especialista lê o Cérebro e analisa) -> síntese
-> parecer -> aprovação humana (pausa) -> entrega.

- O estado do grafo é salvo em PostgreSQL depois de cada passo (thread ``open:<trabalho>``).
  Se o processo cair, o próximo worker continua do último passo concluído.
- Nenhum texto de conhecimento ou de modelo é montado aqui. O worker pede ao servidor trechos
  (``/internal/knowledge/retrieve``) e passos de modelo (``/internal/model``) enviando só rótulos;
  o servidor relê pedido, trechos e saídas anteriores do ledger e valida cada resposta.
- Cada passo de modelo tem recibo no ledger. Repetir um passo depois de uma queda devolve o
  recibo, sem nova chamada; uma chamada sem recibo é tratada como desconhecida pelo servidor.
"""

import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from typing import TypedDict

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

if sys.platform == "win32":
    # psycopg assíncrono não funciona com o loop Proactor padrão do Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

NO_EVIDENCE = "Nenhuma fonte vigente aberta a toda a empresa trata deste ponto no Cérebro."


class State(TypedDict, total=False):
    plan: dict
    evidence: dict
    findings: list
    unknowns: list
    synthesis: dict
    review: dict
    receipt: dict


class Api:
    """Chamadas à API interna do servidor, sempre com o trabalho e a concessão do executor."""

    def __init__(self, config):
        self.base = config["api"] + "/internal/"
        self.token = config["token"]
        self.identity = {"job": config["job"], "model_lease": config.get("model_lease")}

    def _post(self, path, payload):
        body = json.dumps({**payload, **self.identity}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.base + path, body, {"content-type": "application/json", "x-demo-token": self.token}
        )
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{path}: {error.code} {error.read().decode('utf-8')}") from error

    async def call(self, path, **payload):
        return await asyncio.to_thread(self._post, path, payload)


def build(api: Api, crash_after_effect: bool):
    async def plan(state: State):
        proposal = (await api.call("model", slot="plan"))["output"]
        return {"plan": await api.call("plan", plan=proposal)}

    async def research(state: State):
        evidence, findings, unknowns = {}, [], []
        for agent in state["plan"]["agents"]:
            fragments = (await api.call("knowledge/retrieve", agent=agent))["fragments"]
            evidence[agent] = fragments
            if not fragments:
                unknowns.append(f"{agent}: {NO_EVIDENCE}")
                continue
            labels = [f["label"] for f in fragments]
            output = (await api.call("model", slot=f"specialist:{agent}", labels=labels))["output"]
            findings += [{"agent": agent, **finding} for finding in output["findings"]]
            unknowns += [f"{agent}: {u}" for u in output["unknowns"]]
        return {"evidence": evidence, "findings": findings, "unknowns": unknowns}

    async def synthesis(state: State):
        if not state["findings"]:
            # Sem achados citados não há o que sintetizar: abstenção explícita, sem chamar o modelo.
            return {
                "synthesis": {
                    "abstain": True,
                    "summary": "Não encontrei no Cérebro evidência suficiente para analisar este pedido.",
                    "recommendation": "",
                    "citations": [],
                }
            }
        return {"synthesis": (await api.call("model", slot="synthesis"))["output"]}

    async def review(state: State):
        fragments = {f["label"]: f for group in state["evidence"].values() for f in group}
        cited = set(state["synthesis"]["citations"]) | {c for f in state["findings"] for c in f["citations"]}
        report = {
            "kind": "open",
            "abstained": state["synthesis"]["abstain"],
            "summary": state["synthesis"]["summary"],
            "recommendation": state["synthesis"]["recommendation"],
            "findings": state["findings"],
            "citations": [fragments[label] for label in sorted(cited) if label in fragments],
            "unknowns": state["unknowns"],
            "plan_reason": state["plan"]["reason"],
            "requires_approval": True,
        }
        return {"review": await api.call("review", report=report)}

    async def approval(state: State):
        # Pausa até um humano aprovar o parecer exato; o worker termina e o estado fica salvo.
        approved = interrupt({"hash": state["review"]["hash"]})
        if approved != state["review"]["hash"]:
            raise ValueError("aprovação não corresponde ao parecer")
        return {}

    async def effect(state: State):
        receipt = await api.call("effect", hash=state["review"]["hash"])
        if crash_after_effect:
            os._exit(88)  # usado em testes de recuperação: queda logo depois do efeito
        return {"receipt": receipt}

    graph = StateGraph(State)
    for name, node in [
        ("plan", plan),
        ("research", research),
        ("synthesis", synthesis),
        ("review", review),
        ("approval", approval),
        ("effect", effect),
    ]:
        graph.add_node(name, node)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "research")
    graph.add_edge("research", "synthesis")
    graph.add_edge("synthesis", "review")
    graph.add_edge("review", "approval")
    graph.add_edge("approval", "effect")
    graph.add_edge("effect", END)
    return graph


async def main(config):
    api = Api(config)
    async with AsyncPostgresSaver.from_conn_string(config["dsn"]) as saver:
        await saver.setup()
        graph = build(api, bool(config.get("crash_after_effect"))).compile(checkpointer=saver)
        thread = {"configurable": {"thread_id": "open:" + config["job"]}}
        state = await graph.aget_state(thread)
        if state.next and any(task.interrupts for task in state.tasks):
            job = await api.call("snapshot")
            if not job.get("approval"):
                print(json.dumps({"completed": False}), flush=True)
                return
            await graph.ainvoke(Command(resume=job["review"]["hash"]), thread)
        elif state.next:
            await graph.ainvoke(None, thread)  # retomada depois de uma queda
        elif not state.values:
            await graph.ainvoke({}, thread)
        final = await graph.aget_state(thread)
        print(json.dumps({"completed": bool(final.values.get("receipt")), "next": list(final.next)}), flush=True)


if __name__ == "__main__":
    asyncio.run(main(json.loads(sys.stdin.buffer.read().decode("utf-8"))))
