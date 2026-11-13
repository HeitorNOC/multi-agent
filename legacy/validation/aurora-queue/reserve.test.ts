import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('new admissions cannot take the last two places reserved for existing jobs',async()=>{
  const backend=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const status=JSON.parse(raw).action==='status';
    res.writeHead(status?200:503,{'content-type':'application/json'});
    res.end(JSON.stringify(status?{phase:'ready'}:{error:'worker paused by test'}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const address=backend.address();assert.ok(address&&typeof address==='object');
  const root=process.cwd(),state=join(root,'validation/aurora-queue/.state','reserve-'+randomUUID());
  mkdirSync(state,{recursive:true});
  const child=spawn(process.execPath,[join(root,'demo/server.ts')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.resume();
  const listening=new Promise<string>((resolve,reject)=>{
    let raw='';
    child.stdout.on('data',chunk=>{
      raw+=chunk;
      if(raw.includes('\n'))resolve(JSON.parse(raw.split('\n')[0]).url);
    });
    child.once('exit',code=>reject(new Error('API exited: '+code)));
  });
  child.stdin.end(JSON.stringify({state,root,backend:'http://127.0.0.1:'+address.port,token:'reserve-fixture',queueCapacity:8,resumeReserve:2}));
  try{
    const url=await listening;
    const post=(path:string,body:object,key?:string)=>fetch(url+path,{method:'POST',
      headers:{'content-type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
    const keys=Array.from({length:6},()=>randomUUID()),ids:string[]=[];
    for(const key of keys){
      const response=await post('/api/jobs',{},key);
      assert.equal(response.status,202);
      ids.push((await response.json() as {id:string}).id);
    }
    const overflow=await post('/api/jobs',{},randomUUID());
    assert.equal(overflow.status,429);
    assert.match((await overflow.json() as {error:string}).error,/reservadas/);
    assert.equal(overflow.headers.get('Retry-After'),'2');
    const db=new DatabaseSync(join(state,'journey.sqlite'));
    try{
      const seed=db.prepare('INSERT INTO jobs(id,goal,status,review,created) VALUES(?,?,?,?,?)');
      seed.run('review-a','fixture','awaiting_approval',JSON.stringify({hash:'right-a'}),new Date().toISOString());
      seed.run('resume-b','fixture','interrupted',null,new Date().toISOString());
      seed.run('review-c','fixture','awaiting_approval',JSON.stringify({hash:'right-c'}),new Date().toISOString());
      assert.equal((await post('/api/jobs/review-a/approve',{hash:'wrong'})).status,409);
      assert.equal((await post('/api/jobs/review-a/approve',{hash:'right-a'})).status,202);
      assert.equal((await post('/api/jobs/resume-b/resume',{})).status,202);
      assert.equal((await post('/api/jobs/review-c/approve',{hash:'right-c'})).status,429);
      assert.equal((await post('/api/jobs/review-a/approve',{hash:'right-a'})).status,202);
      const replay=await post('/api/jobs',{},keys[0]);
      assert.equal(replay.status,202);
      assert.deepEqual(await replay.json(),{id:ids[0],status:'queued',replayed:true});
      assert.deepEqual(db.prepare('SELECT job FROM job_queue ORDER BY seq').all().map(row=>row.job),[...ids,'review-a','resume-b']);
      assert.equal(db.prepare("SELECT approval FROM jobs WHERE id='review-c'").get()?.approval,null);
      const snapshot=await (await fetch(url+'/api/state')).json() as {queue:unknown};
      assert.deepEqual(snapshot.queue,{capacity:8,pending:8,running:0,max_workers:1,new_capacity:6,new_pending:6,resume_reserve:2});
    }finally{db.close();}
  }finally{
    if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}
    await new Promise<void>(resolve=>backend.close(()=>resolve()));
  }
});
