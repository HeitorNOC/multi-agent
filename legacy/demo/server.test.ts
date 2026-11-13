/** HTTP admission/policy regression. Stub runtime refuses worker config; zero LLM. */
import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {once} from 'node:events';import {randomUUID} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
test('HTTP: origem, token interno e falha de admissão não liberam efeitos nem bloqueiam próximo pedido',async()=>{
 const backend=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);res.setHeader('content-type','application/json');if(p.action==='status')res.end(JSON.stringify({phase:'ready',sources:[],usage:{calls:0}}));else{res.statusCode=409;res.end(JSON.stringify({error:'runtime controlado indisponível'}));}});
 backend.listen(0,'127.0.0.1');await once(backend,'listening');const port=(backend.address() as any).port;
 const state=join(here,'.state','http-test-'+randomUUID());mkdirSync(state,{recursive:true});
 const child=spawn(process.execPath,[join(here,'server.ts')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let errors='';child.stderr.on('data',b=>errors+=b.toString());
 const ready=new Promise<string>((resolve,reject)=>{let out='';child.stdout.on('data',b=>{out+=b;try{resolve(JSON.parse(out.trim()).url);}catch{}});child.on('exit',code=>reject(Error('server exited '+code+': '+errors)));});
 child.stdin.end(JSON.stringify({state,root:dirname(here),backend:'http://127.0.0.1:'+port,token:'http-test-only-token',python:'unused'}));
 try{
  const url=await ready;
  const post=(path:string,body:any,headers:any={})=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post('/api/jobs',{}, {Origin:'https://untrusted.example'})).status,409);
  assert.equal((await post('/internal/effect',{job:'nonexistent',hash:'bad'})).status,403);
  for(let i=0;i<2;i++)assert.equal((await post('/api/jobs',{})).status,409);
  const s=await(await fetch(url+'/api/state')).json() as any;
  assert.equal(s.jobs.length,2);assert.ok(s.jobs.every((j:any)=>j.status==='failed'&&!j.receipt));
  const job=s.jobs[0].id,body={job,node:'retrieval_completed',event_id:'http-exact-event-001',detail:{capability:'one',prompt:'private-test-content'}};
  const headers={'x-demo-token':'http-test-only-token'};
  assert.equal((await post('/internal/event',body,headers)).status,200);
  assert.equal((await(await post('/internal/event',body,headers)).json() as any).replayed,true);
  assert.equal((await post('/internal/event',{...body,detail:{capability:'changed'}},headers)).status,409);
  const trace=await(await fetch(url+'/api/jobs/'+job+'/trace')).json() as any;
  assert.equal(trace.events.filter((e:any)=>e.event_id===body.event_id).length,1);assert.equal(trace.read_only,true);
  assert.doesNotMatch(JSON.stringify(trace),/private-test-content/);
 }finally{child.kill();await once(child,'exit');await new Promise<void>(resolve=>backend.close(()=>resolve()));}
});
