"""Match historical direct slots to CLI usage by exact prompt hash, without exporting prompts."""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sqlite3

ROOT=Path(__file__).resolve().parents[2]
API_RATES=(Decimal('1'),Decimal('.05'),Decimal('5'))
CODEX_RATES=(Decimal('25'),Decimal('1.25'),Decimal('125'))


def read_json(path):return json.loads(path.read_text(encoding='utf-8'))


def equivalent(tokens,rates):
    return str(sum(amount*rate for amount,rate in zip(tokens,rates))/1_000_000)


def measure(session):
    evidence=ROOT/'validation/observability-recovery/native-evidence'
    expected=read_json(evidence/'verified.json')
    if read_json(session/'environment.json')['installation']!=expected['installation']:
        raise ValueError('Sessão diferente do ensaio histórico verificado')
    cases=read_json(evidence/'scenarios.json')['scenarios']
    model=session/'engines/model'
    records=[json.loads(line) for line in (model/'model-calls.jsonl').read_text(encoding='utf-8').splitlines()]
    totals=expected['usage']
    if len(records)!=totals['calls'] or any(
        sum(usage.get(field,0) for record in records for usage in record['usage'])!=totals[field]
        for field in ('input_tokens','cached_input_tokens','output_tokens')
    ):raise ValueError('Uso histórico diverge do total verificado')
    by_prompt=defaultdict(list)
    for record in records:
        prompt=read_json(model/f"llm-{record['call']:02}.prompt.json")['user_prompt']
        by_prompt[hashlib.sha256(prompt.encode()).hexdigest()].append(record)
    path=session/'model-slots.sqlite'
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        slots=db.execute('SELECT job,slot,prompt_sha,status FROM slots ORDER BY job,slot').fetchall()
    hashes=Counter(row[2] for row in slots)
    assigned=set()
    results=[]
    for case in cases:
        matched=[]
        for _,slot,sha,status in (row for row in slots if row[0]==case['job']):
            if status!='completed' or hashes[sha]!=1 or len(by_prompt[sha])!=1:
                raise ValueError('Correspondência de slot ausente ou ambígua')
            record=by_prompt[sha][0]
            if (record['model']!='gpt-6.1-terra' or record['exit_code'] or record['unexpected_tool_events'] or
                len(record['usage'])!=1 or record['call'] in assigned):
                raise ValueError('Uso histórico inválido para atribuição')
            assigned.add(record['call'])
            matched.append((slot,record['usage'][0]))
        if sorted(slot for slot,_ in matched)!=sorted(slot for slot,_ in case['model_slots']):
            raise ValueError('Conjunto de slots diverge da evidência histórica')
        input_tokens=sum(usage['input_tokens'] for _,usage in matched)
        cached=sum(usage['cached_input_tokens'] for _,usage in matched)
        output=sum(usage['output_tokens'] for _,usage in matched)
        cache_write=sum(usage.get('cache_write_input_tokens',0) for _,usage in matched)
        tokens=(input_tokens-cached,cached,output)
        if min(tokens)<0 or cache_write:raise ValueError('Uso requer tratamento separado de cache')
        results.append({'scenario':case['scenario'],'status':'awaiting_approval','slots':len(matched),
                        'input_tokens':input_tokens,'cached_input_tokens':cached,'output_tokens':output,
                        'api_standard_usd_equivalent':equivalent(tokens,API_RATES),
                        'codex_standard_credit_equivalent':equivalent(tokens,CODEX_RATES)})
    return {'model':'gpt-6.1-terra','rate_reference_date':'2026-11-06','case_scope':'historical direct inference through review',
            'historical_cli_calls':len(records),'matched_cli_calls':len(assigned),
            'unattributed_cli_calls':len(records)-len(assigned),'invoiced_usd':None,'new_calls':0,'cases':results}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('session',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=measure(args.session)
    with args.output.open('x',encoding='utf-8') as stream:
        json.dump(result,stream,indent=2)
