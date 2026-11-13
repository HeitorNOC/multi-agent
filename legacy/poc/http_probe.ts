import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync } from "node:fs";
import { execute } from "../vendor/paperclip/server/src/adapters/http/execute.ts";
import { guardedHttpAdapterFetch } from "../vendor/paperclip/server/src/adapters/http/remote-fetch.ts";
let effects=0, payload:any, seenHeader:string|undefined;
const server=http.createServer(async(req,res)=>{
  let raw=""; for await(const chunk of req) raw+=chunk;
  payload=JSON.parse(raw||"{}"); seenHeader=req.headers["x-test-header"] as string;
  if(req.url==="/effect") effects++;
  const status=Number(req.url?.slice(1));
  if(req.url==="/slow") await new Promise(r=>setTimeout(r,120));
  res.writeHead(Number.isFinite(status)&&status>=100?status:200,{"content-type":"application/json"});
  res.end(JSON.stringify({status:"running",usage:{inputTokens:100},costUsd:5}));
});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
process.env.PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST=origin;
const base:any={runId:"fixture-run",agent:{id:"fixture-agent",companyId:"A",name:"fixture",adapterType:"http",adapterConfig:{}},runtime:{sessionId:null,sessionParams:null,sessionDisplayId:null,taskKey:"fixture-task"},context:{taskId:"fixture-task"},onLog:async()=>{}};
const results:any[]=[];
async function test(name:string,fn:()=>Promise<any>){try{const evidence=await fn();results.push({name,result:"PASS",evidence});}catch(e){results.push({name,result:"FAIL",error:String(e)});}}
try{
  for(const status of [200,202]) await test(`HTTP ${status} acknowledged as adapter success`,async()=>{
    const value=await execute({...base,config:{url:origin+`/${status}`,headers:{"x-test-header":"synthetic"}}});
    assert.equal(value.exitCode,0); assert.equal(value.usage,undefined); assert.equal(value.costUsd,undefined);
    assert.equal(payload.companyId,undefined); assert.equal(seenHeader,"synthetic");
    return {value,companyIdAutomaticallyPresent:false,responseUsageParsed:false,externalWorkStillRunning:true};
  });
  for(const status of [400,500]) await test(`HTTP ${status} throws without retry`,async()=>{await assert.rejects(()=>execute({...base,config:{url:origin+`/${status}`}}),new RegExp(String(status)));});
  await test("timeoutMs enforced",async()=>{const value=await execute({...base,config:{url:origin+"/slow",timeoutMs:20}});assert.equal(value.timedOut,true);return value;});
  await test("timeoutSec ignored and context cancellation ignored",async()=>{const controller=new AbortController();controller.abort();const t=performance.now();const value=await execute({...base,signal:controller.signal,config:{url:origin+"/slow",timeoutSec:0.001}});assert.equal(value.exitCode,0);assert.ok(performance.now()-t>=100);return {elapsedMs:performance.now()-t,value};});
  await test("same run delivered twice duplicates naive worker side effect",async()=>{for(let i=0;i<2;i++) await execute({...base,config:{url:origin+"/effect"}});assert.equal(effects,2);return {effects,requirement:"FAIL without worker idempotency"};});
  await test("private endpoint denied without exact allowlist",async()=>{await assert.rejects(()=>guardedHttpAdapterFetch(origin,{}, {privateEndpointAllowlist:new Set()}),{code:"remote_http_private_endpoint"});});
  await test("metadata denied even allowlisted",async()=>{await assert.rejects(()=>guardedHttpAdapterFetch("http://169.254.169.254/latest/meta-data/",{},{privateEndpointAllowlist:new Set(["http://169.254.169.254"])}),{code:"remote_http_private_endpoint"});});
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
writeFileSync(new URL("./evidence/http-probe.json",import.meta.url),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2)); if(results.some(r=>r.result==="FAIL")) process.exitCode=1;
