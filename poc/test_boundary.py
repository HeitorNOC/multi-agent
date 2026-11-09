import asyncio, hashlib, hmac, json, sqlite3, time
from concurrent.futures import ThreadPoolExecutor
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from runtime import Ledger, Knowledge, make_graph, verify

def principal(run="r1",company="A",**kw): return {"companyId":company,"runId":run,"taskId":"task1","scopes":["knowledge:read","email:send"],"approved":True,**kw}

def test_duplicate_concurrent_restart_and_effect_after_timeout(tmp_path):
    path=tmp_path/"ledger.db"; p=principal(); ledger=Ledger(path)
    with ThreadPoolExecutor(max_workers=8) as pool: assert sum(pool.map(lambda _:Ledger(path).admit(p),range(8)))==1
    ledger.effect(p) # simulated provider committed, reply lost
    Ledger(path).effect(p) # retry in another connection/worker
    assert Ledger(path).count()==1
    with pytest.raises(ValueError): ledger.admit({**p,"taskId":"different"})

def test_signed_context_tamper_expiry(tmp_path):
    key=b"fixture-key-only"; p=principal(issuedAt=time.time()); raw=json.dumps(p).encode()
    sig=hmac.new(key,raw,hashlib.sha256).hexdigest(); assert verify(raw,sig,key)["companyId"]=="A"
    with pytest.raises(PermissionError): verify(raw.replace(b'"A"',b'"B"'),sig,key)
    old=json.dumps(principal(issuedAt=time.time()-120)).encode()
    with pytest.raises(PermissionError): verify(old,hmac.new(key,old,hashlib.sha256).hexdigest(),key)

def test_cancel_out_of_order_and_tool_denial(tmp_path):
    ledger=Ledger(tmp_path/"ledger.db"); p=principal(); ledger.admit(p)
    assert ledger.transition(p,"running",2)==1
    assert ledger.transition(p,"accepted",1)==0
    assert ledger.transition(p,"cancelled",3)==1
    assert ledger.transition(p,"completed",4)==0
    with pytest.raises(PermissionError): ledger.effect(p)
    p2=principal("r2",approved=False); ledger.admit(p2)
    with pytest.raises(PermissionError): ledger.effect(p2)
    p3=principal("r3",scopes=["knowledge:read"]); ledger.admit(p3)
    with pytest.raises(PermissionError): ledger.effect(p3)
    assert ledger.count()==0

def test_concurrent_budget_reservation(tmp_path):
    path=tmp_path/"ledger.db"; Ledger(path)
    def admit(i):
        try: return Ledger(path).admit(principal(str(i)),budget=9)
        except PermissionError: return False
    with ThreadPoolExecutor(max_workers=8) as pool: assert sum(pool.map(admit,range(12)))==3

@pytest.mark.asyncio
async def test_real_lightrag_langgraph_checkpoint_and_cross_company(tmp_path):
    knowledge=Knowledge(tmp_path/"rag"); await knowledge.start()
    ledger=Ledger(tmp_path/"ledger.db"); p=principal(); ledger.admit(p)
    try:
        a=await knowledge.query(p,"A"); text=json.dumps(a)
        assert "SECRET_A" in text and "synthetic-A.md" in text and "SECRET_B" not in text
        b=await knowledge.query(principal(company="B"),"B")
        assert "SECRET_A" not in json.dumps(b) and "SECRET_B" in json.dumps(b)
        with pytest.raises(PermissionError): await knowledge.query(p,"B")
        with pytest.raises(PermissionError): await knowledge.query(principal(scopes=[]),"A")
        config={"configurable":{"thread_id":"A:r1:task1"}}
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/"checkpoint.db")) as saver:
            graph=make_graph(knowledge,ledger,saver)
            result=await graph.ainvoke({**p,"findings":[]},config)
            assert len(result["findings"])==5
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/"checkpoint.db")) as saver:
            graph=make_graph(knowledge,ledger,saver)
            state=await graph.aget_state(config)
            assert state.values==result and not state.next
            assert ledger.count()==1
        (tmp_path/"retrieval.json").write_text(json.dumps(a),encoding="utf-8")
    finally: await knowledge.close()

@pytest.mark.asyncio
async def test_runtime_network_error_bounded_retry_and_no_effect(tmp_path):
    calls=0
    class BrokenKnowledge:
        async def query(self,*args):
            nonlocal calls
            calls+=1
            raise ConnectionError("synthetic network loss")
    ledger=Ledger(tmp_path/"ledger.db");p=principal();ledger.admit(p)
    async with AsyncSqliteSaver.from_conn_string(str(tmp_path/"checkpoints.db")) as saver:
        graph=make_graph(BrokenKnowledge(),ledger,saver)
        with pytest.raises(ConnectionError): await graph.ainvoke({**p,"findings":[]},{"configurable":{"thread_id":"A:fault:task1"}})
        assert 2 <= calls <= 4
        assert ledger.count()==0

@pytest.mark.asyncio
async def test_checkpoint_resume_in_a_new_os_process(tmp_path):
    import subprocess,sys,textwrap
    script=tmp_path/"child.py"
    script.write_text(textwrap.dedent("""
        import sqlite3,sys
        from typing import TypedDict
        from langgraph.graph import StateGraph,START,END
        from langgraph.checkpoint.sqlite import SqliteSaver
        class S(TypedDict): value:int
        def one(s): return {"value":s["value"]+1}
        def two(s): return {"value":s["value"]+1}
        graph=StateGraph(S);graph.add_node("one",one);graph.add_node("two",two)
        graph.add_edge(START,"one");graph.add_edge("one","two");graph.add_edge("two",END)
        with SqliteSaver.from_conn_string(sys.argv[1]) as saver:
            compiled=graph.compile(checkpointer=saver,interrupt_before=["two"] if sys.argv[2]=="first" else [])
            result=compiled.invoke({"value":0} if sys.argv[2]=="first" else None,{"configurable":{"thread_id":"A:restart:task1"}})
            print(result["value"])
    """),encoding="utf-8")
    path=str(tmp_path/"graph.sqlite")
    first=subprocess.check_output([sys.executable,str(script),path,"first"],text=True).strip()
    second=subprocess.check_output([sys.executable,str(script),path,"second"],text=True).strip()
    assert first=="1" and second=="2"

def test_sqlite_backup_restore_preserves_idempotency(tmp_path):
    source=tmp_path/"ledger.db"; backup=tmp_path/"restored.db"
    ledger=Ledger(source);p=principal();ledger.admit(p);ledger.effect(p)
    with sqlite3.connect(source) as src,sqlite3.connect(backup) as dst: src.backup(dst)
    restored=Ledger(backup);assert restored.admit(p)==False;restored.effect(p);assert restored.count()==1
