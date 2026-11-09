import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { execute } from '../temporal-editorial/editorial.ts';

test('canonical historical read succeeds while another connection holds an uncommitted editorial write',() => {
  const root=resolve('validation/langgraph-business-flow/.state/read-regression-'+randomUUID());
  const vault=resolve(root,'vault'); mkdirSync(vault,{recursive:true});
  writeFileSync(resolve(vault,'note.md'),'---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nApproved original.');
  const config={db:resolve(root,'canonical.sqlite'),vault,key:'12'.repeat(32),installation:'read-regression',actor:{id:'author',role:'analyst'}};
  const board={...config,actor:{id:'reviewer',role:'board'}};
  const draft=execute(config,{action:'submit',path:'note.md'});
  execute(board,{action:'review',id:draft.id,raw_sha:draft.raw_sha});
  const published=execute(board,{action:'commit',id:draft.id,receipt:{synthetic:true}});
  const writer=new DatabaseSync(config.db);
  try {
    writer.exec("BEGIN IMMEDIATE; UPDATE drafts SET content='Uncommitted changed text' WHERE source='politica-remoto'");
    const result=execute(config,{action:'canonical_asof',source:'politica-remoto',as_of:'2026-11-01T00:00:00Z',known_at:published.known_at});
    assert.equal(result.content,'Approved original.');
    assert.equal(result.version,1);
  } finally { writer.exec('ROLLBACK'); writer.close(); }
});

test('concurrent canonical readers return the committed snapshot without transient write-lock errors',async () => {
  const root=resolve('validation/langgraph-business-flow/.state/read-concurrency-'+randomUUID());
  const vault=resolve(root,'vault'); mkdirSync(vault,{recursive:true});
  writeFileSync(resolve(vault,'note.md'),'---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nApproved original.');
  const config={db:resolve(root,'canonical.sqlite'),vault,key:'12'.repeat(32),installation:'read-regression',actor:{id:'author',role:'analyst'}};
  const board={...config,actor:{id:'reviewer',role:'board'}};
  const draft=execute(config,{action:'submit',path:'note.md'});
  execute(board,{action:'review',id:draft.id,raw_sha:draft.raw_sha});
  const published=execute(board,{action:'commit',id:draft.id,receipt:{synthetic:true}});
  const payload={action:'canonical_asof',source:'politica-remoto',as_of:'2026-11-01T00:00:00Z',known_at:published.known_at};
  const run=()=>new Promise<any>((resolve,reject) => {
    const worker=new Worker(new URL('./editorial_read_worker.ts',import.meta.url),{workerData:{config,payload,count:200}});
    worker.once('message',resolve); worker.once('error',reject);
  });
  const results=await Promise.all([run(),run()]);
  assert.deepEqual(results.flatMap(x=>x.errors),[]);
});
