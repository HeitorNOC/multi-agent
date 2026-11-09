"""Native eight-document knowledge, index load and real LangGraph/model comparison."""
import asyncio,concurrent.futures,hashlib,hmac,json,os,sqlite3,subprocess,sys,time,uuid
from pathlib import Path
from typing import TypedDict,Annotated
import operator
import re
from urllib.error import HTTPError

import asyncpg
import numpy as np
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from langgraph.graph import StateGraph,START,END
from langgraph.types import Send,interrupt
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/brain-recovery'))
from test_brain import BrainLab,PY
from authority_client import request as signed_request

DOCS=json.loads((HERE/'corpus.json').read_text(encoding='utf-8'))['documents']
CAPS={'sales_analysis':['sales-january','sales-february'],'marketing_analysis':['marketing','inventory'],'finance_review':['finance','execution-policy']}
QUESTIONS={'sales-january':'What are ACME January sales orders, average price and revenue?',
    'sales-february':'What are ACME February sales orders, average price and revenue?',
    'marketing':'What are ACME January and February qualified lead counts?',
    'inventory':'What are ACME January and February stockout counts?',
    'finance':'What are ACME February refunds and the internal finance code?',
    'execution-policy':'What approval is required for ACME external CRM updates and email dispatch?'}

class Lab(BrainLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True);self.evidence_dir=HERE/'v23-evidence';self.evidence_dir.mkdir(exist_ok=True)
        self.native_options={'profile':'investment','synthetic_corpus_sha':hashlib.sha256((HERE/'corpus.json').read_bytes()).hexdigest()}
        self.identity_key=Ed25519PrivateKey.generate();self.identity_public=self.identity_key.public_key().public_bytes_raw().hex();self.projections={}
    def authority(self):
        self.authority_config['caps']['model']=24;super().authority()
    def identity(self,sources=None,expires=120):
        raw=json.dumps({'installation':self.id,'aud':'investment-policy','sub':'fixture-executive','exp':time.time()+expires,
            'sources':sources if sources is not None else sorted({d['source'] for d in DOCS}),'capabilities':list(CAPS)},separators=(',',':'))
        return {'payload_json':raw,'signature':self.identity_key.sign(raw.encode()).hex()}
    def policy(self,action,identity=None,**payload):
        raw={'action':action,'installation':self.id,'public':self.identity_public,'identity':identity or self.identity(),**payload}
        proc=subprocess.run(['node',str(HERE/'policy.ts')],input=json.dumps(raw),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,timeout=15)
        value=json.loads(proc.stdout);assert proc.returncode in (0,3),proc.stderr
        return value
    def stage_all(self):
        records=[]
        for doc in DOCS:
            content=doc['content'];payload={'installation':self.id,'source':doc['source'],'version':doc['version'],
                'content_sha':hashlib.sha256(content.encode()).hexdigest(),'raw_sha':hashlib.sha256(('fixture:'+content).encode()).hexdigest(),
                'domain':'finance' if doc['source']=='finance' else 'public','draft':uuid.uuid4().hex,'reviewer':'fixture-board','valid_at':'2026-01-01T00:00:00Z','known_at':'2026-11-05T00:00:00Z'}
            raw=json.dumps(payload,separators=(',',':'),ensure_ascii=False)
            release={'payload':payload,'payload_json':raw,'signature':hmac.new(bytes.fromhex(self.config['editorialKey']),raw.encode(),hashlib.sha256).hexdigest(),'content':content}
            result=self.native('stage',release=release);self.projections[(doc['source'],doc['version'])]=result['id']
            records.append({'source':doc['source'],'version':doc['version'],'id':result['id'],'inventory':result['inventory']})
        self.evidence['native_documents']=records
    def query(self,source,question,version=1,context=False,identity=None):
        assert self.policy('source',identity,source=source)['allowed'],'current source access denied before retrieval'
        return self.native('query',id=self.projections[(source,version)],query=question,mode='naive',only_need_context=context)['answer']
    def llm(self,prompt):
        value=self.native('evaluation',prompt=prompt)['text'];return json.loads(value)

def percentile(values,q):
    values=sorted(values);return values[min(len(values)-1,int(np.ceil(q*len(values)))-1)]

class TeamState(TypedDict,total=False):
    proposal:dict
    plan:dict
    capability:str
    evidence:Annotated[list[dict],operator.add]
    result:dict

GOAL='Explain the ACME January to February revenue decline, distinguish facts from unproven causes, propose a reviewable action. Use only supplied evidence.'
SCHEMA='Return JSON with revenue_drop_pct:number, leads_drop_pct:number, price_unchanged:boolean, causal_proof:boolean, requires_approval:boolean, cited_sources:array of source names, hypotheses:array of unproven hypotheses, action:string. Do not claim an established cause.'

async def team(lab):
    trace=[];started=time.perf_counter()
    async def cos(state):
        p=await asyncio.to_thread(lab.llm,'You are Chief of Staff planning this request: '+GOAL+' Available capability catalog: '+json.dumps(CAPS)+'. Return JSON: strategy="A3", capabilities: distinct necessary catalog keys (2 to 3), budget_units=5, reason: why cross-domain review is needed, requires_approval=true. No task execution yet.')
        authorized=lab.policy('plan',plan=p);assert authorized['allowed'],authorized
        trace.append({'node':'chief_of_staff_and_controller','proposal':p,'authorized':authorized})
        return {'proposal':p,'plan':authorized}
    def dispatch(state):return [Send('specialist',{'capability':cap}) for cap in state['plan']['capabilities']]
    async def specialist(state):
        cap=state['capability'];contexts=[]
        for source in CAPS[cap]:
            context=await asyncio.to_thread(lab.query,source,QUESTIONS[source],1,True)
            if '[no-context]' in context:raise ValueError('Required source context absent for capability '+cap+': '+source)
            contexts.append({'source':source,'context':context})
        value=await asyncio.to_thread(lab.llm,'You are the specialist with capability '+cap+'. '+GOAL+' Sources: '+json.dumps(contexts)+'. Return JSON: capability, facts (array with values and source), hypotheses (explicitly unproven), uncertainties. No external action.')
        trace.append({'node':'specialist','capability':cap,'sources':[c['source'] for c in contexts]})
        return {'evidence':[{'capability':cap,'output':value}]}
    async def synthesize(state):
        value=await asyncio.to_thread(lab.llm,'You are Chief of Staff synthesizing specialist evidence. '+GOAL+' '+SCHEMA+' Evidence: '+json.dumps(state['evidence']))
        trace.append({'node':'synthesis','result':value});return {'result':value}
    async def approval(state):
        interrupt({'approval_required':True,'planHash':state['plan']['planHash'],'action':state['result']['action']})
        raise AssertionError('No human approval was supplied in this qualification')
    async with AsyncPostgresSaver.from_conn_string(lab.dsn) as saver:
        await saver.setup();builder=StateGraph(TeamState)
        for name,fn in [('cos',cos),('specialist',specialist),('synthesis',synthesize),('approval',approval)]:builder.add_node(name,fn)
        builder.add_edge(START,'cos');builder.add_conditional_edges('cos',dispatch,['specialist']);builder.add_edge('specialist','synthesis');builder.add_edge('synthesis','approval');builder.add_edge('approval',END)
        graph=builder.compile(checkpointer=saver);cfg={'configurable':{'thread_id':lab.id+':investment-team'}}
        await graph.ainvoke({},cfg);state=await graph.aget_state(cfg)
        assert state.next==('approval',) and any(t.interrupts for t in state.tasks)
    return {'result':state.values['result'],'trace':trace,'seconds':time.perf_counter()-started,'next':list(state.next),'evidence_count':len(state.values['evidence'])}

def grade(value):
    return {'revenue_drop':value.get('revenue_drop_pct')==20,'leads_drop':value.get('leads_drop_pct')==20,
        'price_unchanged':value.get('price_unchanged') is True,'no_invented_causality':value.get('causal_proof') is False,
        'approval':value.get('requires_approval') is True,'sources':{'sales-january','sales-february','marketing'}<=set(re.sub(r':v\d+\.md$','',s) for s in value.get('cited_sources',[]))}

async def vector_load(lab):
    import aiohttp
    texts=[f'Fictional inventory record {i:04d}: product P{i:04d} has synthetic stock {i%97} units.' for i in range(1000)]
    vectors=[];start=time.perf_counter()
    async with aiohttp.ClientSession() as client:
        for offset in range(0,len(texts),64):
            raw=json.dumps({'texts':texts[offset:offset+64],'issued':time.time()}).encode()
            sig=hmac.new(bytes.fromhex(lab.embedding_key),raw,hashlib.sha256).hexdigest()
            async with client.post(lab.embedding_url+'/embed',data=raw,headers={'x-signature':sig}) as response:
                assert response.status==200;vectors.extend((await response.json())['vectors'])
    pool=await asyncpg.create_pool(host='127.0.0.1',port=lab.port,user='knowledge_owner',password=lab.secret,database='knowledge',min_size=1,max_size=8)
    try:
        async with pool.acquire() as conn:
            await conn.execute('CREATE SCHEMA load; CREATE TABLE load.vectors(id int PRIMARY KEY,embedding vector(384));')
            await conn.executemany('INSERT INTO load.vectors VALUES($1,$2::vector)',[(i,json.dumps(v)) for i,v in enumerate(vectors)])
            await conn.execute('CREATE INDEX ON load.vectors USING hnsw(embedding vector_cosine_ops); ANALYZE load.vectors')
        latencies=[];hits=[]
        async def lookup(i):
            tick=time.perf_counter()
            async with pool.acquire() as conn:row=await conn.fetchval('SELECT id FROM load.vectors ORDER BY embedding <=> $1::vector LIMIT 1',json.dumps(vectors[i]))
            latencies.append(time.perf_counter()-tick);hits.append(row==i)
        for base in range(0,32,8):await asyncio.gather(*(lookup(i) for i in range(base,base+8)))
        return {'vectors':len(vectors),'dimension':384,'total_seconds':time.perf_counter()-start,'queries':len(hits),'exact_self_retrieval':sum(hits),
            'p50':percentile(latencies,.5),'p95':percentile(latencies,.95),'scope':'direct storage/ONNX, not native semantic ingestion of 1000 documents'}
    finally:await pool.close()

def test_v2_v3_native_knowledge_and_team():
    lab=Lab();start=time.perf_counter();failures=[]
    try:
        lab.start();lab.evidence['resources']={'host_logical_cpus':os.cpu_count(),'docker_cpus':lab.docker('info','--format','{{json .NCPU}}').stdout.decode().strip(),
            'docker_memory_bytes':lab.docker('info','--format','{{json .MemTotal}}').stdout.decode().strip()}
        lab.stage_all();checks=[]
        for source,version,question,expected in [('remote-policy',1,'How many days weekly does the remote policy allow? Cite source.','two'),('remote-policy',2,'How many days weekly does the remote policy allow? Cite source.','three'),('sales-february',1,'What was February revenue? Cite source.','8000')]:
            answer=lab.query(source,question,version);normalized=answer.lower().replace(',','').replace('.','')
            checks.append({'source':source,'version':version,'answer':answer,'pass':expected in normalized and source in answer})
        answer=lab.query('inventory','Who is ACME CEO? If absent explicitly say the documents do not establish this. Cite source if applicable.')
        checks.append({'source':'inventory','question':'absent CEO','answer':answer,'pass':any(x in answer.lower() for x in ['not','unknown','no information','não'])})
        lab.evidence['semantic_checks']=checks
        for item in checks:
            if not item['pass']:failures.append('semantic:'+item['source']+':'+str(item.get('version','absent')))
        before=signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']
        public=lab.identity([d['source'] for d in DOCS if d['source']!='finance'])
        assert not lab.policy('source',public,source='finance')['allowed']
        assert signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']==before
        levels=[]
        for concurrency in [1,4,8]:
            def context(_):
                tick=time.perf_counter();value=lab.query('remote-policy','remote work days',2,True)
                return {'seconds':time.perf_counter()-tick,'pass':'three' in value.lower() and 'FIN-ACME-742' not in value}
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:rows=list(pool.map(context,range(16)))
            times=[r['seconds'] for r in rows];level={'concurrency':concurrency,'requests':16,'p50':percentile(times,.5),'p95':percentile(times,.95),'correct_contexts':sum(r['pass'] for r in rows)};levels.append(level)
            if level['p95']>2 or level['correct_contexts']!=16:failures.append('context_load:'+str(concurrency))
        assert signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']==before
        lab.evidence['context_load']=levels
        lab.evidence['vector_load']=asyncio.run(vector_load(lab))
        if lab.evidence['vector_load']['exact_self_retrieval']!=32:failures.append('vector_self_retrieval')
        tick=time.perf_counter();baseline=lab.llm('You are one analyst with all authorized evidence. '+GOAL+' '+SCHEMA+' Evidence: '+json.dumps(DOCS))
        lab.evidence['baseline']={'result':baseline,'grade':grade(baseline),'seconds':time.perf_counter()-tick}
        coordinated=asyncio.run(team(lab));coordinated['grade']=grade(coordinated['result']);lab.evidence['coordinated']=coordinated
        for name,value in [('A1',grade(baseline)),('A3',coordinated['grade'])]:
            if not all(value.values()):failures.append(name+':answer_quality')
        # Negative policy probes: signed grants, expiry, token tamper, scope and effects.
        fake=lab.identity();fake['payload_json']=fake['payload_json'].replace('fixture-executive','attacker')
        policy_checks={'tampered_identity':not lab.policy('source',fake,source='finance')['allowed'],
            'expired_identity':not lab.policy('source',lab.identity(expires=-1),source='finance')['allowed'],
            'unauthorized_source':not lab.policy('source',public,source='finance')['allowed'],
            'unapproved_effect':not lab.policy('effect',recipient='fake@example.test',payload='update CRM')['allowed'],
            'over_budget':not lab.policy('plan',plan={**coordinated['trace'][0]['proposal'],'budget_units':999})['allowed']}
        lab.evidence['policy_checks']=policy_checks
        if not all(policy_checks.values()):failures.append('policy')
        count=signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']
        lab.native('evaluation_delete',id=lab.projections[('inventory',1)])
        with pytest.raises(HTTPError) as deleted:lab.query('inventory','stockouts',1,True)
        assert deleted.value.code==409
        assert signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']==count
        lab.evidence['deletion']={'native_document_deleted':True,'stale_certificate_query_status':409,'new_model_calls':0}
        lab.evidence.update(result='PASS_SMALL_V2_V3' if not failures else 'FAIL_V2_V3_CRITERIA',failures=failures)
        assert not failures,failures
    except BaseException as error:
        lab.evidence.setdefault('result','FAIL_EXECUTION');lab.evidence['error']=lab.redact(repr(error));raise
    finally:
        lab.evidence['seconds']=time.perf_counter()-start
        try:lab.stop_native()
        except Exception:pass
        try:lab.cleanup();lab.evidence['disposable_resources_removed']=True
        finally:lab.save()
