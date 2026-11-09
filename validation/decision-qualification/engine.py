import asyncio,json,sys
from typing import TypedDict
from langgraph.graph import StateGraph,START,END
from langgraph.types import Command,interrupt
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from protocol import call


async def main(c):
    id=c['run'];status=await call(c,'/runs/'+id+'/begin',{})
    if status['state']=='completed':print(json.dumps({'completed':True,'own_result_replay':True}));return
    class State(TypedDict,total=False):
        sales:dict
        campaign:dict
        plan:str
        result:dict
    async def sales(s):return {'sales':await call(c,'/runs/'+id+'/read',{'node':'sales','query':'ACME por que as vendas caíram em fevereiro?'})}
    async def campaign(s):return {'campaign':await call(c,'/runs/'+id+'/read',{'node':'campaign','query':'ACME campanha pausada; evidências e fontes'})}
    async def approval(s):
        plan=await call(c,'/runs/'+id+'/plan',{})
        interrupt({'plan':plan['plan'],'operation':'synthetic-email-v1'})
        return {'plan':plan['plan']}
    async def effect(s):return {'result':await call(c,'/runs/'+id+'/effect',{})}
    async with AsyncPostgresSaver.from_conn_string(c['dsn']) as saver:
        await saver.setup();builder=StateGraph(State)
        for name,fn in [('sales-analysis',sales),('campaign-analysis',campaign),('approval',approval),('effect',effect)]:builder.add_node(name,fn)
        for a,b in [(START,'sales-analysis'),('sales-analysis','campaign-analysis'),('campaign-analysis','approval'),('approval','effect'),('effect',END)]:builder.add_edge(a,b)
        graph=builder.compile(checkpointer=saver);config={'configurable':{'thread_id':c['installation']+':'+id}}
        snapshot=await graph.aget_state(config)
        value={} if not snapshot.values else None
        if c['resume'] and any(getattr(t,'interrupts',()) for t in snapshot.tasks):value=Command(resume={'host_requested_resume':True})
        await graph.ainvoke(value,config)
        snapshot=await graph.aget_state(config)
        print(json.dumps({'next':list(snapshot.next),'completed':bool(snapshot.values.get('result'))}))


if __name__=='__main__':
    if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(json.loads(sys.stdin.readline())))
