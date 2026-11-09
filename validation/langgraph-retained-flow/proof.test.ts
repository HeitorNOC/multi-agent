import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyProof } from './retained.ts';
const fixture=JSON.parse(readFileSync(new URL('./proof-fixture.json',import.meta.url),'utf8'));
const p=fixture.proof;
test('TypeScript accepts a real Python signature with Unicode and integer-valued floats',()=>{
  assert.equal(verifyProof(p,fixture.public,'proof-fixture','public-fixture',p.payload.issued).seq,1);
});
test('tampered payload is rejected',()=>{
  const changed=structuredClone(p);changed.payload.seq=100;
  assert.throws(()=>verifyProof(changed,fixture.public,'proof-fixture','public-fixture',p.payload.issued));
});
test('tampered canonical bytes or operations cannot be substituted',()=>{
  const changed=structuredClone(p);changed.operations_json='[]';
  assert.throws(()=>verifyProof(changed,fixture.public,'proof-fixture','public-fixture',p.payload.issued));
  const signature=structuredClone(p);signature.signature='00'.repeat(64);
  assert.throws(()=>verifyProof(signature,fixture.public,'proof-fixture','public-fixture',p.payload.issued));
});
test('nonce, installation and expiry are enforced',()=>{
  assert.throws(()=>verifyProof(p,fixture.public,'proof-fixture','different',p.payload.issued));
  assert.throws(()=>verifyProof(p,fixture.public,'another-company','public-fixture',p.payload.issued));
  assert.throws(()=>verifyProof(p,fixture.public,'proof-fixture','public-fixture',p.payload.issued+31));
});
