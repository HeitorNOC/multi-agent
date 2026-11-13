import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream,writeFileSync,mkdirSync,mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve,join } from "node:path";
import { createInterface } from "node:readline";
const root=resolve("poc"), upstream=resolve("vendor/paperclip");
const home=mkdtempSync(join(root,"live-home-"));
const api="http://127.0.0.1:3200";
const key=randomBytes(32).toString("hex");
const config={"$meta":{version:1,updatedAt:new Date().toISOString(),source:"configure"},database:{mode:"embedded-postgres",embeddedPostgresDataDir:join(home,"db"),embeddedPostgresPort:54339,backup:{enabled:false,dir:join(home,"backups")}},logging:{mode:"file",logDir:join(home,"logs")},server:{host:"127.0.0.1",port:3200,serveUi:false,deploymentMode:"local_trusted",exposure:"private"},telemetry:{enabled:false},updates:{checkEnabled:false},storage:{provider:"local_disk",localDisk:{baseDir:join(home,"storage")}},secrets:{provider:"local_encrypted",localEncrypted:{keyFilePath:join(home,"secrets","master.key")}}};
writeFileSync(join(home,"config.json"),JSON.stringify(config,null,2));
const env={...process.env,PAPERCLIP_HOME:home,PAPERCLIP_CONFIG:join(home,"config.json"),PAPERCLIP_TELEMETRY_DISABLED:"1",PAPERCLIP_MANAGED_RUNTIME_HTTPS:"off",PAPERCLIP_AGENT_JWT_SECRET:randomBytes(32).toString("hex"),POC_SIGNING_KEY:key,HOST:"127.0.0.1",PORT:"3200",SERVE_UI:"false",LANGSMITH_TRACING:"false",LANGCHAIN_TRACING_V2:"false"};
const log=createWriteStream(join(root,"evidence/live-server.log"));
const cp=spawn(process.execPath,["--import","./server/node_modules/tsx/dist/loader.mjs","server/src/index.ts"],{cwd:upstream,env,stdio:["pipe","pipe","pipe"],windowsHide:true});
cp.stdout.pipe(log);cp.stderr.pipe(log);
let worker:ReturnType<typeof spawn>|undefined;
const evidence:any={mode:"real Paperclip + external adapter + real LangGraph + real LightRAG; deterministic fixture vectors; no paid model",home};
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function request(path:string,method="GET",body?:any,token?:string){const res=await fetch(api+"/api"+path,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}); const text=await res.text();let data:any;try{data=JSON.parse(text)}catch{data={text}};if(!res.ok)throw new Error(`${method} ${path}: ${res.status} ${text}`);return data;}
try{
  let ready=false;for(let n=0;n<90;n++){try{evidence.health=await request("/health");ready=true;break;}catch{if(cp.exitCode!==null)throw new Error("Paperclip exited during startup");await pause(1000);}}
  assert.ok(ready,"Paperclip startup deadline exceeded");
  const a=await request("/companies","POST",{name:"Audit synthetic A"});const b=await request("/companies","POST",{name:"Audit synthetic B"});evidence.companies=[a.id,b.id];
  const runtimeLog=createWriteStream(join(root,"evidence/live-runtime.log"));
  worker=spawn(join(root,".venv/Scripts/python.exe"),[join(root,"runtime.py")],{cwd:root,env:{...env,POC_COMPANY_A:a.id,PYTHONIOENCODING:"utf-8"},stdio:["pipe","pipe","pipe"],windowsHide:true});
  worker.stderr.pipe(runtimeLog);
  const runtimePort=await new Promise<number>((accept,reject)=>{const timer=setTimeout(()=>reject(new Error("runtime ready deadline exceeded")),30000);createInterface({input:worker!.stdout!}).on("line",line=>{try{const obj=JSON.parse(line);if(obj.ready){clearTimeout(timer);accept(obj.port);}}catch{runtimeLog.write(line+"\n");}});worker!.once("exit",code=>reject(new Error(`runtime exited ${code}`)));});
  evidence.plugin=await request("/adapters/install","POST",{packageName:join(root,"adapter"),isLocalPath:true});
  const agent=await request(`/companies/${a.id}/agents`,"POST",{name:"Synthetic runtime bridge",role:"ceo",adapterType:"poc_langgraph",runner:"legacy",adapterConfig:{url:`http://127.0.0.1:${runtimePort}/execute`,fixtureApproved:true,callbackBaseUrl:api},runtimeConfig:{heartbeat:{enabled:false}},permissions:{canCreateAgents:false}});evidence.agentId=agent.id;
  await request(`/companies/${a.id}`,"PATCH",{requireBoardApprovalForNewAgents:true});
  try{await request(`/companies/${a.id}/agents`,"POST",{name:"Unapproved permanent",adapterType:"http",adapterConfig:{url:"http://127.0.0.1:1"}});throw new Error("hire unexpectedly allowed");}catch(e){assert.match(String(e),/409/);evidence.permanentHireWithoutApproval="denied 409";}
  const credentials=await request(`/agents/${agent.id}/keys`,"POST",{name:"temporary synthetic audit"});const token=credentials.token??credentials.key;
  assert.equal(typeof token,"string","key response token field");
  try{await request(`/companies/${b.id}/agents`,"GET",undefined,token);throw new Error("cross-company unexpectedly allowed");}catch(e){assert.match(String(e),/403/);evidence.crossCompany="denied 403";}
  const issue=await request(`/companies/${a.id}/issues`,"POST",{title:"Explain synthetic sales decline with sources",status:"backlog",assigneeAgentId:agent.id});evidence.issueId=issue.id;
  await request(`/issues/${issue.id}`,"PATCH",{status:"todo"});
  let run:any;
  for(let n=0;n<75;n++){const rows=await request(`/companies/${a.id}/heartbeat-runs?agentId=${agent.id}`); const runs=Array.isArray(rows)?rows:rows.items??rows.runs??[];run=runs.find((x:any)=>x.agentId===agent.id);if(run&&["succeeded","failed","cancelled","timed_out"].includes(run.status))break;await pause(1000);}
  evidence.run=run;
  const finalIssue=await request(`/issues/${issue.id}`);evidence.issueStatus=finalIssue.status;
  assert.equal(run?.status,"succeeded");assert.equal(finalIssue.status,"done");
  const detail=await request(`/heartbeat-runs/${run.id}`);evidence.runDetail=detail;
  await request(`/agents/${agent.id}/keys/${credentials.id}`,"DELETE");
  try{await request(`/companies/${a.id}/agents`,"GET",undefined,token);throw new Error("revoked key accepted");}catch(e){assert.match(String(e),/401/);evidence.revokedToken="denied 401";}
  evidence.result="PASS";
}catch(error){evidence.result="FAIL";evidence.error=String(error);process.exitCode=1;}
finally{
  writeFileSync(join(root,"evidence/live-e2e.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  worker?.kill();cp.kill();log.end();
}
