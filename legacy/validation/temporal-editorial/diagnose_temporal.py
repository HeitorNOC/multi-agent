"""Read-only diagnostics on captured native records. Never repair dates, facts or attributes."""
import json,re
from datetime import datetime
from pathlib import Path
BASE=Path(__file__).resolve().parent/'evidence'
def dt(s):return datetime.fromisoformat(s.replace('Z','+00:00')) if s else None
def diagnose(folder):
    checks=json.loads((folder/'temporal-checks.json').read_text(encoding='utf-8'))
    graph=json.loads((folder/'native-temporal-graph.json').read_text(encoding='utf-8'))['edges']
    asof=next(c for c in checks if c['name']=='what_was_known_before_correction_about_february')
    valid=dt(asof['response']['as_of']);known=dt(asof['response']['known_at'])
    candidates=[e for e in graph if e.get('name')=='REMOTE_POLICY' and dt(e['created_at'])<=known and dt(e['valid_at'])<=valid and (not e.get('invalid_at') or dt(e['invalid_at'])>valid)]
    inconsistencies=[]
    for c in checks:
        for e in c['response']['facts']:
            if re.search(r'\b(?:concedia|concede)\s+(?:apenas\s+)?dois dias',e['fact'],re.I) and e.get('attributes',{}).get('dias_remotos') not in (None,2):
                inconsistencies.append({'check':c['name'],'edge':e['uuid'],'fact':e['fact'],'attributes':e['attributes']})
    return {'mutates_native_records':False,'passed':sum(c['pass'] for c in checks),'total':len(checks),
            'fact_attribute_inconsistencies':inconsistencies,'knowledge_time_probe':{
                'expected_days':asof['expected_days'],'native_observed':asof['observed_days'],
                'records_matching_valid_time_and_created_cutoff_even_without_expired_filter':[e['uuid'] for e in candidates],
                'interpretation':'Flat current edge dates do not by themselves prove reconstruction of prior knowledge. Removing the expired_at predicate is insufficient if the historical invalid_at boundary was overwritten.'}}

if __name__=='__main__':
    reports={}
    for name,folder in [('terra',BASE/'terra'),('sol',BASE/'sol' if (BASE/'sol').exists() else BASE)]:
        if (folder/'native-temporal-graph.json').exists():reports[name]=diagnose(folder)
    (BASE/'temporal-diagnostic.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(reports,ensure_ascii=False,indent=2))
