"""LangGraph owns staging and committing one exactly approved source release."""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import time
from typing import TypedDict
from urllib.request import Request,urlopen
from langgraph.graph import StateGraph,START,END
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

class State(TypedDict,total=False):
    projection:dict
    publication:dict

async def main(c):
    def stage():
        raw=json.dumps({'action':'stage','release':c['release'],'issued':time.time()}).encode()
        sig=hmac.new(bytes.fromhex(c['brain_key']),raw,hashlib.sha256).hexdigest()
        with urlopen(Request(c['brain_url']+'/rpc',raw,{'x-signature':sig,'content-type':'application/json'}),timeout=330) as r:return json.load(r)
    async def ingest(state):
        result=await asyncio.to_thread(stage)
        if c.get('crash_after_stage'):os._exit(79)
        return {'projection':result}
    async def commit(state):
        payload={'action':'brain_commit','id':c['release']['payload']['draft'],'projection_id':state['projection']['id']}
        raw=json.dumps(payload).encode()
        def request():
            with urlopen(Request(c['api']+'/rpc',raw,{'authorization':'Bearer '+c['worker_token'],'content-type':'application/json'}),timeout=60) as r:return json.load(r)
        return {'publication':await asyncio.to_thread(request)}
    async with AsyncPostgresSaver.from_conn_string(c['dsn']) as saver:
        await saver.setup();builder=StateGraph(State)
        builder.add_node('native-ingestion',ingest);builder.add_node('canonical-commit',commit)
        builder.add_edge(START,'native-ingestion');builder.add_edge('native-ingestion','canonical-commit');builder.add_edge('canonical-commit',END)
        graph=builder.compile(checkpointer=saver);config={'configurable':{'thread_id':c['installation']+':publication:'+c['release']['payload']['draft']}}
        before=await graph.aget_state(config)
        await graph.ainvoke({} if not before.values else None,config)
        snapshot=await graph.aget_state(config)
        print(json.dumps({'completed':bool(snapshot.values.get('publication')),'projection_id':snapshot.values['projection']['id']}))

if __name__=='__main__':
    if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(json.loads(sys.stdin.readline())))
