/** Real HTTP/Python/SQLite, explicitly controlled worker, zero models. */
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdirSync} from 'node:fs';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'../..');
test('aprovação, evento e recibo persistem após queda 88 e restart da API; um efeito',async()=>{
 const backend=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);res.setHeader('content-type','application/json');res.end(JSON.stringify(p.action==='status'?{phase:'ready',sources:[],usage:{calls:0}}:{}));});
 backend.listen(0,'127.0.0.1');await once(backend,'listening');
 const state=join(here,'.state','api-effect-'+randomUUID());mkdirSync(state,{recursive:true});
 const config={state,root,backend:'http://127.0.0.1:'+(backend.address() as any).port,token:'controlled-effect-test-token',python:join(root,'validation/integrated-pilot/.venv/Scripts/python.exe'),worker:join(here,'fixture_demo_worker.py')};
 let child:any,url='';
 async function start(){child=spawn(process.execPath,[join(root,'demo/server.ts')],{windowsHide:true,stdio:['pipe','pipe','pipe']});let err='';child.stderr.on('data',(b:any)=>err+=b);let output='';const ready=new Promise<string>((resolve,reject)=>{child.stdout.on('data',(b:any)=>{output+=b;try{resolve(JSON.parse(output.trim()).url);}catch{}});child.once('exit',(code:any)=>reject(Error('server '+code+' '+err)));});child.stdin.end(JSON.stringify(config));url=await ready;}
 const post=(path:string,body:any)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 async function idle(id:string){for(let i=0;i<150;i++){const s=await(await fetch(url+'/api/state')).json() as any;const j=s.jobs.find((x:any)=>x.id===id);if(j&&!j.worker_active)return j;await delay(20);}throw Error('worker timeout');}
 try{
  await start();const {id}=await(await post('/api/jobs',{})).json() as any;
  let job=await idle(id);assert.equal(job.status,'awaiting_approval');assert.equal(job.receipt,null);
  assert.equal((await post('/api/jobs/'+id+'/approve',{hash:'wrong'})).status,409);
  await post('/api/jobs/'+id+'/approve',{hash:job.review.hash,crash_after_effect:true});job=await idle(id);assert.equal(job.status,'interrupted');const receipt=job.receipt.id;
  child.kill();await once(child,'exit');await start();await post('/api/jobs/'+id+'/resume',{});job=await idle(id);
  assert.equal(job.status,'completed');assert.equal(job.receipt.id,receipt);
  await post('/api/jobs/'+id+'/resume',{});job=await idle(id);assert.equal(job.receipt.id,receipt);
  assert.equal(job.events.filter((e:any)=>e.node==='human_approved').length,1);
  const receipts=job.events.filter((e:any)=>e.node==='effect_receipt');assert.equal(receipts.filter((e:any)=>!e.detail.replayed).length,1);assert.ok(receipts.some((e:any)=>e.detail.replayed));
  const trace=await(await fetch(url+'/api/jobs/'+id+'/trace')).json() as any;assert.equal(new Set(trace.events.map((e:any)=>e.event_id)).size,trace.events.length);
 }finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}await new Promise<void>(resolve=>backend.close(()=>resolve()));}
});
