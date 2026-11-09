import { createHmac } from "node:crypto";
import type { AdapterExecutionContext,AdapterExecutionResult,ServerAdapterModule } from "../../vendor/paperclip/packages/adapter-utils/src/types.ts";
export async function execute(ctx:AdapterExecutionContext):Promise<AdapterExecutionResult>{
  const origin=String(ctx.config.url); const endpoint=new URL(origin);
  if(endpoint.hostname!=="127.0.0.1" || endpoint.protocol!=="http:" || endpoint.pathname!=="/execute") throw new Error("PoC permits only configured loopback executor");
  const key=process.env.POC_SIGNING_KEY; if(!key) throw new Error("ephemeral fixture key missing");
  // Identity is sourced from the authenticated host context. Fixed scopes are fixture policy, never LLM output.
  const envelope={companyId:ctx.agent.companyId,agentId:ctx.agent.id,runId:ctx.runId,taskId:String(ctx.context.issueId ?? ctx.context.taskId),scopes:["knowledge:read","email:send"],approved:ctx.config.fixtureApproved===true,issuedAt:Math.floor(Date.now()/1000)};
  const body=JSON.stringify(envelope);const signature=createHmac("sha256",Buffer.from(key,"hex")).update(body).digest("hex");
  ctx.onDispatch?.();
  const response=await fetch(endpoint,{method:"POST",body,headers:{"content-type":"application/json","x-poc-signature":signature},signal:AbortSignal.any([AbortSignal.timeout(15000),...(ctx.signal?[ctx.signal]:[])])});
  if(!response.ok) throw new Error(`Runtime rejected request: ${response.status}`);
  const result=await response.json() as any;
  if(result.status!=="completed") throw new Error("External acknowledgment is not completion");
  if(ctx.config.callbackBaseUrl && ctx.authToken){
    const base=new URL(String(ctx.config.callbackBaseUrl)); if(base.hostname!=="127.0.0.1"||base.protocol!=="http:") throw new Error("fixture callback must be loopback");
    const updated=await fetch(new URL(`/api/issues/${envelope.taskId}`,base),{method:"PATCH",headers:{"content-type":"application/json",authorization:`Bearer ${ctx.authToken}`,"x-paperclip-run-id":ctx.runId},body:JSON.stringify({status:"done"})});
    if(!updated.ok) throw new Error(`Paperclip completion rejected: ${updated.status}: ${await updated.text()}`);
  }
  return {exitCode:0,signal:null,timedOut:false,summary:"Synthetic graph and retrieval completed",usage:result.usage,usageBasis:"per_run",provider:"synthetic-fixture",model:"no-model",costUsd:0,costStatus:"reported",resultJson:{status:"completed",effects:result.effects,findings:result.findings}};
}
export function createServerAdapter():ServerAdapterModule{return {type:"poc_langgraph",execute,supportsLocalAgentJwt:true,agentConfigurationDoc:"Local experiment only; no production policy",testEnvironment:async(ctx)=>({adapterType:ctx.adapterType,status:"pass",checks:[],testedAt:new Date().toISOString()})};}
