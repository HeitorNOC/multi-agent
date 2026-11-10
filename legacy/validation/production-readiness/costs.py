"""Rate-card math and usage normalization. No provider requests or billing claims."""
from dataclasses import dataclass
from decimal import Decimal

D=Decimal
M=D(1_000_000)

@dataclass(frozen=True)
class Usage:
    fresh:int
    read:int
    write_short:int
    write_long:int
    output:int
    def __post_init__(self):
        if any(not isinstance(x,int) or isinstance(x,bool) or x<0 for x in self.__dict__.values()):raise ValueError('invalid token accounting')


def normalize_openai(u):
    details=u.get('input_tokens_details') or {};written=details.get('cache_write_tokens',0)
    split=details.get('cache_write_tokens_details')
    if written and not split:raise ValueError('cache write lifetime required for exact pricing')
    short=(split or {}).get('ttl_30m_tokens',0);long=(split or {}).get('ttl_12h_tokens',0)
    if short+long!=written:raise ValueError('write breakdown mismatch')
    # Reasoning is a subset of output_tokens, not an additional charge category.
    if (u.get('output_tokens_details') or {}).get('reasoning_tokens',0)>u['output_tokens']:raise ValueError('invalid reasoning breakdown')
    return Usage(u['input_tokens']-details.get('cached_tokens',0)-written,details.get('cached_tokens',0),short,long,u['output_tokens'])


def normalize_anthropic(u):
    split=u.get('cache_creation') or {};written=u.get('cache_creation_input_tokens',0)
    short=split.get('ephemeral_5m_input_tokens',0);long=split.get('ephemeral_1h_input_tokens',0)
    if short+long!=written:raise ValueError('cache lifetime breakdown required')
    return Usage(u['input_tokens'],u.get('cache_read_input_tokens',0),short,long,u['output_tokens'])


def price(usage,card):
    total=D(0)
    for key,count in usage.__dict__.items():
        if not count:continue
        if card[key] is None:raise ValueError('category requires a provider-specific billing adapter')
        total+=D(count)*D(card[key])
    return total/M


CARDS={
 'openai:gpt-6.1-sol':{'fresh':'2','read':'0.10','write_short':'2.50','write_long':'5','output':'10'},
 'openai:gpt-6-luna':{'fresh':'0.10','read':'0.01','write_short':'0.125','write_long':'0.25','output':'0.50'},
 'anthropic:claude-sonnet-5-5':{'fresh':'2','read':'0.10','write_short':'2.50','write_long':'4','output':'10'},
 'google:gemini-3.5-flash-lite':{'fresh':'0.30','read':'0.03','write_short':None,'write_long':None,'output':'2.50'},
}


def forecast():
    # Illustrative workloads, not measured customer usage or model equivalence.
    scenarios=[{'name':'pilot','users':20,'active_workflows':5,'tasks_day':50,'documents':2000},
               {'name':'large-enterprise-design-target','users':2000,'active_workflows':100,'tasks_day':10000,'documents':1000000},
               {'name':'stress-hypothesis-not-capacity-claim','users':10000,'active_workflows':500,'tasks_day':50000,'documents':10000000}]
    result=[]
    for s in scenarios:
        # Includes all calls/agents/reviewer per accepted task, not per single model call.
        task_tokens=Usage(40000,0,0,0,8000)
        initial_input=s['documents']*8000
        row={**s,'assumptions':{'aggregate_input_tokens_per_task':40000,'aggregate_output_tokens_per_task':8000,'retry_work_multiplier':'1.20','days_month':30,'tokens_per_doc':8000,'extraction_output_ratio':'0.20'},'models':{}}
        for name,card in CARDS.items():
            monthly=price(task_tokens,card)*s['tasks_day']*30*D('1.20')
            ingest=price(Usage(initial_input,0,0,0,initial_input//5),card)
            row['models'][name]={'monthly_task_tokens_usd':str(monthly),'initial_extraction_tokens_usd':str(ingest)}
        row['embedding_raw_document_pass_usd_at_0_02_per_million']=str(D(initial_input)*D('0.02')/M)
        # Raw one vector per 900 new tokens at 1536 float32 dims, before HNSW/graph/replicas.
        row['chunk_vectors_approx']=(initial_input+899)//900
        row['raw_chunk_vectors_gib_1536_float32']=str((D(row['chunk_vectors_approx'])*1536*4/(1024**3)).quantize(D('.01')))
        result.append(row)
    return {'type':'ESTIMATE from published prices and assumed volumes, not measured or invoiced cost',
            'priced_at':'2026-11-03','tier':'standard, global, short-context text; no enterprise discounts, batch, residency premiums, tax or FX',
            'not_included':['hosting/HA','object/graph/vector storage','cache storage hours','OCR','reranking','entity/relationship embeddings','tool/API charges','reindexing','egress','observability','backup','support/operations'],
            'cards_usd_per_million_tokens':CARDS,'scenarios':result}
