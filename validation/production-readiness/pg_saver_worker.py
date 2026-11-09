import asyncio
import json
import sys
from typing import TypedDict
import psycopg
from langgraph.graph import StateGraph,START,END
from langgraph.types import Command,interrupt
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


async def main(p):
    print('worker_start',file=sys.stderr,flush=True)
    class State(TypedDict,total=False):
        evidence:str
        completed:bool
    async def evidence(s):
        async with await psycopg.AsyncConnection.connect(p['dsn'],autocommit=True) as db:
            await db.execute('INSERT INTO node_calls VALUES(%s,%s)',(p['run'],'evidence'))
        return {'evidence':'synthetic source version 1'}
    async def approval(s):
        interrupt({'operation':'fixture-review','source':s['evidence']})
        return {'completed':True}
    print('saver_connect',file=sys.stderr,flush=True)
    async with AsyncPostgresSaver.from_conn_string(p['dsn']) as saver:
        print('saver_connected_setup',file=sys.stderr,flush=True)
        await saver.setup()
        print('saver_setup_done',file=sys.stderr,flush=True)
        builder=StateGraph(State);builder.add_node('evidence',evidence);builder.add_node('approval',approval)
        builder.add_edge(START,'evidence');builder.add_edge('evidence','approval');builder.add_edge('approval',END)
        graph=builder.compile(checkpointer=saver);config={'configurable':{'thread_id':p['run']}}
        print('graph_invoke',file=sys.stderr,flush=True)
        result=await graph.ainvoke(Command(resume={'synthetic_review':True}) if p['resume'] else {},config)
        state=await graph.aget_state(config)
        print(json.dumps({'next':list(state.next),'values':state.values,'interrupted':bool(result.get('__interrupt__'))}))


if __name__=='__main__':
    if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(json.loads(sys.stdin.readline())))
