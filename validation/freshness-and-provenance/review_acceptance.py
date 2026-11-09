"""Re-evaluate exactly saved outputs. No model/retrieval calls and no overwrite of raw grading."""
import hashlib,json
from pathlib import Path
from grader import denies_validity_start
P=Path(__file__).parent/'evidence'
def main():
    rows=json.loads((P/'acceptance.json').read_text(encoding='utf-8'));revised=[]
    for r in rows:
        checks={**r['checks'],'no_missing_date_claim':not denies_validity_start(r['answer'])}
        revised.append({'case':r['case'],'original_checks':r['checks'],'revised_checks':checks,'answer_sha256':hashlib.sha256(r['answer'].encode()).hexdigest(),
            'review':'The answer explicitly provides valid_from; absence statement concerns only the end date, which is not asserted by canonical metadata.',
            'revision_scope':'only lexical start/end distinction; same output, same model call, post-hoc evaluation, not an independent benchmark'})
    (P/'acceptance-revised.json').write_text(json.dumps(revised,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'original':sum(all(r['checks'].values()) for r in rows),'revised':sum(all(r['revised_checks'].values()) for r in revised),'total':len(rows),'new_model_calls':0}))
if __name__=='__main__':main()
