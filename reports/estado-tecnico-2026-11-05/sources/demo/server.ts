import http from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import * as miniPolicy from './policy.ts';

let input='';for await(const c of process.stdin)input+=c;
const config=JSON.parse(input),here=dirname(fileURLToPath(import.meta.url));
// Only the trusted local launcher selects a profile; HTTP clients cannot import code.
const policy:any=config.policyModule?await import(config.policyModule):miniPolicy;
const {GOAL,validatePlan,reviewable,authorize}=policy,uiDir=config.uiDir||here;
mkdirSync(config.state,{recursive:true});
const db=new DatabaseSync(join(config.state,'journey.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT,review TEXT,approval TEXT,receipt TEXT,error TEXT,created TEXT);
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,at TEXT,node TEXT,detail TEXT);
 CREATE TABLE IF NOT EXISTS effects(job TEXT PRIMARY KEY,hash TEXT NOT NULL,receipt TEXT NOT NULL);`);
// A server restart never guesses whether a previous worker finished.
db.prepare("UPDATE jobs SET status='interrupted',error='Servidor reiniciado; consulte o checkpoint com Retomar' WHERE status='running'").run();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs((1)) WHERE status IN ('created','running')");
const active=new Map<string,any>();let api='';
function row(id:string){const r=db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as any;if(!r)throw Error('Trabalho não encontrado');return r;}
function event(id:string,node:string,detail:any){db.prepare('INSERT INTO events(job,at,node,detail) VALUES(?,?,?,?)').run(id,new Date().toISOString(),node,JSON.stringify(detail));}
function snapshot(id:string){const r=row(id);return {...r,plan:r.plan?JSON.parse(r.plan):null,review:r.review?JSON.parse(r.review):null,receipt:r.receipt?JSON.parse(r.receipt):null,approval:!!r.approval,worker_active:active.has(id),events:db.prepare('SELECT seq,at,node,detail FROM events WHERE job=? ORDER BY seq').all(id).map((e:any)=>({...e,detail:JSON.parse(e.detail)}))};}
async function backend(action:string,extra:any={}){const res=await fetch(config.backend+'/rpc',{method:'POST',headers:{'content-type':'application/json','x-demo-token':config.token},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(360000)});const data=await res.json();if(!res.ok)throw Error(data.error||'Runtime indisponível');return data;}
function tokenOK(value:string){const a=Buffer.from(value||''),b=Buffer.from(config.token);return a.length===b.length&&timingSafeEqual(a,b);}
async function startWorker(id:string,crash=false){
  const job=row(id);if(active.has(id))throw Error('Já existe um worker ativo');
  const c=await backend('worker_config');
  if(active.has(id))throw Error('Já existe um worker ativo');
  if(row(id).status==='rejected')throw Error('Trabalho rejeitado enquanto aguardava o runtime');
  db.prepare("UPDATE jobs SET status='running',error=NULL WHERE id=?").run(id);
  const child=spawn(config.python,[config.worker||join(here,'worker.py')],{cwd:config.root,windowsHide:true,env:{...process.env,LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'},stdio:['pipe','pipe','pipe']});
  active.set(id,child);event(id,'worker_started',{pid:child.pid});let output='',err='';
  child.stdout.on('data',b=>{output+=b.toString();if(output.length>200000)output=output.slice(-200000);});
  child.stderr.on('data',b=>{err+=b.toString();if(err.length>2000)err=err.slice(-2000);});
  child.on('error',()=>{active.delete(id);db.prepare("UPDATE jobs SET status='failed',error='Não foi possível iniciar worker' WHERE id=?").run(id);});
  child.on('close',code=>{
    active.delete(id);event(id,'worker_stopped',{pid:child.pid,exit_code:code});
    if(code!==0){db.prepare('UPDATE jobs SET status=?,error=? WHERE id=?').run(code===88?'interrupted':'failed',code===88?'Interrupção de teste após recibo; retome para conciliar.':'Worker falhou; veja o registro local. Não há sucesso presumido.',id);return;}
    try{const result=JSON.parse(output.trim().split('\n').at(-1)!);db.prepare('UPDATE jobs SET status=?,error=NULL WHERE id=?').run(result.completed?'completed':'awaiting_approval',id);}
    catch{db.prepare("UPDATE jobs SET status='failed',error='Worker terminou sem resposta verificável' WHERE id=?").run(id);}
  });
  child.stdin.end(JSON.stringify({...c,api,token:config.token,job:id,goal:job.goal,crash_after_effect:crash}));
}
function effect(id:string,hash:string){
  db.exec('BEGIN IMMEDIATE');
  try{
    const r=row(id),review=r.review&&JSON.parse(r.review);authorize(review,r.approval,hash);
    const existing=db.prepare('SELECT hash,receipt FROM effects WHERE job=?').get(id) as any;
    if(existing&&existing.hash!==hash)throw Error('Intenção divergente');
    const receipt=existing?JSON.parse(existing.receipt):{id:randomUUID(),job:id,hash,simulated:true,recipient:review.payload.recipient,content:review.payload.content,created:new Date().toISOString()};
    if(!existing)db.prepare('INSERT INTO effects VALUES(?,?,?)').run(id,hash,JSON.stringify(receipt));
    db.prepare('UPDATE jobs SET receipt=? WHERE id=?').run(JSON.stringify(receipt),id);db.exec('COMMIT');
    event(id,'effect_receipt',{id:receipt.id,replayed:!!existing,simulated:true});return receipt;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
  function send(data:any,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  try{
    if(req.headers.host!==new URL(api||'http://127.0.0.1:1').host)throw Error('Host inválido');
    const path=new URL(req.url!,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(readFileSync(join(uiDir,'index.html')));return;}
    if(req.method==='GET'&&path==='/app.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(readFileSync(join(uiDir,'dist/app.js')));return;}
    if(req.method==='GET'&&path==='/app.css'){res.writeHead(200,{'content-type':'text/css'});res.end(readFileSync(join(uiDir,'dist/app.css')));return;}
    let body:any={};if(req.method==='POST'){
      if(req.headers['content-type']!=='application/json')throw Error('JSON obrigatório');
      if(req.headers.origin&&req.headers.origin!==api)throw Error('Origem inválida');
      let raw='';for await(const b of req){raw+=b;if(raw.length>20000)throw Error('Payload excedido');}body=JSON.parse(raw||'{}');
    }
    if(path.startsWith('/internal/')){
      if(!tokenOK(String(req.headers['x-demo-token']||'')))return send({error:'Acesso interno negado'},403);
      if(req.method!=='POST')return send({error:'POST obrigatório'},405);
      const id=body.job;if(!id)throw Error('Trabalho ausente');row(id);
      if(path==='/internal/snapshot')return send(snapshot(id));
      if(path==='/internal/event'){event(id,body.node,body.detail);return send({ok:true});}
      if(path==='/internal/plan'){
        const p=validatePlan(body.plan,row(id).goal);const r=row(id);if(r.plan&&r.plan!==JSON.stringify(p))throw Error('Plano já vinculado');
        db.prepare('UPDATE jobs SET plan=? WHERE id=?').run(JSON.stringify(p),id);event(id,'plan',p);return send(p);
      }
      if(path==='/internal/review'){
        const review=reviewable(id,body.report,row(id).goal),r=row(id);if(r.review&&r.review!==JSON.stringify(review))throw Error('Síntese original já vinculada');
        db.prepare('UPDATE jobs SET review=? WHERE id=?').run(JSON.stringify(review),id);event(id,'review_ready',{hash:review.hash,model_approval_mismatch:body.report.requires_approval!==true});return send(review);
      }
      if(path==='/internal/effect')return send(effect(id,body.hash));
      throw Error('Operação interna desconhecida');
    }
    if(req.method==='GET'&&path==='/api/state')return send({runtime:await backend('status'),jobs:db.prepare('SELECT id FROM jobs ORDER BY created DESC').all().map((r:any)=>snapshot(r.id)),goal:GOAL});
    if(req.method==='POST'&&path==='/api/jobs'){
      const status=await backend('status');if(status.phase!=='ready')return send({error:'Conhecimento ainda está sendo preparado'},409);
      // One bounded synthetic journey, not an unrestricted prompt/agent console.
      const goal=policy.chooseGoal?policy.chooseGoal(body):GOAL;
      if(!policy.chooseGoal&&body.goal!==undefined&&body.goal!==GOAL)throw Error('Esta demonstração aceita somente o pedido fictício exibido');
      if(active.size)throw Error('Aguarde o trabalho em execução');
      const id=randomUUID();db.prepare('INSERT INTO jobs(id,goal,status,created) VALUES(?,?,?,?)').run(id,goal,'created',new Date().toISOString());event(id,'admission',{goal});
      try{await startWorker(id);}catch(error){db.prepare("UPDATE jobs SET status='failed',error='Runtime indisponível na admissão; retome quando estiver disponível' WHERE id=?").run(id);throw error;}
      return send({id},201);
    }
    const match=path.match(/^\/api\/jobs\/([\w-]+)\/(approve|reject|resume)$/);
    if(req.method==='POST'&&match){
      const [,id,operation]=match,r=row(id);if(active.has(id))return send({error:'Worker ainda está ativo'},409);
      if(operation==='approve'||operation==='reject'){
        if(r.status!=='awaiting_approval'||!r.review||body.hash!==JSON.parse(r.review).hash)return send({error:'Plano alterado ou não está aguardando aprovação'},409);
        if(operation==='reject'){db.prepare("UPDATE jobs SET status='rejected',approval=NULL WHERE id=?").run(id);event(id,'human_rejected',{hash:body.hash});return send(snapshot(id));}
        db.prepare('UPDATE jobs SET approval=? WHERE id=?').run(body.hash,id);event(id,'human_approved',{hash:body.hash,actor:'operador-local-demo'});
      }
      if(r.status==='rejected')return send({error:'Trabalho rejeitado'},409);
      await startWorker(id,operation==='approve'&&body.crash_after_effect===true);return send({id});
    }
    send({error:'Rota não encontrada'},404);
  }catch(error){send({error:error instanceof Error?error.message:'Falha'},409);}
});
server.listen(config.port||0,'127.0.0.1',()=>{api='http://127.0.0.1:'+(server.address() as any).port;console.log(JSON.stringify({ready:true,url:api}));});
process.on('SIGTERM',()=>{for(const child of active.values())child.kill();server.close();});
