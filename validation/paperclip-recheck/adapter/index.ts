import {createHmac} from 'node:crypto';
import type {AdapterExecutionContext,AdapterExecutionResult,ServerAdapterModule} from '../../../vendor/paperclip/packages/adapter-utils/src/types.ts';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function execute(ctx:AdapterExecutionContext):Promise<AdapterExecutionResult>{
 const url=new URL(String(ctx.config.url));
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/rpc')throw new Error('recheck permits fixture loopback RPC only');
 const key=process.env.POC_SIGNING_KEY;if(!key)throw new Error('fixture signing key missing');
 const identity={companyId:ctx.agent.companyId,agentId:ctx.agent.id,runId:ctx.runId,taskId:String(ctx.context.issueId??ctx.context.taskId),intentId:String(ctx.context.issueId??ctx.context.taskId)+':approved-email-v1',approved:ctx.config.fixtureApproved===true,delayMs:Number(ctx.config.fixtureDelayMs??100)};
 async function rpc(action:string){
  const body=JSON.stringify({...identity,action,issuedAt:Math.floor(Date.now()/1000)});
  const signature=createHmac('sha256',Buffer.from(key,'hex')).update(body).digest('hex');
  const response=await fetch(url,{method:'POST',body,headers:{'content-type':'application/json','x-poc-signature':signature},signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error(`fixture RPC ${action} rejected ${response.status}`);
  return await response.json() as any;
 }
 async function cancelled(){
  let state:any;
  for(let attempt=0;attempt<3;attempt++){
   try{state=await rpc('cancel');if(state.terminated&&['cancelled','completed','failed'].includes(state.status))break;}catch{if(attempt===2)throw new Error('remote cancellation remains unverified');}
   await pause(50);
  }
  if(!state?.terminated)throw new Error('remote execution termination not acknowledged');
  return {exitCode:0,signal:null,timedOut:false,summary:'Remote termination acknowledged',usage:state.usage,usageByModel:state.usageByModel,costUsd:state.costUsd,usageBasis:'per_run',provider:'synthetic-fixture',model:'fixture-aggregate',costStatus:'reported',resultJson:{status:'cancelled',remoteStatus:state.status,remoteTerminated:true,effectsCommitted:state.effects,executionCancellation:{state:'acknowledged',acknowledgedAt:new Date().toISOString(),proof:'fixture_runtime_termination_receipt',remoteRunId:ctx.runId}}} as AdapterExecutionResult;
 }
 // Official opt-in is essential: it lets host Stop own the signal and await settlement.
 await ctx.onCancellationReady?.();
 if(ctx.signal?.aborted)return cancelled();
 ctx.onDispatch?.();
 let state:any;
 try{
  state=await rpc('submit');
  for(let poll=0;poll<300;poll++){
   if(ctx.signal?.aborted)return await cancelled();
   if(['completed','cancelled','failed','recovery_required'].includes(state.status))break;
   await pause(40);state=await rpc('status');
  }
  if(ctx.signal?.aborted)return await cancelled();
 }catch(error){if(ctx.signal?.aborted)return await cancelled();throw error;}
 if(state.status!=='completed'||!state.terminated)throw new Error(`remote is not completed: ${state.status}`);
 const receipt={usage:state.usage,usageByModel:state.usageByModel,costUsd:state.costUsd,usageBasis:'per_run' as const,provider:'synthetic-fixture',model:'fixture-aggregate',costStatus:'reported' as const,complete:true};
 await ctx.onUsage?.(receipt);
 if(ctx.signal?.aborted)return cancelled();
 if(ctx.config.callbackBaseUrl&&ctx.authToken){
  const base=new URL(String(ctx.config.callbackBaseUrl));if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw new Error('callback fixture origin rejected');
  const updated=await fetch(new URL(`/api/issues/${identity.taskId}`,base),{method:'PATCH',headers:{'content-type':'application/json',authorization:`Bearer ${ctx.authToken}`,'x-paperclip-run-id':ctx.runId},body:JSON.stringify({status:'done'})});
  if(!updated.ok)throw new Error(`completion callback rejected ${updated.status}`);
 }
 return {exitCode:0,signal:null,timedOut:false,summary:'Graph result and synthetic usage reconciled',...receipt,usageComplete:true,resultJson:{status:'completed',remoteTerminated:true,effects:state.effects,findings:state.result?.findings}};
}
export function createServerAdapter():ServerAdapterModule{return {type:'poc_recheck',execute,supportsLocalAgentJwt:true,agentConfigurationDoc:'No-fork recheck only; synthetic effects and usage',testEnvironment:async ctx=>({adapterType:ctx.adapterType,status:'pass',checks:[],testedAt:new Date().toISOString()})};}
