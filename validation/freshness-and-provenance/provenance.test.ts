import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalBasis} from './provenance.ts';
const snapshot={found:true,source:'s',version:1,valid_at:'2026-01-01T00:00:00Z',known_at:'2026-11-01T12:00:00Z',content:'Sem datas no corpo',content_sha:createHash('sha256').update('Sem datas no corpo').digest('hex')};
const query={source:'s',as_of:'2026-02-01T00:00:00Z',known_at:'2026-11-02T00:00:00Z'};
test('vigência e publicação são distintas e não inferidas do conteúdo',()=>{
  const b=canonicalBasis(snapshot,query);assert.equal(b.valid_from,snapshot.valid_at);assert.equal(b.published_at,snapshot.known_at);assert.notEqual(b.valid_from,b.published_at);
});
test('conteúdo adulterado ou snapshot fora dos cortes é recusado',()=>{
  assert.throws(()=>canonicalBasis({...snapshot,content:'alterado'},query));
  assert.throws(()=>canonicalBasis(snapshot,{...query,source:'outro'}));
  assert.throws(()=>canonicalBasis(snapshot,{...query,as_of:'2025-01-01T00:00:00Z'}));
  assert.throws(()=>canonicalBasis(snapshot,{...query,known_at:'2026-10-01T00:00:00Z'}));
  assert.throws(()=>canonicalBasis(snapshot,{...query,as_of:'2026-02-01T00:00:00'}));
});
