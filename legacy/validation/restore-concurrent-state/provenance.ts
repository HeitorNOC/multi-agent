/** Business-layer contract: source selection and temporal authority come from backend. */
import { createHash } from 'node:crypto';
export function canonicalBasis(snapshot:any, query:any) {
  const parse=(s:string)=>{const t=Date.parse(s);if(!Number.isFinite(t)||!/(Z|[+-]\d\d:\d\d)$/.test(s))throw Error('explicit valid timestamp required');return t;};
  if(!snapshot.found)throw Error('approved snapshot required');
  if(createHash('sha256').update(snapshot.content).digest('hex')!==snapshot.content_sha)throw Error('canonical content integrity');
  if(snapshot.source!==query.source||parse(snapshot.valid_at)>parse(query.as_of)||parse(snapshot.known_at)>parse(query.known_at))throw Error('snapshot outside query cutoffs');
  return {kind:'backend_selected_approved_source',source:snapshot.source,version:snapshot.version,content_sha:snapshot.content_sha,
    valid_from:snapshot.valid_at,published_at:snapshot.known_at,as_of:query.as_of,knowledge_cutoff:query.known_at,
    interpretation:'valid_from is the start of the selected source version, not an inferred fact date; no end date is asserted'};
}
if(import.meta.main){let text='';for await(const chunk of process.stdin)text+=chunk;try{const {snapshot,query}=JSON.parse(text);console.log(JSON.stringify(canonicalBasis(snapshot,query)));}catch(e){console.error(String(e));process.exitCode=1;}}
