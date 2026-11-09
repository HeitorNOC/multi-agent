import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {unlinkSync} from 'node:fs';
import {Events} from './telemetry.ts';
function schema(db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,job TEXT,at TEXT,node TEXT,detail TEXT)');}
test('ack perdido e restart conservam um evento; ID não aceita outro conteúdo/trabalho',()=>{
 const path=join(tmpdir(),'codex-telemetry-'+randomUUID()+'.sqlite');let db=new DatabaseSync(path);
 try{schema(db);let events=new Events(db,'fixture');events.append('job','retrieval_completed',{capability:'agent'},'event-identity-001');db.close();db=new DatabaseSync(path);events=new Events(db,'fixture');
 assert.equal(events.append('job','retrieval_completed',{capability:'agent'},'event-identity-001').replayed,true);
 assert.throws(()=>events.append('job','retrieval_completed',{capability:'other'},'event-identity-001'));
 assert.throws(()=>events.append('other','retrieval_completed',{capability:'agent'},'event-identity-001'));
 assert.equal(events.trace('job').events.length,1);
 }finally{db.close();unlinkSync(path);}
});
test('rollback da operação desfaz também seu evento',()=>{
 const db=new DatabaseSync(':memory:');schema(db);const events=new Events(db,'fixture');db.exec("CREATE TABLE jobs(id TEXT,state TEXT);INSERT INTO jobs VALUES('job','created');BEGIN IMMEDIATE");
 db.prepare("UPDATE jobs SET state='completed'").run();events.append('job','completed',{});db.exec('ROLLBACK');
 assert.equal((db.prepare('SELECT state FROM jobs').get() as any).state,'created');assert.equal(events.trace('job').events.length,0);db.close();
});
test('projeção não copia prompt, token, conteúdo ou saída de modelo',()=>{
 const db=new DatabaseSync(':memory:');schema(db);const events=new Events(db,'fixture');
 events.append('job','inference_completed',{prompt:'secret-prompt',token:'secret-token',output:{content:'secret-content'},telemetry:{model_slot:'agent:one',fact_ids:['a'.repeat(64)],evidence:[{source_id:'policy',source_hash:'b'.repeat(64),canonical_text:'secret-document'}]}});
 const trace=events.trace('job');assert.doesNotMatch(JSON.stringify(trace),/secret-/);assert.equal(trace.events[0].model_slot,'agent:one');assert.equal(trace.events[0].fact_ids.length,1);db.close();
});
test('migração conserva eventos legados e sua identidade após reabrir projeção',()=>{
 const db=new DatabaseSync(':memory:');schema(db);db.prepare('INSERT INTO events VALUES(1,?,?,?,?)').run('job','2026-11-05T00:00:00Z','plan','{}');
 const first=new Events(db,'fixture').trace('job');assert.equal(first.events[0].event_id,'legacy:fixture:1');assert.deepEqual(new Events(db,'fixture').trace('job'),first);db.close();
});
