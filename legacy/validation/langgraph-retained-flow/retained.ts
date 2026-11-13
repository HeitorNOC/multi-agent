/** Retained audit/budget boundary; does not schedule LangGraph work. */
import { createHash,createHmac,createPublicKey,randomUUID,verify as verifySignature } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import {discoverUnknown,inspectInference,commitInference} from './inference_recovery.ts';
import {recoveryQueue} from './recovery_queue.ts';

export const canonical=(value:any):string => {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value!==null && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
};
export const hash=(value:any)=>createHash('sha256').update(canonical(value)).digest('hex');
export class RetainedError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
function check(ok:any,message:string):asserts ok {if(!ok)throw new RetainedError(503,message);}
export function verifyProof(proof:any,publicHex:string,installation:string,nonce:string,now=Date.now()/1000){
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicHex,'hex')]),format:'der',type:'spki'});
  check(typeof proof.payload_json==='string' && typeof proof.operations_json==='string','canonical authority wire fields missing');
  check(canonical(JSON.parse(proof.payload_json))===canonical(proof.payload),'signed payload differs from decoded payload');
  check(verifySignature(null,Buffer.from(proof.payload_json),key,Buffer.from(proof.signature,'hex')),'authority signature invalid');
  const p=proof.payload;
  check(p.installation===installation && p.nonce===nonce && Math.abs(now-p.issued)<=30,'authority nonce/time/installation invalid');
  check(canonical(JSON.parse(proof.operations_json))===canonical(p.operations),'operations differ from signed payload');
  check(p.seq===p.operations.length && createHash('sha256').update(proof.operations_json).digest('hex')===p.head && p.operations.every((r:any,i:number)=>r.seq===i+1),'authority completeness invalid');
  return p;
}
type Config={url:string;secret:string;public:string;installation:string;scope:string;commitLeaseMs?:number;commitWaitMs?:number};
export class Retained {
  db:DatabaseSync;c:Config;inventory:()=>any;effectLookup:((job:string)=>Promise<any>)|undefined;inference:any;crash=false;crashTarget='*';crashStage='before_local';recoveryCrash=false;recoveryCrashStage='after_local';
  constructor(db:DatabaseSync,c:Config,inventory:()=>any,effectLookup?:((job:string)=>Promise<any>),inference?:any){
    this.db=db;this.c=c;this.inventory=inventory;this.effectLookup=effectLookup;this.inference=inference;
    db.exec(`CREATE TABLE IF NOT EXISTS retained_receipts(seq INTEGER PRIMARY KEY,id TEXT UNIQUE,kind TEXT,body TEXT,sha TEXT);
      CREATE TABLE IF NOT EXISTS retained_lock(id INTEGER PRIMARY KEY,owner TEXT,until_ms INTEGER);
      CREATE TABLE IF NOT EXISTS retained_tombstones(operation_id TEXT PRIMARY KEY,job TEXT UNIQUE,owner TEXT,evidence_sha TEXT,reason TEXT,prepared_by TEXT,confirmed_by TEXT);
      INSERT OR IGNORE INTO retained_lock VALUES(1,NULL,0);`);
  }
  async request(input:any){
    const nonce=randomUUID(),payload={...input,nonce,issued:Date.now()/1000},raw=canonical(payload);
    let response:Response;
    try { response=await fetch(this.c.url,{method:'POST',body:raw,signal:AbortSignal.timeout(4000),headers:{'content-type':'application/json',
      'x-signature':createHmac('sha256',Buffer.from(this.c.secret,'hex')).update(raw).digest('hex')}}); }
    catch {throw new RetainedError(503,'retained authority unavailable; fenced');}
    if(!response.ok){ const text=await response.text();throw new RetainedError(text.includes('cap exhausted')?429:503,'retained authority rejected: '+text.slice(0,120)); }
    return verifyProof(await response.json(),this.c.public,this.c.installation,nonce);
  }
  local(){return this.db.prepare('SELECT * FROM retained_receipts ORDER BY seq').all() as any[];}
  async requireCurrent(){
    const proof=await this.request({action:'proof'}),local=this.local();
    check(proof.operations.length===local.length,'retained history ahead of local backup or operation pending');
    for(let i=0;i<local.length;i++){
      const row=local[i],remote=proof.operations[i];
      check(row.seq===remote.seq && row.id===remote.id && row.kind===remote.kind && hash(JSON.parse(row.body))===row.sha && row.sha===remote.receipt_sha,'retained receipt mismatch');
    }
    if(local.length)check(JSON.parse(local.at(-1).body).after===hash(this.inventory()),'local inventory differs from retained receipt');
    return proof;
  }
  async lock(){
    const owner=randomUUID(),deadline=Date.now()+(this.c.commitWaitMs??10000);
    while(Date.now()<deadline){
      const changed=this.db.prepare('UPDATE retained_lock SET owner=?,until_ms=? WHERE id=1 AND (owner IS NULL OR until_ms<?)').run(owner,Date.now()+(this.c.commitLeaseMs||30000),Date.now());
      if(changed.changes)return owner;
      await delay(10);
    }
    throw new RetainedError(503,'retained commit lane busy');
  }
  unlock(owner:string){this.db.prepare('UPDATE retained_lock SET owner=NULL,until_ms=0 WHERE id=1 AND owner=?').run(owner);}
  assertLock(owner:string){
    const lock=this.db.prepare('SELECT owner,until_ms FROM retained_lock WHERE id=1').get() as any;
    check(lock.owner===owner && lock.until_ms>Date.now(),'retained commit lane expired; fenced');
  }
  async finish(ticket:any,body:any,owner:string){
    const text=canonical(body),sha=hash(body);
    this.assertLock(owner);
    this.db.prepare('INSERT INTO retained_receipts VALUES(?,?,?,?,?)').run(ticket.seq,ticket.id,ticket.kind,text,sha);
    if(this.crash&&this.crashStage==='after_receipt'&&ticket.kind==='business_'+this.crashTarget)process.exit(83);
    await this.request({action:'complete',id:ticket.id,receipt_sha:sha});
  }
  async initialize(){
    try{const proof=await this.request({action:'proof'});if(proof.seq>0){await this.requireCurrent();return {current:true};}}
    catch(error){return {current:false,reason:error instanceof Error?error.message:String(error)};}
    const owner=await this.lock();
    try {
      const proof=await this.request({action:'proof'});
      if(proof.seq===0 && this.local().length===0){
        const before=hash(this.inventory()),id=this.c.installation+':bootstrap';
        const opened=await this.request({action:'begin',id,kind:'business_bootstrap',input_sha:before,context:{installation:this.c.installation}});
        const ticket=opened.operations.find((r:any)=>r.id===id);
        await this.finish(ticket,{response:{initialized:true},status:200,before,after:before},owner);
      }
      await this.requireCurrent();return {current:true};
    } catch(error){return {current:false,reason:error instanceof Error?error.message:String(error)};}
    finally{this.unlock(owner);}
  }
  governor(actor:any,operation:any){
    const current=this.db.prepare('SELECT * FROM principals WHERE id=?').get(actor.id) as any;
    if(actor.role!=='board'||!current?.enabled||current.role!=='board'||actor.id===operation.context.owner)
      throw new RetainedError(403,'independent current governance identity required');
    for(const source of operation.context.sources||[])
      if(!this.db.prepare('SELECT 1 FROM grants WHERE principal=? AND source=?').get(actor.id,source))
        throw new RetainedError(403,'current source access required for recovery reviewer');
  }
  async inspectEffect(proof:any,local:any[],operation:any,baseline:string){
    const inventory=this.inventory(),prepared=local.length===proof.operations.length;
    const reconstructed=structuredClone(inventory),id=operation.context.job;
    const row=prepared?local.at(-1):null,body=row?JSON.parse(row.body):null,response=body?.response;
    const job=reconstructed.jobs.find((r:any)=>r.id===id);
    check(job && job.owner===operation.context.owner,'effect job missing or owner changed');
    if(prepared){
      check(row.id===operation.id && row.kind===operation.kind && row.sha===hash(body) && body.status===200 && body.after===hash(inventory) && body.before===baseline && response?.kind==='reconciled_effect','local effect result is not a prepared reconciliation');
      check(response.operation_id===operation.id&&response.job===id&&response.owner===operation.context.owner,'prepared effect input mismatch');
      check(response.lease_before && canonical(Object.keys(response.lease_before).sort())===canonical(['deadline','epoch','worker']) && job.epoch===response.lease_before.epoch+1 && job.worker===null && job.deadline===0,'prepared effect fencing mismatch');
      job.epoch=response.lease_before.epoch;job.worker=response.lease_before.worker;job.deadline=response.lease_before.deadline;
      const audit=reconstructed.audit.filter((r:any)=>r.job===id&&r.event==='recovery_effect_reconciled');
      check(audit.length===1 && audit[0].actor===response.approvers[1] && audit[0].payload===canonical({operation_id:operation.id,evidence_sha:response.evidence_sha,approvers:response.approvers,receipt:response.receipt.receipt}),'effect reconciliation audit mismatch');
      reconstructed.audit=reconstructed.audit.filter((r:any)=>r.seq!==audit[0].seq);
      const effect=reconstructed.effects.find((r:any)=>r.job===id);
      check(effect?.state==='confirmed' && hash(JSON.parse(effect.receipt))===hash(response.receipt),'prepared external receipt mismatch');
      effect.state='pending';effect.receipt=null;
    }
    const admitted=hash(reconstructed);
    const effect=reconstructed.effects.filter((r:any)=>r.job===id);
    const charge=reconstructed.charges.filter((r:any)=>r.job===id&&r.step==='effect');
    const audit=reconstructed.audit.filter((r:any)=>r.job===id&&r.event==='effect_admitted');
    check(effect.length===1&&effect[0].state==='pending'&&effect[0].receipt===null&&effect[0].hash===job.hash&&charge.length===1&&charge[0].units===2&&audit.length===1,'effect admission evidence incomplete');
    reconstructed.effects=reconstructed.effects.filter((r:any)=>r.job!==id);
    reconstructed.charges=reconstructed.charges.filter((r:any)=>!(r.job===id&&r.step==='effect'));
    reconstructed.audit=reconstructed.audit.filter((r:any)=>r.seq!==audit[0].seq);
    job.spent-=2;
    check(hash(reconstructed)===baseline,'unrelated changes prevent effect reconciliation');
    check(this.effectLookup,'trusted receipt lookup unavailable');
    const receipt=await this.effectLookup(id);
    check(receipt?.found===true&&receipt.source_run===id&&receipt.deliveries===1&&typeof receipt.receipt==='string'&&receipt.receipt.length>0,'external receipt not verified; effect remains uncertain');
    check(hash(this.inventory())===hash(inventory),'inventory changed during external receipt lookup');
    const evidence=hash({operation,prefix:local[operation.seq-2]?.sha,inventory:admitted,receipt_sha:hash(receipt)});
    const votes=(proof.recovery_votes||[]).filter((v:any)=>v.operation_id===operation.id);
    if(prepared)check(response.evidence_sha===evidence&&response.inventory_admitted===admitted&&hash(response.receipt)===hash(receipt)&&response.approvers.length===2&&new Set(response.approvers).size===2&&response.approvers.every((id:string)=>votes.some((v:any)=>v.actor===id&&v.evidence_sha===evidence&&v.reason===response.reason)),'prepared effect lacks matching votes and provider receipt');
    return {proof,operation,mode:prepared?'prepared':'effect_receipt',evidence,votes,prepared:prepared?{row,body}:null,receipt,admitted};
  }
  async inspectRecovery(actor:any,caseId?:string){
    const proof=await this.request({action:'proof'}),local=this.local();
    const pending=proof.operations.filter((r:any)=>r.receipt_sha===null);
    if(pending.length===0&&this.inference)return discoverUnknown(this,actor,proof,local,caseId);
    check(pending.length===1 && pending[0].seq===proof.seq,'recovery requires a single trailing pending operation');
    const operation=pending[0];this.governor(actor,operation);
    if(caseId&&caseId!==(operation.context.inference?.id||operation.id))throw new RetainedError(409,'selected recovery case differs from pending operation');
    check(['business_create','business_effect','business_read_commit','business_inference_close'].includes(operation.kind)&&operation.context.owner&&operation.context.job,'operation has no qualified recovery procedure');
    const prefix=proof.operations.slice(0,-1);
    check(local.length===prefix.length||local.length===proof.operations.length,'restore is missing completed history; cannot reconcile by guessing');
    for(let i=0;i<prefix.length;i++){
      const r=local[i],remote=prefix[i];
      check(r && r.id===remote.id && r.seq===remote.seq && r.kind===remote.kind && hash(JSON.parse(r.body))===r.sha && r.sha===remote.receipt_sha,'recovery prefix differs from retained history');
    }
    const baseline=prefix.length?JSON.parse(local[prefix.length-1].body).after:null;
    check(baseline===operation.context.before,'pending intent does not extend the verified local prefix');
    if(operation.kind==='business_effect')return this.inspectEffect(proof,local,operation,baseline);
    if(['business_read_commit','business_inference_close'].includes(operation.kind))return inspectInference(this,proof,local,operation,baseline);
    const inventory=this.inventory(),current=hash(inventory);
    const votes=(proof.recovery_votes||[]).filter((v:any)=>v.operation_id===operation.id);
    let mode='unchanged',evidence=hash({operation,prefix:local[prefix.length-1]?.sha,inventory:baseline}),prepared:any=null;
    if(local.length===proof.operations.length){
      const row=local.at(-1),body=JSON.parse(row.body),response=body.response;
      check(row.id===operation.id && row.kind===operation.kind && row.sha===hash(body) && body.status===409 && body.after===current && body.before===baseline && response?.kind==='closed_unknown','unverified local result cannot be converted into unknown closure');
      check(response.operation_id===operation.id && response.job===operation.context.job && response.owner===operation.context.owner,'prepared closure input mismatch');
      const tombstone=this.db.prepare('SELECT * FROM retained_tombstones WHERE operation_id=?').get(operation.id) as any;
      check(tombstone && tombstone.job===response.job && tombstone.owner===response.owner && tombstone.evidence_sha===response.evidence_sha && tombstone.reason===response.reason && tombstone.prepared_by===response.approvers[0] && tombstone.confirmed_by===response.approvers[1],'prepared tombstone mismatch');
      const stripped=structuredClone(inventory);
      stripped.retained_tombstones=(stripped.retained_tombstones||[]).filter((r:any)=>r.operation_id!==operation.id);
      if(!stripped.retained_tombstones.length)delete stripped.retained_tombstones;
      check(hash(stripped)===baseline,'unrelated local changes prevent recovery');
      check(response.approvers.length===2&&new Set(response.approvers).size===2&&response.approvers.every((id:string)=>votes.some((v:any)=>v.actor===id&&v.evidence_sha===response.evidence_sha&&v.reason===response.reason)),'prepared closure lacks two retained votes');
      mode='prepared';evidence=response.evidence_sha;prepared={row,body};
    } else {
      check(current===baseline,'local changes or partial commit require another reconciliation procedure');
      check(!this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(operation.context.job),'local job exists; admission cannot be guessed absent');
    }
    return {proof,operation,mode,evidence,votes,prepared,receipt:null,admitted:baseline};
  }
  async recovery(actor:any,p:any){
    const keys:Record<string,string[]>={recovery_queue:['action'],recovery_inspect:['action','case_id'],recovery_fault:['action','stage'],
      recovery_propose:['action','case_id','operation_id','evidence_sha','reason'],recovery_confirm:['action','case_id','operation_id','evidence_sha']};
    if(!keys[p.action]||Object.keys(p).some(k=>!keys[p.action].includes(k)))throw new RetainedError(400,'recovery contract');
    if(actor.role!=='board')throw new RetainedError(403,'governance required');
    if(p.case_id!==undefined&&(typeof p.case_id!=='string'||p.case_id.length<8||p.case_id.length>300))throw new RetainedError(400,'invalid recovery case');
    if(p.action==='recovery_queue')return recoveryQueue(this,actor);
    if(p.action==='recovery_confirm'){
      const proof=await this.request({action:'proof'}),operation=proof.operations.find((r:any)=>r.id===p.operation_id);
      if(['closed_unknown','reconciled_effect','reconciled_read'].includes(operation?.outcome)){
        if(p.case_id&&p.case_id!==(operation.context.inference?.id||operation.id))throw new RetainedError(409,'confirmation case differs');
        this.governor(actor,operation);await this.requireCurrent();
        const row=this.db.prepare('SELECT body FROM retained_receipts WHERE id=?').get(operation.id) as any;
        const body=JSON.parse(row.body),response=body.response;
        if(response.evidence_sha!==p.evidence_sha||response.approvers[1]!==actor.id)throw new RetainedError(403,'original second reviewer required for confirmation replay');
        return response;
      }
    }
    const inspected=await this.inspectRecovery(actor,p.case_id);
    const detail=inspected as any,reference=detail.input?.reference;
    if(p.action==='recovery_inspect')return {installation_id:this.c.installation,case_id:inspected.operation.context.inference?.id||inspected.operation.id,operation_id:inspected.operation.id,job:inspected.operation.context.job,owner:inspected.operation.context.owner,
      operation_kind:inspected.operation.kind,confirmation_actor:inspected.prepared?.body.response.approvers[1]||null,evidence_sha:inspected.evidence,mode:inspected.mode,votes:inspected.votes,budgets:inspected.proof.budgets,
      evidence_summary:{inference_id:inspected.operation.context.inference?.id||null,input_sha:inspected.operation.context.inference?.input_sha||null,
        baseline_inventory_sha:inspected.operation.context.before,provider_state:inspected.receipt?.state||null,
        verified_receipt_sha:inspected.receipt?.state==='complete'||inspected.receipt?.found===true?hash(inspected.receipt):null,
        terminal_marker_sha:inspected.receipt?.state==='closed_unknown'?hash(inspected.receipt):null,read_already_committed:detail.committed??null,
        sources:reference?[{source:reference.source,version:reference.version,content_sha:reference.content_sha}]:inspected.operation.context.sources.map((source:string)=>({source,version:null,content_sha:null})),
        reserved_units:detail.job?.reserved??null,spent_units:detail.job?.spent??null,reservation_policy:'retained_not_refunded',automatic_regeneration:false}};
    if(p.action==='recovery_fault'){
      if(p.stage!==undefined&&!['after_local','after_provider'].includes(p.stage))throw new RetainedError(400,'unsupported recovery fault stage');
      if(p.stage==='after_provider'&&inspected.mode!=='inference_unknown')throw new RetainedError(400,'provider closure fault requires unknown inference');
      this.recoveryCrash=true;this.recoveryCrashStage=p.stage||'after_local';return {armed:true,stage:this.recoveryCrashStage};
    }
    if(p.operation_id!==inspected.operation.id||p.evidence_sha!==inspected.evidence)throw new RetainedError(409,'current exact recovery evidence required');
    if(p.action==='recovery_propose'){
      if(typeof p.reason!=='string'||p.reason.length<20||p.reason.length>500)throw new RetainedError(400,'review reason required');
      if(inspected.votes.some((v:any)=>v.evidence_sha!==p.evidence_sha||v.reason!==p.reason))throw new RetainedError(409,'retained review evidence and reason are immutable');
      if((inspected as any).candidate){
        const owner=await this.lock();
        try{
          const current=await this.inspectRecovery(actor,p.case_id);
          check((current as any).candidate&&current.operation.id===p.operation_id&&current.evidence===p.evidence_sha,'unknown recovery candidate changed');
          await this.request({action:'begin',id:current.operation.id,kind:current.operation.kind,input_sha:current.operation.input_sha,context:current.operation.context});
        }finally{this.unlock(owner);}
      }
      const proof=await this.request({action:'recovery_vote',id:p.operation_id,actor:actor.id,evidence_sha:p.evidence_sha,reason:p.reason});
      return {proposed:true,actor:actor.id,votes:proof.recovery_votes.filter((v:any)=>v.operation_id===p.operation_id)};
    }
    const owner=await this.lock();
    try{
      const state=await this.inspectRecovery(actor,p.case_id);
      if(state.evidence!==p.evidence_sha)throw new RetainedError(409,'recovery evidence changed');
      let response:any;
      if(state.prepared){
        response=state.prepared.body.response;
        if(response.approvers[1]!==actor.id)throw new RetainedError(403,'original second reviewer required');
        this.governor({id:response.approvers[0],role:'board'},state.operation);
      } else {
        const first=state.votes.find((v:any)=>v.actor!==actor.id&&v.evidence_sha===state.evidence);
        if(!first)throw new RetainedError(403,'second independent reviewer required');
        this.governor({id:first.actor,role:'board'},state.operation);
        await this.request({action:'recovery_vote',id:p.operation_id,actor:actor.id,evidence_sha:p.evidence_sha,reason:first.reason});
        const verified=await this.inspectRecovery(actor,p.case_id);
        check(verified.mode===state.mode && ['unchanged','effect_receipt','read_receipt','inference_unknown'].includes(verified.mode) && verified.evidence===p.evidence_sha,'state changed during recovery review');
        const common={operation_id:p.operation_id,job:state.operation.context.job,owner:state.operation.context.owner,
          evidence_sha:p.evidence_sha,reason:first.reason,approvers:[first.actor,actor.id],reservation:'retained_not_refunded'};
        const currentJob=this.db.prepare('SELECT epoch,worker,deadline FROM jobs WHERE id=?').get(common.job) as any;
        response=['read_receipt','inference_unknown'].includes(state.mode)?{...common,kind:state.mode==='read_receipt'?'reconciled_read':'closed_inference_unknown',receipt:state.mode==='read_receipt'?verified.receipt:await this.inference.closeUnknown((verified as any).request),
          job_before:{epoch:(verified as any).job.epoch,worker:(verified as any).job.worker,deadline:(verified as any).job.deadline,state:(verified as any).job.state},original_outcome:state.mode==='inference_unknown'?'unknown_not_reexecuted':'known_receipt_recovered'}:
          state.mode==='effect_receipt'?{...common,kind:'reconciled_effect',receipt:verified.receipt,replayed:true,inventory_admitted:verified.admitted,lease_before:currentJob}:
          {...common,kind:'closed_unknown',original_outcome:'unknown_not_reexecuted'};
        if(this.recoveryCrash&&this.recoveryCrashStage==='after_provider')process.exit(79);
        this.assertLock(owner);this.db.exec('BEGIN IMMEDIATE');
        try{
          check(hash(this.inventory())===(['effect_receipt','read_receipt','inference_unknown'].includes(state.mode)?verified.admitted:state.operation.context.before),'inventory changed before recovery commit');
          if(['read_receipt','inference_unknown'].includes(state.mode))commitInference(this,verified,response,actor);
          else if(state.mode==='effect_receipt'){
            this.db.prepare("UPDATE effects SET state='confirmed',receipt=? WHERE job=?").run(JSON.stringify(verified.receipt),response.job);
            this.db.prepare('UPDATE jobs SET epoch=epoch+1,worker=NULL,deadline=0 WHERE id=?').run(response.job);
            this.db.prepare('INSERT INTO audit(event,job,actor,payload) VALUES(?,?,?,?)').run('recovery_effect_reconciled',response.job,actor.id,canonical({operation_id:p.operation_id,evidence_sha:p.evidence_sha,approvers:response.approvers,receipt:verified.receipt.receipt}));
          }else this.db.prepare('INSERT INTO retained_tombstones VALUES(?,?,?,?,?,?,?)').run(p.operation_id,response.job,response.owner,p.evidence_sha,first.reason,first.actor,actor.id);
          const body={response,status:['effect_receipt','read_receipt'].includes(state.mode)?200:409,before:state.operation.context.before,after:hash(this.inventory())};
          this.db.prepare('INSERT OR REPLACE INTO retained_receipts VALUES(?,?,?,?,?)').run(state.operation.seq,state.operation.id,state.operation.kind,canonical(body),hash(body));
          this.db.exec('COMMIT');
        }catch(error){this.db.exec('ROLLBACK');throw error;}
        if(this.recoveryCrash&&this.recoveryCrashStage==='after_local')process.exit(78);
      }
      const receipt=this.db.prepare('SELECT sha FROM retained_receipts WHERE id=?').get(p.operation_id) as any;
      this.assertLock(owner);
      await this.request({action:response.kind==='reconciled_effect'?'reconcile_effect':response.kind==='reconciled_read'?'reconcile_read':'resolve_unknown',id:p.operation_id,receipt_sha:receipt.sha,approvers:response.approvers});
      await this.requireCurrent();return response;
    }finally{this.unlock(owner);}
  }
  async run(actor:any,p:any,execute:(p:any)=>Promise<any>,authorizeCached:(p:any,response:any)=>void){
    if(p.action?.startsWith('recovery_'))return this.recovery(actor,p);
    if(p.action==='retained_status'){
      check(actor.role==='board','governance required');
      try{const proof=await this.requireCurrent();return {current:true,seq:proof.seq,head:proof.head,budgets:proof.budgets};}
      catch(error){return {current:false,reason:error instanceof Error?error.message:String(error)};}
    }
    const owner=await this.lock();
    try {
      await this.requireCurrent();
      if(p.action==='retained_bind_backup'){
        if(actor.role!=='board'||Object.keys(p).some(k=>!['action','id','manifest_sha','snapshot_sha'].includes(k)))throw new RetainedError(403,'backup witness governance contract');
        const state=this.inventory(),control=state.brain_control?.[0];
        check(control?.frozen===1&&control.snapshot_sha===p.snapshot_sha,'brain must be frozen at the requested snapshot');
        const proof=await this.requireCurrent();
        return this.request({action:'backup_witness',id:p.id,manifest_sha:p.manifest_sha,head:proof.head,inventory_sha:hash(state),snapshot_sha:p.snapshot_sha});
      }
      if(p.action==='retained_fault') {check(actor.role==='board','governance required');this.crash=true;this.crashTarget=p.target||'*';this.crashStage=p.stage||'before_local';return {armed:true};}
      if(['status','state','approval','quote','brain_status','brain_prepare'].includes(p.action))return execute(p);
      const normalized={...p};
      if(['read','read_prepare','effect','finish'].includes(p.action)){delete normalized.worker;delete normalized.epoch;}
      const input={actor:actor.id,payload:normalized};
      const id=this.c.installation+':'+hash(input);
      const cached=this.db.prepare('SELECT body FROM retained_receipts WHERE id=?').get(id) as any;
      if(cached){const body=JSON.parse(cached.body);if(body.status!==200)throw new RetainedError(body.status,'previous operation rejected or closed unknown');authorizeCached(p,body.response);return body.response;}
      const before=hash(this.inventory());
      let quote:any;
      if(p.action==='create'){
        check(typeof p.request_id==='string','stable request_id required');
        quote=await execute({...p,action:'quote'});
      }
      const existing=p.job ? this.db.prepare('SELECT owner,plan FROM jobs WHERE id=?').get(p.job) as any:null;
      const plan=quote?.plan || (existing?JSON.parse(existing.plan):null);
      const request:any=p.action==='read_commit'?this.db.prepare('SELECT * FROM inference_requests WHERE job=? AND capability=?').get(p.job,p.capability):null;
      const context={actor:actor.id,owner:plan?.owner||actor.id,action:p.action,job:p.job||quote?.id||null,before,sources:plan?.references.map((r:any)=>r.source)||[],
        ...(request?{inference:{id:request.id,capability:request.capability,input_sha:createHash('sha256').update(request.input_json).digest('hex')}}:{})};
      const opened=quote ? await this.request({action:'reserve_job',id,scope:this.c.scope,units:quote.plan.reservedUnits,input_sha:hash({input,before}),context}) :
        await this.request({action:'begin',id,kind:'business_'+p.action,input_sha:hash({input,before}),context});
      const ticket=opened.operations.find((r:any)=>r.id===id);
      if(this.crash && this.crashStage==='before_local' && (this.crashTarget==='*'||this.crashTarget===p.action))process.exit(77);
      this.assertLock(owner);
      let response:any,status=200,error:any;
      try{response=await execute(p);}catch(e){error=e;status=typeof (e as any)?.status==='number'?(e as any).status:503;response={error:'operation rejected'};}
      // Unknown provider outcomes stay pending. A snapshot cannot override them.
      if(status>=500)throw error;
      if(this.crash&&this.crashStage==='after_business'&&this.crashTarget===p.action)process.exit(82);
      await this.finish(ticket,{response,status,before,after:hash(this.inventory())},owner);
      if(error)throw error;
      return response;
    } finally{this.unlock(owner);}
  }
}
