import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,cpSync,mkdtempSync,existsSync,unlinkSync} from "node:fs";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
import {createConnection} from "node:net";
import postgres from "../vendor/paperclip/packages/db/node_modules/postgres/src/index.js";
const root=resolve("poc"),evidence=JSON.parse(readFileSync(join(root,"evidence/live-e2e.json"),"utf8"));
const dataDir=resolve(evidence.home,"db"),backup=mkdtempSync(join(root,"restore-db-"));
assert.ok(dataDir.startsWith(root+"\\")&&backup.startsWith(root+"\\"));
const ctl=resolve("vendor/paperclip/node_modules/.pnpm/@embedded-postgres+windows-x64@18.1.0-beta.16/node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe");
const result:any={scope:"real embedded PostgreSQL, cold physical copy after process exit, same host/version, WAL recovery if needed; no secrets or storage backup validation",source:dataDir,backup};
try{
 const stop=spawnSync(ctl,["-D",dataDir,"-m","fast","-w","stop"],{encoding:"utf8",windowsHide:true,timeout:30000});result.originalStop={code:stop.status,output:stop.stdout+stop.stderr};
 let stalePid=false;
 if(existsSync(join(dataDir,"postmaster.pid"))){
   const lines=readFileSync(join(dataDir,"postmaster.pid"),"utf8").split(/\r?\n/);const pid=Number(lines[0]),port=Number(lines[3]);
   assert.equal(port,54339);let alive=false;try{process.kill(pid,0);alive=true;}catch(error:any){assert.equal(error.code,"ESRCH");}assert.equal(alive,false);
   await new Promise<void>((accept,reject)=>{const socket=createConnection({host:"127.0.0.1",port});socket.once("connect",()=>{socket.destroy();reject(new Error("source database still listens"));});socket.once("error",(error:any)=>{if(error.code==="ECONNREFUSED")accept();else reject(error);});});
   stalePid=true;result.stalePid={pid,port,verifiedProcessAbsent:true,verifiedPortRefused:true};
 }
 assert.ok(stop.status===0||stalePid,"no safe proof that source stopped");
 cpSync(dataDir,backup,{recursive:true});
 if(stalePid)unlinkSync(join(backup,"postmaster.pid")); // only the copied marker, after proving source process/port absent
 const start=spawnSync(ctl,["-D",backup,"-l",join(root,"evidence/restore-postgres.log"),"-o","-p 54349 -h 127.0.0.1","-w","start"],{encoding:"utf8",windowsHide:true,timeout:30000});result.restoreStart={code:start.status,output:start.stdout+start.stderr};assert.equal(start.status,0);
 const sql=postgres("postgres://paperclip:paperclip@127.0.0.1:54349/paperclip",{max:1});
 try{
  const issue=await sql`select id,status from issues where id=${evidence.issueId}`;
  const run=await sql`select id,status,usage_json from heartbeat_runs where id=${evidence.run.id}`;
  assert.equal(issue[0]?.status,"done");assert.equal(run[0]?.status,"succeeded");
  result.issue=issue[0];result.run=run[0];result.result="PASS";
 }finally{await sql.end();}
}catch(error){result.result="FAIL";result.error=String(error);process.exitCode=1;}
finally{
 const stopped=spawnSync(ctl,["-D",backup,"-m","fast","-w","stop"],{encoding:"utf8",windowsHide:true,timeout:30000});result.restoreStop={code:stopped.status,output:stopped.stdout+stopped.stderr};
 writeFileSync(join(root,"evidence/postgres-restore.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
