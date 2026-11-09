import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { execute, loadNote } from './editorial.ts';

const root=resolve('validation/temporal-editorial/.state/editorial-tests-'+randomUUID());mkdirSync(root,{recursive:true});
function setup() {
  const dir=resolve(root,randomUUID()),vault=resolve(dir,'vault');mkdirSync(vault,{recursive:true});
  const c={db:resolve(dir,'editorial.sqlite'),vault,key:randomBytes(32).toString('hex'),installation:'local-test',actor:{id:'editor',role:'analyst'}};
  const text='---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nA ACME permite dois dias remotos.';
  writeFileSync(resolve(vault,'politica.md'),text);
  const board={...c,actor:{id:'reviewer',role:'board'}};
  return {c,board,text};
}
test('editing does not publish and editor cannot self-approve',()=>{
  const {c}=setup();const d=execute(c,{action:'submit',path:'politica.md'});
  assert.equal(d.state,'draft');assert.throws(()=>execute(c,{action:'review',id:d.id,raw_sha:d.raw_sha}),/reviewer/);
  assert.throws(()=>execute({...c,actor:{...c.actor,role:'board'}},{action:'review',id:d.id,raw_sha:d.raw_sha}),/two-person/);
});
test('review binds exact bytes and rejects changed content',()=>{
  const {c,board,text}=setup();const d=execute(c,{action:'submit',path:'politica.md'});
  writeFileSync(resolve(c.vault,'politica.md'),text+' alterado');
  assert.throws(()=>execute(board,{action:'review',id:d.id,raw_sha:d.raw_sha}),/changed/);
});
test('publication requires approval and approved file must remain unchanged until preparation',()=>{
  const {c,board,text}=setup();const d=execute(c,{action:'submit',path:'politica.md'});
  assert.throws(()=>execute(board,{action:'prepare',id:d.id}),/review required/);
  execute(board,{action:'review',id:d.id,raw_sha:d.raw_sha});
  writeFileSync(resolve(c.vault,'politica.md'),text+' novo');
  assert.throws(()=>execute(board,{action:'prepare',id:d.id}),/approved file changed/);
});
test('approved publication receipt is signed and snapshot is immutable on replay',()=>{
  const {c,board,text}=setup();const d=execute(c,{action:'submit',path:'politica.md'});
  execute(board,{action:'review',id:d.id,raw_sha:d.raw_sha});const release=execute(board,{action:'prepare',id:d.id});
  assert.equal(release.signature,createHmac('sha256',Buffer.from(c.key,'hex')).update(JSON.stringify(release.payload)).digest('hex'));
  execute(board,{action:'commit',id:d.id,receipt:{episode:'synthetic'}});
  writeFileSync(resolve(c.vault,'politica.md'),text+' rascunho seguinte');
  const replay=execute(board,{action:'prepare',id:d.id});assert.equal(replay.content,release.content);assert.equal(replay.published,true);
});
test('published source/version cannot be silently overwritten',()=>{
  const {c,board,text}=setup();const d=execute(c,{action:'submit',path:'politica.md'});
  execute(board,{action:'review',id:d.id,raw_sha:d.raw_sha});execute(board,{action:'commit',id:d.id,receipt:{}});
  writeFileSync(resolve(c.vault,'politica.md'),text+' diferente');const next=execute(c,{action:'submit',path:'politica.md'});
  execute(board,{action:'review',id:next.id,raw_sha:next.raw_sha});assert.throws(()=>execute(board,{action:'prepare',id:next.id}),/collision/);
});
test('frontmatter cannot change registered classification or authorize publication',()=>{
  const {c,text}=setup();writeFileSync(resolve(c.vault,'politica.md'),text.replace('domain: publico','domain: financeiro'));
  assert.throws(()=>loadNote(c.vault,'politica.md'),/classification/);
  writeFileSync(resolve(c.vault,'politica.md'),text.replace('domain: publico','domain: publico\nstatus: approved'));
  assert.throws(()=>loadNote(c.vault,'politica.md'),/unsupported/);
});
test('restricted YAML profile rejects duplicates and vault traversal',()=>{
  const {c,text}=setup();assert.throws(()=>loadNote(c.vault,'../outside.md'),/traversal/);
  writeFileSync(resolve(c.vault,'politica.md'),text.replace('version: 1','version: 1\nversion: 2'));
  assert.throws(()=>loadNote(c.vault,'politica.md'),/duplicate/);
});
test('public editor cannot import a financial note',()=>{
  const {c,text}=setup();writeFileSync(resolve(c.vault,'politica.md'),text.replace('source: politica-remoto','source: aquisicao').replace('domain: publico','domain: financeiro'));
  assert.throws(()=>execute(c,{action:'submit',path:'politica.md'}),/private editor/);
});
test('invalid calendar dates are rejected before review or publication',()=>{
  const {c,text}=setup();writeFileSync(resolve(c.vault,'politica.md'),text.replace('2026-01-01','2026-02-31'));
  assert.throws(()=>execute(c,{action:'submit',path:'politica.md'}),/UTC validity/);
});
test('immutable canonical snapshots select valid time and prior knowledge without rewriting graph facts',()=>{
  const {c,board,text}=setup();
  function publish(version:number,valid:string,body:string) {
    writeFileSync(resolve(c.vault,'politica.md'),text.replace('version: 1','version: '+version).replace('2026-01-01T00:00:00Z',valid).replace('A ACME permite dois dias remotos.',body));
    const d=execute(c,{action:'submit',path:'politica.md'});execute(board,{action:'review',id:d.id,raw_sha:d.raw_sha});
    return execute(board,{action:'commit',id:d.id,receipt:{synthetic:true}});
  }
  publish(1,'2026-01-01T00:00:00Z','Regra original: dois dias.');
  const second=publish(2,'2026-03-01T00:00:00Z','Nova regra desde março: três dias.');
  const before=second.known_at;
  publish(3,'2026-02-01T00:00:00Z','Retificação de fevereiro: um dia; março permanece três.');
  const now=new Date(Date.now()+1000).toISOString();
  const q=(asof:string,known:string)=>execute(c,{action:'canonical_asof',source:'politica-remoto',as_of:asof,known_at:known});
  assert.equal(q('2026-02-15T00:00:00Z',before).version,1);
  assert.equal(q('2026-02-15T00:00:00Z',now).version,3);
  assert.equal(q('2026-03-15T00:00:00Z',now).version,2);
  assert.equal(q('2026-01-15T00:00:00Z',now).version,1);
  assert.equal(q('2026-02-01T00:00:00.001Z',now).version,3);
  assert.equal(q('2026-03-01T00:00:00.001Z',now).version,2);
  assert.equal(q('2025-01-01T00:00:00Z',now).found,false);
});
