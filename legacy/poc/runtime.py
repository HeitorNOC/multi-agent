"""Local boundary experiment. No production credentials or paid model calls."""
import asyncio, hashlib, hmac, json, operator, sqlite3, time
from pathlib import Path
from typing import Annotated, TypedDict, NotRequired
import numpy as np
from aiohttp import web
from langgraph.graph import StateGraph, START, END
from langgraph.types import RetryPolicy
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from lightrag import LightRAG, QueryParam
from lightrag.utils import EmbeddingFunc, Tokenizer

class CharTokenizer:
    def encode(self, text, **kwargs): return list(text.encode("utf-8"))
    def decode(self, tokens): return bytes(tokens).decode("utf-8", errors="replace")

async def embedding(texts, **kwargs):
    # Fixture vectors: pipeline verification only, not semantic evaluation.
    return np.array([[1., 0., 0., 0.] for _ in texts], dtype=np.float32)

async def fixture_llm(*args, **kwargs):
    return "(Sales<|#|>department<|#|>Synthetic sales department)<|COMPLETE|>"

class Knowledge:
    def __init__(self, root): self.root, self.rags = Path(root), {}
    async def start(self):
        for company in ("A", "B"):
            rag = LightRAG(working_dir=str(self.root/company), workspace=company,
                embedding_func=EmbeddingFunc(embedding_dim=4, max_token_size=8192, func=embedding),
                llm_model_func=fixture_llm, tokenizer=Tokenizer("fixture-char", CharTokenizer()),
                vector_db_storage_cls_kwargs={"cosine_better_than_threshold": -1.0})
            await rag.initialize_storages()
            await rag.ainsert_custom_kg({"chunks": [{"content": f"Company {company}: sales dropped 20 percent; campaign paused. SECRET_{company}",
                "source_id": f"source-{company}", "file_path": f"synthetic-{company}.md"}],
                "entities": [], "relationships": []}, full_doc_id=f"doc-{company}")
            self.rags[company] = rag
            if company=="A" and __import__("os").environ.get("POC_COMPANY_A"): self.rags[__import__("os").environ["POC_COMPANY_A"]]=rag
    async def query(self, principal, company):
        if principal["companyId"] != company or "knowledge:read" not in principal["scopes"]:
            raise PermissionError("knowledge denied before retrieval")
        return await self.rags[company].aquery_data("sales dropped", QueryParam(mode="naive", enable_rerank=False, top_k=4, chunk_top_k=4, max_total_tokens=12000))
    async def close(self):
        for name,rag in self.rags.items():
            if name in ("A","B"): await rag.finalize_storages()

class State(TypedDict):
    companyId: str
    runId: str
    taskId: str
    scopes: list[str]
    findings: Annotated[list, operator.add]
    approved: bool
    delayMs: NotRequired[int]

class Ledger:
    def __init__(self, path):
        self.path = str(path)
        with self.db() as db:
            db.executescript("CREATE TABLE IF NOT EXISTS runs(company TEXT, run TEXT, task TEXT, digest TEXT, status TEXT, seq INTEGER DEFAULT 0, reserved INTEGER DEFAULT 0, PRIMARY KEY(company,run)); CREATE TABLE IF NOT EXISTS inbox(company TEXT, key TEXT, PRIMARY KEY(company,key));")
    def db(self): return sqlite3.connect(self.path, timeout=15)
    def admit(self, p, budget=10):
        digest=hashlib.sha256(json.dumps({k:v for k,v in p.items() if k!="issuedAt"},sort_keys=True).encode()).hexdigest()
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT task,digest FROM runs WHERE company=? AND run=?",(p["companyId"],p["runId"])).fetchone()
            if row:
                if row!=(p["taskId"],digest): raise ValueError("run identity/payload conflict")
                return False
            used=db.execute("SELECT coalesce(sum(reserved),0) FROM runs WHERE company=?",(p["companyId"],)).fetchone()[0]
            if used+3>budget: raise PermissionError("fixture aggregate reservation exhausted")
            db.execute("INSERT INTO runs(company,run,task,digest,status,reserved) VALUES(?,?,?,?,?,3)",(p["companyId"],p["runId"],p["taskId"],digest,"accepted"))
        return True
    def transition(self,p,status,seq):
        with self.db() as db:
            return db.execute("UPDATE runs SET status=?,seq=? WHERE company=? AND run=? AND seq<? AND status NOT IN ('completed','failed','cancelled')",(status,seq,p["companyId"],p["runId"],seq)).rowcount
    def effect(self,p):
        if "email:send" not in p["scopes"] or not p["approved"]: raise PermissionError("tool denied")
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT status FROM runs WHERE company=? AND run=?",(p["companyId"],p["runId"])).fetchone()
            if not row or row[0] in ("cancelled","failed"): raise PermissionError("run revoked")
            db.execute("INSERT OR IGNORE INTO inbox VALUES(?,?)",(p["companyId"],p["runId"]+":email"))
    def count(self):
        with self.db() as db: return db.execute("SELECT count(*) FROM inbox").fetchone()[0]

def verify(body, signature, key):
    if not hmac.compare_digest(hmac.new(key,body,hashlib.sha256).hexdigest(),signature): raise PermissionError("invalid signature")
    p=json.loads(body)
    if abs(time.time()-p["issuedAt"])>60: raise PermissionError("expired context")
    if p["companyId"] not in ("A","B", __import__("os").environ.get("POC_COMPANY_A")): raise PermissionError("unknown fixture company")
    return p

def make_graph(knowledge, ledger, saver):
    async def chief(s): return {"findings":[{"role":"chief_of_staff","plan":"explain sales with sources; simulated tool requires approval"}]}
    async def controller(s): return {"findings":[{"role":"adaptive_controller","strategy":"A3","capabilities":["sales-analysis","campaign-analysis"],"reason":"cross-domain synthetic evidence","maxSpecialists":2}]}
    async def sales(s): return {"findings":[{"role":"sales-analysis","evidence":await knowledge.query(s,s["companyId"])}]}
    async def marketing(s): return {"findings":[{"role":"campaign-analysis","evidence":await knowledge.query(s,s["companyId"])}]}
    async def review(s):
        if s.get("delayMs"): await asyncio.sleep(min(s["delayMs"]/1000,1))
        if not s["approved"]: raise PermissionError("human approval missing")
        ledger.effect(s)
        return {"findings":[{"role":"review","result":"one simulated inbox effect"}]}
    g=StateGraph(State)
    for name,fn in (("chief",chief),("controller",controller),("sales",sales),("marketing",marketing),("review",review)): g.add_node(name,fn,retry_policy=RetryPolicy(max_attempts=2,initial_interval=0.01,jitter=False,retry_on=ConnectionError) if name in ("sales","marketing") else None)
    g.add_edge(START,"chief"); g.add_edge("chief","controller")
    g.add_edge("controller","sales"); g.add_edge("controller","marketing")
    g.add_edge(["sales","marketing"],"review"); g.add_edge("review",END)
    return g.compile(checkpointer=saver)

async def serve():
    import os, tempfile
    root=Path(tempfile.mkdtemp(prefix="paperclip-boundary-"))
    # Per-experiment ephemeral key injected by parent; never persisted.
    key=bytes.fromhex(os.environ["POC_SIGNING_KEY"])
    knowledge=Knowledge(root/"knowledge"); await knowledge.start()
    ledger=Ledger(root/"ledger.sqlite")
    locks={}
    async with AsyncSqliteSaver.from_conn_string(str(root/"checkpoints.sqlite")) as saver:
        graph=make_graph(knowledge,ledger,saver)
        async def execute(request):
            body=await request.read()
            try: p=verify(body,request.headers.get("x-poc-signature",""),key)
            except (PermissionError,KeyError,ValueError): return web.json_response({"error":"unauthorized"},status=403)
            identity=p["companyId"]+":"+p["runId"]
            async with locks.setdefault(identity,asyncio.Lock()):
                try:
                    fresh=ledger.admit(p)
                    config={"configurable":{"thread_id":identity+":"+p["taskId"]}}
                    if fresh:
                        ledger.transition(p,"running",1)
                        result=await graph.ainvoke({**p,"findings":[]},config)
                        ledger.transition(p,"completed",2)
                    else:
                        snapshot=await graph.aget_state(config)
                        if snapshot.next or not snapshot.values: return web.json_response({"status":"recovery_required"},status=409)
                        result=snapshot.values
                    return web.json_response({"status":"completed","findings":result["findings"],"effects":ledger.count(),"usage":{"inputTokens":0,"outputTokens":0},"costUsd":0,"costStatus":"reported"})
                except PermissionError as e: return web.json_response({"error":str(e)},status=403)
                except ValueError as e: return web.json_response({"error":str(e)},status=409)
        app=web.Application(); app.router.add_post("/execute",execute)
        runner=web.AppRunner(app); await runner.setup(); site=web.TCPSite(runner,"127.0.0.1",0); await site.start()
        port=site._server.sockets[0].getsockname()[1]
        print(json.dumps({"ready":True,"port":port}),flush=True)
        try: await asyncio.Event().wait()
        finally: await runner.cleanup(); await knowledge.close()

if __name__=="__main__": asyncio.run(serve())
