"""LangGraph owns dispatch, interrupts and PostgreSQL checkpoints. No LLM calls."""
import asyncio
import json
import operator
import os
import sys
import uuid
from typing import Annotated, TypedDict
from urllib.request import Request, urlopen

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, Send, interrupt


class State(TypedDict, total=False):
    plan: dict
    plan_hash: str
    capability: str
    evidence: Annotated[list[dict], operator.add]
    approved: bool
    effect: dict
    result: dict


async def main(config):
    worker_id = uuid.uuid4().hex
    def request(action, **payload):
        data = json.dumps({'action': action, 'job': config['job'], **payload}).encode()
        req = Request(config['api']+'/rpc', data, {'content-type':'application/json', 'authorization':'Bearer '+config['token']})
        with urlopen(req, timeout=config.get('request_timeout',12)) as response:
            return json.load(response)
    claim = await asyncio.to_thread(request, 'claim', worker=worker_id)
    heartbeat_count=0
    async def call(action, **payload):
        return await asyncio.to_thread(request, action, worker=worker_id, epoch=claim['epoch'], **payload)
    async def heartbeat():
        nonlocal heartbeat_count
        while True:
            await asyncio.sleep(config['heartbeat_ms']/1000)
            await call('renew',request_id=uuid.uuid4().hex)
            heartbeat_count+=1
    async def plan(state):
        return {'plan':claim['plan'], 'plan_hash':claim['hash']}
    def dispatch(state):
        return [Send('specialist', {'capability':cap}) for cap in state['plan']['capabilities']]
    async def specialist(state):
        snapshot = await call('read', capability=state['capability'])
        return {'evidence':[{'capability':state['capability'],'snapshot':snapshot}]}
    async def approval(state):
        # A resume payload is a scheduling signal, never an authorization grant.
        interrupt({'job':config['job'],'hash':state['plan_hash'],'plan':state['plan']})
        verified = await call('approval')
        return {'approved':verified['approved']}
    async def effect(state):
        value = await call('effect')
        if config.get('crash_after_effect'):
            os._exit(73)  # crash before LangGraph persists this node's result
        return {'effect':value}
    async def finish(state):
        return {'result':await call('finish')}
    def next_after_specialists(state):
        return 'approval' if state['plan']['execute'] else 'finish'
    builder = StateGraph(State)
    for name, fn in [('plan',plan),('specialist',specialist),('approval',approval),('effect',effect),('finish',finish)]:
        builder.add_node(name,fn)
    builder.add_edge(START,'plan')
    builder.add_conditional_edges('plan',dispatch,['specialist'])
    builder.add_conditional_edges('specialist',next_after_specialists,['approval','finish'])
    builder.add_edge('approval','effect'); builder.add_edge('effect','finish'); builder.add_edge('finish',END)
    async with AsyncPostgresSaver.from_conn_string(config['dsn']) as saver:
        await saver.setup()
        graph = builder.compile(checkpointer=saver)
        graph_config = {'configurable':{'thread_id':config['installation']+':'+config['job']}}
        previous = await graph.aget_state(graph_config)
        value = {} if not previous.values else None
        if config.get('resume') and any(getattr(t,'interrupts',()) for t in previous.tasks):
            value = Command(resume={'untrusted_resume_signal':True})
        if config.get('heartbeat_ms'):
            invocation=asyncio.create_task(graph.ainvoke(value,graph_config))
            renewal=asyncio.create_task(heartbeat())
            try:
                done,_=await asyncio.wait({invocation,renewal},return_when=asyncio.FIRST_COMPLETED)
                if renewal in done:
                    invocation.cancel();await asyncio.gather(invocation,return_exceptions=True)
                    renewal.result()  # a failed renewal stops workflow progression
                await invocation
            finally:
                renewal.cancel();await asyncio.gather(renewal,return_exceptions=True)
        else:await graph.ainvoke(value,graph_config)
        current = await graph.aget_state(graph_config)
        await call('release')
        print(json.dumps({'completed':bool(current.values.get('result')), 'next':list(current.next),
                          'evidence_count':len(current.values.get('evidence',[])), 'epoch':claim['epoch'],'heartbeat_count':heartbeat_count}))


if __name__ == '__main__':
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(json.loads(sys.stdin.readline())))
