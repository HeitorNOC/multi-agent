"""Use native LangGraph primitives directly; external effect is an explicit fixture."""
import asyncio,json,os,sqlite3,sys,uuid
from typing import TypedDict
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.func import entrypoint,task
from langgraph.graph import StateGraph,START,END
from langgraph.types import Command,RetryPolicy,interrupt
from langgraph.errors import EmptyInputError

async def main(c):
    def count(name):
        with sqlite3.connect(c['store']) as db:
            db.execute('CREATE TABLE IF NOT EXISTS counts(name TEXT PRIMARY KEY,n INTEGER)')
            db.execute('INSERT INTO counts VALUES(?,1) ON CONFLICT(name) DO UPDATE SET n=n+1',(name,));db.commit()
            return db.execute('SELECT n FROM counts WHERE name=?',(name,)).fetchone()[0]
    cfg={'configurable':{'thread_id':c['thread']}}
    async with AsyncPostgresSaver.from_conn_string(c['dsn']) as saver:
        await saver.setup()
        if c['mode']=='task_interrupt':
            @task
            async def expensive():return {'count':count('expensive'),'value':uuid.uuid4().hex}
            @entrypoint(checkpointer=saver)
            async def workflow(value):
                result=await expensive()
                answer=interrupt({'result':result,'approval_required':True})
                return {'result':result,'answer':answer}
            value=await workflow.ainvoke(Command(resume={'approved':True}) if c.get('resume') else {'request':'fixture'},cfg,durability='sync')
            state=await workflow.aget_state(cfg)
            paused=[i.value for t in state.tasks for i in t.interrupts]
            print(json.dumps({'status':'paused' if paused else 'done','value':value,'interrupts':paused},default=str))
        elif c['mode']=='effect':
            # Official admission/outbox pattern: thread checkpoint may not exist
            # when a new process dies before the first recoverable checkpoint.
            with sqlite3.connect(c['store']) as db:
                db.execute('CREATE TABLE IF NOT EXISTS admissions(id TEXT PRIMARY KEY,input_json TEXT)')
                db.execute('INSERT OR IGNORE INTO admissions VALUES(?,?)',(c['thread'],json.dumps({'business_key':'stable-fixture-intent'})))
                db.commit();admitted=json.loads(db.execute('SELECT input_json FROM admissions WHERE id=?',(c['thread'],)).fetchone()[0])
            @task
            async def supplier(key):
                count('supplier_attempts')
                with sqlite3.connect(c['store']) as db:
                    db.execute('CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY,receipt TEXT)')
                    db.execute('INSERT OR IGNORE INTO effects VALUES(?,?)',(key,uuid.uuid4().hex));db.commit()
                    receipt=db.execute('SELECT receipt FROM effects WHERE id=?',(key,)).fetchone()[0]
                if c.get('crash'):os._exit(88)
                return {'key':key,'receipt':receipt}
            @entrypoint(checkpointer=saver)
            async def workflow(value):return await supplier(value['business_key'])
            recovery='native_resume'
            try:value=await workflow.ainvoke(None if c.get('resume') else admitted,cfg,durability='sync')
            except EmptyInputError:
                recovery='recreated_from_durable_admission'
                value=await workflow.ainvoke(admitted,cfg,durability='sync')
            print(json.dumps({'status':'done','value':value,'recovery':recovery}))
        else:
            class State(TypedDict,total=False):a:int;b:int;result:int
            builder=StateGraph(State)
            if c['mode']=='siblings':
                async def a(state):return {'a':count('a')}
                async def b(state):
                    attempt=count('b');await asyncio.sleep(.15)
                    if attempt==1:raise ValueError('controlled sibling failure')
                    return {'b':attempt}
                builder.add_node('a',a);builder.add_node('b',b)
                builder.add_edge(START,'a');builder.add_edge(START,'b')
                builder.add_node('join',lambda state:{'result':state['a']+state['b']})
                builder.add_edge(['a','b'],'join');builder.add_edge('join',END)
            else:
                async def transient(state):
                    attempt=count('transient')
                    if attempt<3:raise ConnectionError('controlled transient')
                    return {'result':attempt}
                builder.add_node('retry',transient,retry_policy=RetryPolicy(max_attempts=3,initial_interval=.01,max_interval=.01,jitter=False,retry_on=ConnectionError))
                builder.add_edge(START,'retry');builder.add_edge('retry',END)
            graph=builder.compile(checkpointer=saver)
            try:result=await graph.ainvoke(None if c.get('resume') else {},cfg,durability='sync')
            except ValueError as error:print(json.dumps({'status':'failed','error':str(error)}))
            else:print(json.dumps({'status':'done','value':result}))

if __name__=='__main__':
    if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(json.loads(sys.stdin.readline())))
