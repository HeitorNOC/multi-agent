/** Bounded qualification slice. Synthetic authentication; no production IdP. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execute as editorial,loadNote } from '../temporal-editorial/editorial.ts';
import { Retained,RetainedError } from '../langgraph-retained-flow/retained.ts';
import { Brain } from '../brain-recovery/brain.ts';
import {Inference,textHash} from '../brain-recovery/inference.ts';

type Actor = { id: string; role: string; installation: string; token: string; sources: string[] };
type Config = { installation: string; db: string; editorial: string; vault: string; editorialKey: string;
  principals: Actor[]; budget: number; provider: string; providerKey: string; leaseMs: number;retained?:any;brain?:any;detachedInference?:any };
type Ref = { source: string; version: number; raw_sha: string; content_sha: string; known_at: string; valid_at: string };
type Plan = { job: string; installation: string; owner: string; capabilities: string[]; strategy: string;
  policy: string; execute: boolean; effect: null | { kind: string; target: string; text: string };
  references: Ref[]; maxUnits: number; reservedUnits: number };
const catalog: Record<string, string> = { policy_lookup: 'politica-remoto', finance_review: 'aquisicao' };
const encode = (value: unknown) => JSON.stringify(value);
const digest = (value: unknown) => createHash('sha256').update(encode(value)).digest('hex');
class Denied extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
function requireThat(ok: unknown, status: number, message: string): asserts ok { if (!ok) throw new Denied(status, message); }
function fields(p: any, allowed: string[]) {
  requireThat(p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).every(k => allowed.includes(k)), 400, 'unsupported field');
}

let configText = ''; for await (const chunk of process.stdin) configText += chunk;
const c: Config = JSON.parse(configText);
const db = new DatabaseSync(c.db);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY, role TEXT, enabled INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grants(principal TEXT, source TEXT, PRIMARY KEY(principal,source));
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT, plan TEXT, hash TEXT, state TEXT,
 reserved INTEGER, spent INTEGER DEFAULT 0, epoch INTEGER DEFAULT 0, worker TEXT, deadline INTEGER DEFAULT 0, result TEXT);
CREATE TABLE IF NOT EXISTS approvals(job TEXT PRIMARY KEY, hash TEXT, actor TEXT);
CREATE TABLE IF NOT EXISTS charges(job TEXT, step TEXT, units INTEGER, PRIMARY KEY(job,step));
CREATE TABLE IF NOT EXISTS reads(job TEXT, capability TEXT, snapshot TEXT, PRIMARY KEY(job,capability));
CREATE TABLE IF NOT EXISTS effects(job TEXT PRIMARY KEY, hash TEXT, state TEXT, receipt TEXT);
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY,event TEXT,job TEXT,actor TEXT,payload TEXT);`);
if(c.detachedInference)db.exec('CREATE TABLE IF NOT EXISTS inference_requests(id TEXT PRIMARY KEY,job TEXT,capability TEXT,input_json TEXT,state TEXT,receipt TEXT,UNIQUE(job,capability));');
for (const p of c.principals) {
  const inserted = db.prepare('INSERT OR IGNORE INTO principals VALUES(?,?,1)').run(p.id, p.role);
  if (inserted.changes) for (const source of p.sources) db.prepare('INSERT OR IGNORE INTO grants VALUES(?,?)').run(p.id, source);
}
const audit = (event: string, job: string | null, actor: string, payload: unknown = {}) =>
  db.prepare('INSERT INTO audit(event,job,actor,payload) VALUES(?,?,?,?)').run(event, job, actor, encode(payload));
function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function identity(token: string): Actor {
  const actor = c.principals.find(a => {
    const left = Buffer.from(a.token), right = Buffer.from(token);
    return left.length === right.length && timingSafeEqual(left, right);
  });
  requireThat(actor, 401, 'unknown identity');
  requireThat(actor.installation === c.installation, 403, 'different installation');
  requireThat((db.prepare('SELECT enabled FROM principals WHERE id=?').get(actor.id) as any)?.enabled, 403, 'disabled identity');
  return actor;
}
const board = (a: Actor) => requireThat(a.role === 'board', 403, 'governance required');
const worker = (a: Actor) => requireThat(a.role === 'worker', 403, 'runtime identity required');
function job(id: string): any {
  const value: any = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  requireThat(value, 404, 'unknown job'); value.planValue = JSON.parse(value.plan); return value;
}
function allowed(principal: string, plan: Plan) {
  requireThat((db.prepare('SELECT enabled FROM principals WHERE id=?').get(principal) as any)?.enabled, 403, 'principal disabled');
  for (const ref of plan.references) requireThat(db.prepare('SELECT 1 FROM grants WHERE principal=? AND source=?').get(principal, ref.source), 403, 'current source ACL denied');
}
function lease(a: Actor, p: any) {
  worker(a); const row = job(p.job);
  requireThat(row.state!=='closed_unknown',409,'job closed unknown; explicit new intent required');
  requireThat(row.epoch === p.epoch && row.worker === p.worker && row.deadline > Date.now(), 409, 'stale or expired execution lease');
  allowed(row.owner, row.planValue); return row;
}
function snapshot(source: string, asOf: string, knownAt: string): any {
  const result = editorial({ db: c.editorial, vault: c.vault, installation: c.installation, key: c.editorialKey,
    actor: { id: 'canonical-reader', role: 'board' } }, { action: 'canonical_asof', source, as_of: asOf, known_at: knownAt });
  requireThat(result.found, 409, 'approved canonical snapshot missing'); return result;
}
function charge(row: any, step: string, units: number) {
  if (db.prepare('SELECT 1 FROM charges WHERE job=? AND step=?').get(row.id, step)) return;
  const fresh = job(row.id);
  requireThat(fresh.spent + units <= fresh.reserved, 429, 'job reservation exhausted');
  db.prepare('INSERT INTO charges VALUES(?,?,?)').run(row.id, step, units);
  db.prepare('UPDATE jobs SET spent=spent+? WHERE id=?').run(units, row.id);
}
async function provider(action: string, row: any): Promise<any> {
  const payload = encode({ action, key: c.installation + ':' + row.id, digest: row.hash, run: row.id, issued: Date.now()/1000 });
  const response = await fetch(c.provider + '/rpc', { method: 'POST', body: payload, signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', Buffer.from(c.providerKey, 'hex')).update(payload).digest('hex') } });
  requireThat(response.ok, 503, 'provider rejected request'); return response.json();
}
let crashAfterProvider = false;
async function rpc(a: Actor, p: any, inferenceReceipt?:any): Promise<any> {
  requireThat(typeof p.action === 'string', 400, 'action required');
  if(brain?.frozen()&&!['brain_open','brain_status','status','state'].includes(p.action))throw new Denied(503,'brain writers frozen');
  if(p.action==='brain_status'){board(a);await brain!.all();return {verified:true,frozen:brain!.frozen()};}
  if(p.action==='brain_checkpoint'){board(a);fields(p,['action','request_id']);return brain!.checkpoint();}
  if(p.action==='brain_open'){board(a);fields(p,['action','request_id']);return brain!.open();}
  if(p.action==='brain_prepare'||p.action==='brain_commit'){
    requireThat(brain,409,'native brain not configured');
    fields(p,['action','id','projection_id']);
    if(p.action==='brain_prepare')board(a);else worker(a);
    const reader=new DatabaseSync(c.editorial,{readOnly:true});let draft:any;
    try{draft=reader.prepare('SELECT * FROM drafts WHERE id=?').get(p.id);}finally{reader.close();}
    requireThat(draft?.reviewer,409,'reviewed source required');
    const reviewer:any=db.prepare("SELECT * FROM principals WHERE id=? AND enabled=1 AND role='board'").get(draft.reviewer);
    requireThat(reviewer,403,'current reviewer required');allowed(reviewer.id,{references:[{source:draft.source}]} as Plan);
    if(p.action==='brain_prepare')allowed(a.id,{references:[{source:draft.source}]} as Plan);
    const config={db:c.editorial,vault:c.vault,installation:c.installation,key:c.editorialKey,actor:{id:reviewer.id,role:'board'}};
    const release=editorial(config,{action:'prepare',id:draft.id});
    if(p.action==='brain_prepare')return {...release,payload_json:JSON.stringify(release.payload)};
    return brain.commit(draft,release,p.projection_id,()=>editorial(config,{action:'commit',id:draft.id,receipt:{native_projection:p.projection_id}}));
  }
  if (p.action === 'create' || p.action === 'quote') {
    fields(p, ['action','capabilities','execute','maxUnits','request_id']);
    requireThat(['analyst','finance'].includes(a.role), 403, 'requester required');
    requireThat(Array.isArray(p.capabilities) && p.capabilities.length >= 1 && p.capabilities.length <= 2 &&
      new Set(p.capabilities).size === p.capabilities.length && p.capabilities.every((x: any) => typeof x === 'string' && Object.hasOwn(catalog, x)), 400, 'unsupported capabilities');
    requireThat(typeof p.execute === 'boolean' && Number.isSafeInteger(p.maxUnits) && p.maxUnits >= 0 && p.maxUnits <= 100, 400, 'bounded request required');
    requireThat(p.request_id===undefined || (typeof p.request_id==='string' && /^[a-f0-9-]{36}$/.test(p.request_id)),400,'invalid request_id');
    if(c.retained && p.request_id)requireThat(!db.prepare('SELECT 1 FROM retained_tombstones WHERE job=?').get(p.request_id),409,'request_id closed unknown; explicit new intent required');
    if(p.request_id){
      const prior:any=db.prepare('SELECT * FROM jobs WHERE id=?').get(p.request_id);
      if(prior){
        const original:Plan=JSON.parse(prior.plan);
        requireThat(prior.owner===a.id,403,'request owner required');
        requireThat(encode(original.capabilities)===encode([...p.capabilities].sort()) && original.execute===p.execute && original.maxUnits===p.maxUnits,409,'request_id already bound to different input');
        allowed(a.id,original);return {id:prior.id,plan:original,hash:prior.hash};
      }
    }
    const id = p.request_id || randomUUID(), now = new Date().toISOString();
    const capabilities = [...p.capabilities].sort();
    const references = capabilities.map((cap: string) => {
      const s = snapshot(catalog[cap], now, now);
      return { source: s.source, version: s.version, raw_sha: s.raw_sha, content_sha: s.content_sha, known_at: s.known_at, valid_at: s.valid_at };
    });
    const required = capabilities.length + (p.execute ? 2 : 0);
    requireThat(p.maxUnits >= required, 429, 'insufficient job budget before admission');
    const plan: Plan = { job: id, installation: c.installation, owner: a.id, capabilities,
      strategy: capabilities.length > 1 ? 'A3' : p.execute ? 'A2' : 'A1', policy: 'bounded-capability-policy-v1', execute: p.execute,
      effect: p.execute ? { kind: 'synthetic-notification', target: 'fixture-inbox', text: 'Approved canonical source review' } : null,
      references, maxUnits: p.maxUnits, reservedUnits: required };
    allowed(a.id, plan);
    if(brain)for(const reference of references)await brain.reference(reference);
    if(p.action==='quote')return {id,plan,hash:digest(plan)};
    return transaction(() => {
      const total: any = db.prepare("SELECT coalesce(sum(CASE WHEN state='completed' THEN spent ELSE reserved END),0) AS n FROM jobs").get();
      requireThat(total.n + required <= c.budget, 429, 'installation reservation ceiling');
      db.prepare("INSERT INTO jobs(id,owner,plan,hash,state,reserved) VALUES(?,?,?,?,'admitted',?)").run(id,a.id,encode(plan),digest(plan),required);
      audit('controller_selected',id,a.id,{ strategy: plan.strategy, capabilities, reason: 'declared capabilities, effect requirement and bounded budget', units: required });
      return { id, plan, hash: digest(plan) };
    });
  }
  if (p.action === 'state') {
    board(a); return { jobs: db.prepare('SELECT id,state,reserved,spent,epoch FROM jobs').all(), charges: db.prepare('SELECT * FROM charges').all(),
      effects: db.prepare('SELECT * FROM effects').all(), approvals: db.prepare('SELECT * FROM approvals').all(), audit: db.prepare('SELECT * FROM audit ORDER BY seq').all() };
  }
  if (p.action === 'revoke') {
    board(a); fields(p,['action','principal','source']);
    return transaction(() => { db.prepare('DELETE FROM grants WHERE principal=? AND source=?').run(p.principal,p.source); audit('source_revoked',null,a.id,{ principal:p.principal,source:p.source }); return { revoked:true }; });
  }
  if (p.action === 'fault') { board(a); fields(p,['action']); crashAfterProvider = true; return { armed:true }; }
  if(p.action==='editorial'){
    fields(p,['action','command']);
    requireThat(p.command && ['submit','review','prepare','commit'].includes(p.command.action),400,'unsupported editorial command');
    requireThat(!brain||p.command.action!=='commit',409,'native projection receipt required before canonical commit');
    let source:string;
    if(p.command.action==='submit')source=loadNote(c.vault,p.command.path).source;
    else{const reader=new DatabaseSync(c.editorial,{readOnly:true});try{source=(reader.prepare('SELECT source FROM drafts WHERE id=?').get(p.command.id) as any)?.source;}finally{reader.close();}}
    requireThat(source!,404,'draft missing');allowed(a.id,{references:[{source:source!}]} as Plan);
    return editorial({db:c.editorial,vault:c.vault,installation:c.installation,key:c.editorialKey,actor:{id:a.id,role:a.role}},p.command);
  }
  const row = job(p.job);
  if (p.action === 'status') {
    requireThat(a.id === row.owner || a.role === 'board',403,'job owner required'); allowed(a.id,row.planValue);
    return { id:row.id, plan:row.planValue, hash:row.hash, state:row.state, result:row.result ? JSON.parse(row.result) : null };
  }
  if (p.action === 'approve') {
    board(a); fields(p,['action','job','hash']);
    requireThat(a.id !== row.owner && p.hash === row.hash,409,'exact plan and separate reviewer required');
    transaction(() => { allowed(a.id,row.planValue); allowed(row.owner,row.planValue);
      const old: any = db.prepare('SELECT * FROM approvals WHERE job=?').get(row.id);
      requireThat(!old || (old.hash === p.hash && old.actor === a.id),409,'approval immutable');
      db.prepare('INSERT OR IGNORE INTO approvals VALUES(?,?,?)').run(row.id,p.hash,a.id); audit('plan_approved',row.id,a.id,{ hash:p.hash }); });
    return { approved:true, hash:p.hash };
  }
  if (p.action === 'fence') {
    board(a); fields(p,['action','job','reason']); requireThat(typeof p.reason === 'string' && p.reason.length >= 20,400,'fencing reason required');
    transaction(() => { db.prepare('UPDATE jobs SET epoch=epoch+1,worker=NULL,deadline=0 WHERE id=?').run(row.id); audit('lease_fenced',row.id,a.id,{ reason:p.reason }); }); return { fenced:true };
  }
  if (p.action === 'claim') {
    worker(a); fields(p,['action','job','worker']); requireThat(typeof p.worker === 'string' && p.worker.length >= 8,400,'worker instance required');
    return transaction(() => { const current = job(row.id); allowed(current.owner,current.planValue);
      requireThat(!current.worker || current.deadline <= Date.now(),409,'another worker owns this job');
      db.prepare('UPDATE jobs SET epoch=epoch+1,worker=?,deadline=? WHERE id=?').run(p.worker,Date.now()+c.leaseMs,row.id);
      const claimed = job(row.id); audit('lease_claimed',row.id,a.id,{ epoch:claimed.epoch,worker:p.worker });
      return { epoch:claimed.epoch, plan:claimed.planValue, hash:claimed.hash };
    });
  }
  fields(p,['action','job','worker','epoch', ...(['read','read_prepare','read_commit'].includes(p.action) ? ['capability'] : []),...(p.action==='renew'?['request_id']:[])]);
  const current = lease(a,p);
  if(p.action==='renew'){
    requireThat(typeof p.request_id==='string'&&p.request_id.length>=8,400,'unique heartbeat ID required');
    return transaction(()=>{lease(a,p);const deadline=Date.now()+c.leaseMs;
      db.prepare('UPDATE jobs SET deadline=? WHERE id=?').run(deadline,row.id);audit('lease_renewed',row.id,a.id,{epoch:p.epoch,deadline});return {epoch:p.epoch,deadline};});
  }
  if(p.action==='read_prepare'){
    requireThat(inference,409,'detached inference not configured');
    requireThat(current.planValue.capabilities.includes(p.capability),403,'capability outside plan');
    const old:any=db.prepare('SELECT snapshot FROM reads WHERE job=? AND capability=?').get(row.id,p.capability);
    if(old)return {completed:true,snapshot:JSON.parse(old.snapshot)};
    const existing:any=db.prepare('SELECT * FROM inference_requests WHERE job=? AND capability=?').get(row.id,p.capability);
    if(existing)return existing;
    const ref=current.planValue.references.find((x:Ref)=>x.source===catalog[p.capability]);
    const source=snapshot(ref.source,new Date().toISOString(),ref.known_at);
    requireThat(source.raw_sha===ref.raw_sha&&source.content_sha===ref.content_sha,409,'canonical snapshot changed');
    const input_json=encode({installation:c.installation,job:row.id,planHash:row.hash,capability:p.capability,reference:ref,snapshot:source});
    const id=c.installation+':inference:'+textHash(input_json);
    db.prepare('INSERT INTO inference_requests VALUES(?,?,?,?,?,NULL)').run(id,row.id,p.capability,input_json,'admitted');
    audit('inference_admitted',row.id,a.id,{id,input_sha:textHash(input_json)});
    return db.prepare('SELECT * FROM inference_requests WHERE id=?').get(id);
  }
  if(p.action==='read_commit'){
    requireThat(inference,409,'detached inference not configured');
    const request:any=db.prepare('SELECT * FROM inference_requests WHERE job=? AND capability=?').get(row.id,p.capability);
    requireThat(request,409,'inference admission required');inference.verify(request,inferenceReceipt);
    return transaction(()=>{lease(a,p);
      const old:any=db.prepare('SELECT snapshot FROM reads WHERE job=? AND capability=?').get(row.id,p.capability);
      if(old)return JSON.parse(old.snapshot);
      const input=JSON.parse(request.input_json),s={...input.snapshot,semantic:inferenceReceipt.semantic};
      charge(current,'read:'+p.capability,1);
      db.prepare('INSERT INTO reads VALUES(?,?,?)').run(row.id,p.capability,encode(s));
      db.prepare("UPDATE inference_requests SET state='committed',receipt=? WHERE id=?").run(encode(inferenceReceipt),request.id);
      audit('inference_committed',row.id,a.id,{id:request.id,receipt_sha:digest(inferenceReceipt)});return s;});
  }
  if (p.action === 'release') {
    transaction(() => { db.prepare('UPDATE jobs SET worker=NULL,deadline=0 WHERE id=?').run(row.id); audit('lease_released',row.id,a.id); }); return { released:true };
  }
  if (p.action === 'read') {
    requireThat(current.planValue.capabilities.includes(p.capability),403,'capability outside plan');
    const cached:any=db.prepare('SELECT snapshot FROM reads WHERE job=? AND capability=?').get(row.id,p.capability);
    if(cached)return JSON.parse(cached.snapshot);
    const ref = current.planValue.references.find((x: Ref) => x.source === catalog[p.capability]);
    const canonicalSnapshot=snapshot(ref.source,new Date().toISOString(),ref.known_at);
    const semantic=brain?await brain.query(ref):null;
    return transaction(() => {
      lease(a,p);
      const old: any = db.prepare('SELECT snapshot FROM reads WHERE job=? AND capability=?').get(row.id,p.capability);
      if (old) return JSON.parse(old.snapshot);
      const ref = current.planValue.references.find((x: Ref) => x.source === catalog[p.capability]);
      const s = semantic?{...canonicalSnapshot,semantic}:canonicalSnapshot;
      requireThat(s.raw_sha === ref.raw_sha && s.content_sha === ref.content_sha,409,'canonical snapshot changed');
      charge(current,'read:'+p.capability,1);
      db.prepare('INSERT INTO reads VALUES(?,?,?)').run(row.id,p.capability,encode(s)); audit('specialist_read',row.id,a.id,{capability:p.capability,source:s.source,version:s.version}); return s;
    });
  }
  if (p.action === 'approval') {
    const approval: any = db.prepare('SELECT * FROM approvals WHERE job=?').get(row.id);
    requireThat(approval && approval.hash === current.hash,403,'governance approval absent');
    allowed(approval.actor,current.planValue); return { approved:true,hash:current.hash };
  }
  if (p.action === 'effect') {
    requireThat(current.planValue.execute,403,'execution not in plan');
    const approval: any = db.prepare('SELECT * FROM approvals WHERE job=?').get(row.id);
    requireThat(approval?.hash === current.hash,403,'governance approval absent'); allowed(approval.actor,current.planValue);
    const prior: any = db.prepare('SELECT * FROM effects WHERE job=?').get(row.id);
    if (prior?.receipt) return { receipt:JSON.parse(prior.receipt),replayed:true };
    const found = await provider('lookup',current);
    // Lookup is an await boundary: recheck fencing and identities before dispatch.
    lease(a,p); allowed(approval.actor,current.planValue);
    if (prior && !found.found) throw new Denied(409,'pending external outcome requires governed reconciliation');
    transaction(() => { lease(a,p); allowed(approval.actor,current.planValue);
      charge(current,'effect',2); db.prepare("INSERT OR IGNORE INTO effects VALUES(?,?,'pending',NULL)").run(row.id,row.hash); audit('effect_admitted',row.id,a.id,{hash:row.hash}); });
    const result = found.found ? found : await provider('send',current);
    requireThat(result.found && result.source_run === row.id,503,'external receipt missing');
    if (crashAfterProvider) process.exit(74);
    // Record a receipt even if authorization changes after external admission.
    transaction(() => { db.prepare("UPDATE effects SET state='confirmed',receipt=? WHERE job=?").run(encode(result),row.id); audit('effect_receipted',row.id,a.id,{ reconciled:found.found, receipt:result.receipt }); });
    lease(a,p); return { receipt:result,replayed:found.found };
  }
  if (p.action === 'finish') {
    return transaction(() => {
      lease(a,p);
      const fresh = job(row.id); if (fresh.result) return JSON.parse(fresh.result);
      const reads = db.prepare('SELECT capability,snapshot FROM reads WHERE job=? ORDER BY capability').all(row.id) as any[];
      requireThat(reads.length === fresh.planValue.capabilities.length,409,'specialist evidence incomplete');
      const effect: any = db.prepare('SELECT receipt FROM effects WHERE job=?').get(row.id);
      requireThat(!fresh.planValue.execute || effect?.receipt,409,'receipt required before completion');
      const result = { job:row.id, planHash:row.hash, strategy:fresh.planValue.strategy, evidence:reads.map(x => ({ capability:x.capability,snapshot:JSON.parse(x.snapshot) })),
        receipt:effect?.receipt ? JSON.parse(effect.receipt) : null, kind:brain?'native_knowledge_with_deterministic_coordination':'deterministic_qualification_not_llm_advice' };
      db.prepare("UPDATE jobs SET state='completed',result=? WHERE id=?").run(encode(result),row.id); audit('completed',row.id,a.id); return result;
    });
  }
  throw new Denied(400,'unknown action');
}
function inventory(){
  const state:any={};
  for(const table of ['principals','grants','jobs','approvals','charges','reads','effects','audit'])
    state[table]=(db.prepare('SELECT * FROM '+table).all() as any[]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  if(c.retained){const tombstones=db.prepare('SELECT * FROM retained_tombstones ORDER BY operation_id').all();if(tombstones.length)state.retained_tombstones=tombstones;}
  if(c.brain)for(const table of ['brain_releases','brain_control'])state[table]=db.prepare('SELECT * FROM '+table+' ORDER BY id').all();
  if(c.detachedInference)state.inference_requests=db.prepare('SELECT * FROM inference_requests ORDER BY id').all();
  const sourceDb=new DatabaseSync(c.editorial,{readOnly:true});
  try{for(const table of ['drafts','canonical','audit'])state['canonical_'+table]=(sourceDb.prepare('SELECT * FROM '+table).all() as any[]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));}
  finally{sourceDb.close();}
  return state;
}
const brain=c.brain?new Brain(db,{...c.brain,installation:c.installation}):null;
const inference=c.detachedInference?new Inference(c.detachedInference===true?c.brain:c.detachedInference):null;
const retained=c.retained ? new Retained(db,{...c.retained,installation:c.installation},inventory,id=>provider('lookup',job(id)),inference):null;
const initial=retained ? await retained.initialize():{current:true};
function authorizeCached(a:Actor,p:any,response:any){
  if(p.action==='create'){const existing=job(response.id);requireThat(existing.owner===a.id,403,'request owner required');requireThat(existing.state!=='closed_unknown'&&!db.prepare('SELECT 1 FROM retained_tombstones WHERE job=?').get(response.id),409,'request_id closed unknown; explicit new intent required');allowed(a.id,existing.planValue);}
  else if(['read','read_prepare','read_commit','renew','effect','finish'].includes(p.action))lease(a,p);
  else if(['approve','revoke','fence','editorial'].includes(p.action))board(a);
}
const server = createServer(async (req,res) => {
  try {
    requireThat(req.method === 'POST' && req.url === '/rpc',404,'route unavailable');
    const actor = identity((req.headers.authorization || '').replace(/^Bearer /,''));
    let raw = ''; for await (const chunk of req) { raw += chunk; requireThat(Buffer.byteLength(raw) <= 16384,413,'request too large'); }
    const payload=JSON.parse(raw);
    if(brain&&!['brain_prepare','brain_commit','brain_status','brain_checkpoint','brain_open','editorial','retained_bind_backup'].includes(payload.action)&&!String(payload.action).startsWith('recovery_'))await brain.all();
    const run=(input:any,receipt?:any)=>retained?retained.run(actor,input,p=>rpc(actor,p,receipt),(p,r)=>authorizeCached(actor,p,r)):rpc(actor,input,receipt);
    let result:any;
    if(inference&&payload.action==='read'){
      fields(payload,['action','job','worker','epoch','capability']);
      const prepared:any=await run({...payload,action:'read_prepare'});
      if(prepared.completed)result=prepared.snapshot;
      else{await inference.obtain(prepared,()=>{lease(actor,payload);});result=await commitRead({...payload,action:'read_commit'});}
    }else if(inference&&payload.action==='read_commit')result=await commitRead(payload);
    else result=await run(payload);
    async function commitRead(input:any){
      fields(input,['action','job','worker','epoch','capability']);
      lease(actor,input);
      const prepared:any=db.prepare('SELECT * FROM inference_requests WHERE job=? AND capability=?').get(input.job,input.capability);
      requireThat(prepared,409,'inference admission required');
      const receipt=inference!.verify(prepared,await inference!.call('inference_lookup',prepared.id));
      return run(input,receipt);
    }
    res.writeHead(200,{'content-type':'application/json'}).end(encode(result));
  } catch(e) {
    if (!(e instanceof Denied)) console.error(encode({ event:'qualification_internal_error',name:e instanceof Error ? e.name : 'unknown',message:e instanceof Error ? e.message : String(e),stack:e instanceof Error ? e.stack : null }));
    const status = e instanceof Denied || e instanceof RetainedError ? e.status : 503;
    res.writeHead(status,{'content-type':'application/json'}).end(encode({ error:e instanceof Denied || e instanceof RetainedError ? e.message : 'operation failed; retry with reconciliation' }));
  }
});
server.listen(0,'127.0.0.1',() => console.log(encode({ ready:true,port:(server.address() as any).port,retained:initial })));
