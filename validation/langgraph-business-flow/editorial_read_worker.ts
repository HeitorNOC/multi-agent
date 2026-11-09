import { parentPort,workerData } from 'node:worker_threads';
import { execute } from '../temporal-editorial/editorial.ts';
const errors: string[]=[];
for(let index=0;index<workerData.count;index++) {
  try { const result=execute(workerData.config,workerData.payload); if(result.content!=='Approved original.') errors.push('unexpected snapshot'); }
  catch(error) { errors.push(error instanceof Error ? error.message : String(error)); }
}
parentPort?.postMessage({errors});
