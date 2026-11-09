import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {RecoveryAPI,RecoveryError} from '../../demo/recovery.ts';
function setup(){const db=new DatabaseSync(':memory:'),reviewers=[{id:'one',label:'Local one',credential:'fixture-one'},{id:'two',label:'Local two',credential:'fixture-two'}];const calls:any[]=[];const api=new RecoveryAPI(db,'fixture',reviewers,async p=>{calls.push(p);return {ok:true,result:{installation_id:'fixture',cases:[],history:[]}};},()=>{});return {db,api,reviewers,calls};}
test('sessão é opaca, isolada e perde validade após rotação de credencial',async()=>{
 const {db,api,reviewers,calls}=setup();const login=await api.handle('POST','/api/recovery/session',{credential:'fixture-one'},{});
 assert.match(login.cookie!,/HttpOnly/);assert.match(login.cookie!,/SameSite=Strict/);assert.match(login.cookie!,/Path=\/api\/recovery/);
 const cookie=login.cookie!.split(';')[0],token=cookie.split('=')[1];assert.notEqual((db.prepare('SELECT hash FROM recovery_sessions').get() as any).hash,token);
 await api.handle('GET','/api/recovery/cases',{}, {cookie});assert.equal(calls[0].reviewer,'one');
 await assert.rejects(()=>api.handle('POST','/api/recovery/inspect',{case_id:'fixture-case',reviewer:'two'},{cookie}),e=>e instanceof RecoveryError&&e.status===400);
 reviewers[0].credential='rotated';assert.equal((await api.handle('GET','/api/recovery/session',{}, {cookie})).body.authenticated,false);db.close();
});
test('ponte configurada para outra instalação é recusada',async()=>{
 const {db,api}=setup();const login=await api.handle('POST','/api/recovery/session',{credential:'fixture-one'},{});api.bridge=async()=>({ok:true,result:{installation_id:'foreign',cases:[],history:[]}});
 await assert.rejects(()=>api.handle('GET','/api/recovery/cases',{}, {cookie:login.cookie!.split(';')[0]}),e=>e instanceof RecoveryError&&e.status===503);db.close();
});
test('cookie de outra instalação não identifica o revisor',async()=>{
 const {db,api,reviewers}=setup();const login=await api.handle('POST','/api/recovery/session',{credential:'fixture-one'},{});
 const otherDB=new DatabaseSync(':memory:'),other=new RecoveryAPI(otherDB,'other-installation',reviewers,async()=>({ok:true,result:{}}),()=>{});
 assert.equal((await other.handle('GET','/api/recovery/session',{}, {cookie:login.cookie!.split(';')[0]})).body.authenticated,false);otherDB.close();db.close();
});
