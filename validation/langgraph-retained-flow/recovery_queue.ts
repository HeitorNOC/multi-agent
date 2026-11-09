/** Read-only recovery discovery. Authority and current grants remain in Retained. */
import {RetainedError,hash} from './retained.ts';
export async function recoveryQueue(r:any,actor:any){
 const proof=await r.request({action:'proof'}),pending=proof.operations.filter((x:any)=>x.receipt_sha===null),cases:any[]=[];
 let current=false;try{await r.requireCurrent();current=true;}catch{}
 const unavailable=()=>({installation_id:r.c.installation,authority_current:false,read_only:true,blocked:true,status:'inventory_not_current',cases:[],history:[],budgets:proof.budgets});
 if(!pending.length&&!current)return unavailable();
 if(pending.length){
  if(pending.length!==1||pending[0].seq!==proof.seq)return unavailable();
  const local=r.local(),prefix=proof.operations.slice(0,-1);
  if(local.length!==prefix.length&&local.length!==proof.operations.length)return unavailable();
  for(let i=0;i<prefix.length;i++)if(!local[i]||local[i].id!==prefix[i].id||local[i].kind!==prefix[i].kind||hash(JSON.parse(local[i].body))!==local[i].sha||local[i].sha!==prefix[i].receipt_sha)return unavailable();
  if(!prefix.length||JSON.parse(local[prefix.length-1].body).after!==pending[0].context.before)return unavailable();
 }
 const add=async(context:any,kind:string,caseId:string)=>{
  try{r.governor(actor,{context});}catch(error){if(error instanceof RetainedError&&error.status===403)return;throw error;}
  const base={case_id:caseId,job_id:context.job,owner_id:context.owner,kind};
  if(pending.length&&pending[0].context.inference?.id!==caseId&&pending[0].id!==caseId){cases.push({...base,status:'waiting_for_prior_operation',actionable:false});return;}
  try{
   const inspected=await r.inspectRecovery(actor,caseId);
   cases.push({...base,status:'review_required',actionable:true,operation_id:inspected.operation.id,evidence_sha:inspected.evidence,mode:inspected.mode});
  }catch(error){
   if(error instanceof RetainedError&&error.status===403)return;
   cases.push({...base,status:'evidence_unavailable_or_changed',actionable:false});
  }
 };
 for(const operation of pending)await add(operation.context,operation.kind,operation.context.inference?.id||operation.id);
 if(r.inference){
  for(const row of r.db.prepare("SELECT * FROM inference_requests WHERE state='admitted' ORDER BY id").all() as any[]){
   if(cases.some(x=>x.case_id===row.id))continue;
   const job=r.db.prepare('SELECT owner,plan FROM jobs WHERE id=?').get(row.job) as any;if(!job)continue;
   const context={owner:job.owner,job:row.job,sources:JSON.parse(job.plan).references.map((x:any)=>x.source)};
   try{
    const value=await r.inference.call('inference_lookup',row.id);
    if(['complete','absent','closed_unknown'].includes(value.state))continue;
    if(value.active===true){try{r.governor(actor,{context});cases.push({case_id:row.id,job_id:row.job,owner_id:job.owner,kind:'inference_unknown',status:'inference_active',actionable:false});}catch{}continue;}
   }catch{try{r.governor(actor,{context});cases.push({case_id:row.id,job_id:row.job,owner_id:job.owner,kind:'inference_unknown',status:'provider_unavailable',actionable:false});}catch{}continue;}
   await add(context,'inference_unknown',row.id);
  }
 }
 const history=[];
 for(const operation of proof.operations.filter((x:any)=>['closed_unknown','reconciled_read','reconciled_effect'].includes(x.outcome))){
  try{r.governor(actor,operation);}catch{continue;}
  history.push({case_id:operation.context.inference?.id||operation.id,operation_id:operation.id,job_id:operation.context.job,outcome:operation.outcome,
   reviewers:proof.recovery_votes.filter((x:any)=>x.operation_id===operation.id).map((x:any)=>x.actor)});
 }
 return {installation_id:r.c.installation,authority_current:current,read_only:true,cases,history,budgets:proof.budgets};
}
