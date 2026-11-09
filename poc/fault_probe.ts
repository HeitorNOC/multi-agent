import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomBytes,createHmac} from "node:crypto";
import {createInterface} from "node:readline";
import {resolve,join} from "node:path";
import {createWriteStream,writeFileSync} from "node:fs";
const root=resolve("poc"),key=randomBytes(32).toString("hex");
const log=createWriteStream(join(root,"evidence/fault-runtime.log"));
const child=spawn(join(root,".venv/Scripts/python.exe"),[join(root,"runtime.py")],{cwd:root,env:{...process.env,POC_SIGNING_KEY:key,LANGSMITH_TRACING:"false",LANGCHAIN_TRACING_V2:"false",PYTHONIOENCODING:"utf-8"},stdio:["pipe","pipe","pipe"],windowsHide:true});child.stderr.pipe(log);
const evidence:any={};
try{
 const port=await new Promise<number>((accept,reject)=>{const t=setTimeout(()=>reject(new Error("ready timeout")),30000);createInterface({input:child.stdout}).on("line",line=>{try{const d=JSON.parse(line);if(d.ready){clearTimeout(t);accept(d.port);}}catch{log.write(line+"\n")}});child.once("exit",code=>reject(new Error(`worker exited ${code}`)));});
 const url=`http://127.0.0.1:${port}/execute`;
 const principal=(runId:string)=>({companyId:"A",agentId:"fixture-agent",taskId:"fixture-task",runId,scopes:["knowledge:read","email:send"],approved:true,issuedAt:Math.floor(Date.now()/1000)});
 const send=(p:any,signal?:AbortSignal,bad=false)=>{const body=JSON.stringify(p);return fetch(url,{method:"POST",headers:{"content-type":"application/json","x-poc-signature":bad?"forged":createHmac("sha256",Buffer.from(key,"hex")).update(body).digest("hex")},body,signal});};
 const p=principal("duplicate");const responses=await Promise.all([send(p),send(p)]);assert.ok(responses.every(x=>x.ok));const data=await Promise.all(responses.map(x=>x.json())) as any[];assert.ok(data.every(x=>x.effects===1));evidence.concurrentReplay={result:"PASS",effects:1};
 assert.equal((await send({...p,taskId:"conflicting-task"})).status,409);evidence.stalePayload="denied 409";
 assert.equal((await send(principal("forged"),undefined,true)).status,403);evidence.forgedSignature="denied 403";
 const delayed={...principal("cancelled-client"),delayMs:500};
 await assert.rejects(()=>send(delayed,AbortSignal.timeout(100)));
 await new Promise(r=>setTimeout(r,800));
 const settled=await (await send(delayed)).json() as any;
 assert.equal(settled.effects,2);assert.equal(settled.status,"completed");
 evidence.cancellation={probe:"PASS: defect reproduced",requirement:"FAIL",effectAfterClientTimeout:true,totalEffects:2,reason:"client AbortSignal closes HTTP wait; runtime has no cancellation/reconciliation endpoint"};
 evidence.result="PASS diagnostics; cancellation requirement FAIL";
}catch(e){evidence.error=String(e);process.exitCode=1;}
finally{child.kill();log.end();writeFileSync(join(root,"evidence/fault-probe.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
