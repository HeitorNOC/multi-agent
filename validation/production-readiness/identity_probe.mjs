import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {generateKeyPair,SignJWT,jwtVerify} from '../../vendor/paperclip/node_modules/.pnpm/jose@6.2.12/node_modules/jose/dist/webapi/index.js';
const keys={v1:await generateKeyPair('ES256'),v2:await generateKeyPair('ES256')};
const issuer='https://synthetic-identity.invalid/';
let epoch=1;const revoked=new Set();const checks=[];
const base={deployment:'installation-A',company:'A',run:'run-1',scope:['knowledge:read'],policy_epoch:1};
async function sign(patch={},header={}){return new SignJWT({...base,...patch}).setProtectedHeader({alg:'ES256',typ:'JWT',kid:'v1',...header}).setSubject('agent-1').setIssuer(issuer).setAudience('brain-api').setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+60).setJti('fixture-jti').sign(keys.v1.privateKey);}
async function verify(token,expected={deployment:'installation-A',company:'A',run:'run-1',scope:'knowledge:read'}){
 const result=await jwtVerify(token,(header)=>{
  if(header.jku||header.x5u||!keys[header.kid])throw new Error('untrusted key source');
  return keys[header.kid].publicKey;
 },{issuer,audience:'brain-api',algorithms:['ES256'],typ:'JWT',maxTokenAge:'2m',requiredClaims:['exp','iat','jti','sub']});
 const p=result.payload;
 if(p.deployment!==expected.deployment||p.company!==expected.company||p.run!==expected.run||p.policy_epoch!==epoch||revoked.has(p.jti)||!p.scope.includes(expected.scope)||expected.scope!=='knowledge:read')throw new Error('current server authorization denied');
 return p;
}
async function deny(name,action){await assert.rejects(action);checks.push({name,result:'DENIED'});}
const token=await sign();await verify(token);checks.push({name:'valid signed scoped token',result:'ALLOWED'});
await deny('wrong audience',async()=>{
 const other=await new SignJWT(base).setProtectedHeader({alg:'ES256',typ:'JWT',kid:'v1'}).setSubject('agent-1').setIssuer(issuer).setAudience('other-api').setIssuedAt().setExpirationTime('1m').setJti('x').sign(keys.v1.privateKey);await verify(other);
});
await deny('wrong issuer',async()=>{await jwtVerify(token,keys.v1.publicKey,{issuer:'https://other.invalid',audience:'brain-api',algorithms:['ES256']});});
await deny('wrong signing key',()=>jwtVerify(token,keys.v2.publicKey,{issuer,audience:'brain-api',algorithms:['ES256']}));
await deny('expired',async()=>{
 const expired=await new SignJWT(base).setProtectedHeader({alg:'ES256',typ:'JWT',kid:'v1'}).setSubject('agent-1').setIssuer(issuer).setAudience('brain-api').setIssuedAt(Math.floor(Date.now()/1000)-120).setExpirationTime(Math.floor(Date.now()/1000)-60).setJti('x').sign(keys.v1.privateKey);await verify(expired);
});
await deny('unsigned alg none',()=>verify(Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(base)).toString('base64url')+'.'));
await deny('cross installation',()=>verify(token,{deployment:'installation-B',company:'A',run:'run-1',scope:'knowledge:read'}));
await deny('cross run',()=>verify(token,{deployment:'installation-A',company:'A',run:'run-2',scope:'knowledge:read'}));
await deny('wrong scope',()=>verify(token,{deployment:'installation-A',company:'A',run:'run-1',scope:'email:send'}));
await deny('header-directed internal key fetch',async()=>verify(await sign({},{jku:'http://169.254.169.254/keys'})));
revoked.add('fixture-jti');await deny('revoked jti',()=>verify(token));revoked.clear();
epoch=2;await deny('stale policy epoch',()=>verify(token));epoch=1;
delete keys.v1;await deny('retired signing key',()=>verify(token));
const evidence={result:'PASS',library:'jose 6.2.12, already installed in audited Paperclip dependency tree',checks,
 scope:'local cryptographic verification and own policy guard; no production IdP/JWKS rotation service, OIDC login, mTLS or distributed revocation qualified'};
writeFileSync(new URL('./evidence/identity.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify({result:'PASS',checks:checks.length}));
