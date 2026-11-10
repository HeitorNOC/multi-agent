"""Two real semantic journeys; grades selection and business facts, no real effects."""
import json,pathlib,time,urllib.request,urllib.error,argparse
HERE=pathlib.Path(__file__).resolve().parent
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--campaign-job');parser.add_argument('--incident-job');parser.add_argument('--evidence-dir');args=parser.parse_args()
    target=pathlib.Path(args.evidence_dir).resolve() if args.evidence_dir else HERE/'evidence'
    if not target.is_relative_to(HERE.parent):raise ValueError('Evidence directory must remain in workspace')
    active=json.loads((HERE/'.state/active.json').read_text());base=active['url'];evidence={'scenarios':[],'production_approved':False,'business_v1_requalified':False};start=time.perf_counter()
    def call(path,body=None):
        with urllib.request.urlopen(urllib.request.Request(base+path,None if body is None else json.dumps(body).encode(),{'content-type':'application/json'}),timeout=20) as r:return json.load(r)
    def wait(fn,seconds=500):
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            value=call('/api/state')
            if value['runtime']['phase']=='failed':raise AssertionError('Startup failed; private logs preserved')
            if fn(value):return value
            time.sleep(.8)
        raise AssertionError('Scenario deadline')
    try:
        state=wait(lambda s:s['runtime']['phase']=='ready',600);assert len(state['runtime']['sources'])==16 and len(state['runtime']['catalog'])==21
        print('CHECK 16 current documents, 1 historical, 21 available agents',flush=True)
        for scenario in ['campaign','incident']:
            adopted=args.campaign_job if scenario=='campaign' else args.incident_job
            id=adopted or call('/api/jobs',{'scenario':scenario})['id'];tick=time.perf_counter()
            state=wait(lambda s:any(j['id']==id and not j['worker_active'] and j['status'] in ['awaiting_approval','failed'] for j in s['jobs']))
            job=next(j for j in state['jobs'] if j['id']==id)
            record={'scenario':scenario,'job':id,'status':job['status'],'plan':job['plan'],'report':job['review']['report'] if job['review'] else None,'seconds':time.perf_counter()-tick,'events':job['events']};evidence['scenarios'].append(record)
            if job['status']!='awaiting_approval':
                record['failure']=job.get('error');print('FAIL '+scenario+': review not accepted; preserved',flush=True);continue
            selected=set(job['plan']['capabilities']);finished={e['detail']['capability'] for e in job['events'] if e['node'] in ['specialist_completed','director_completed']}
            assert selected==finished and len(selected)<21
            assert not job['approval'] and not job['receipt']
            # Model slots demonstrate inactive nodes are not instantiated for inference.
            import sqlite3
            with sqlite3.connect(pathlib.Path(active['state'])/'model-slots.sqlite') as db:slots=db.execute('SELECT slot,status FROM slots WHERE job=?',(id,)).fetchall()
            assert {s[0][6:] for s in slots if s[0].startswith('agent:')}==selected
            assert all(s[1]=='completed' for s in slots);record.update(model_slots=slots,inactive_agents=sorted(set(a['id'] for a in state['runtime']['catalog'])-selected))
            if state['runtime'].get('run_profile')=='observability-v1':
                trace=call('/api/jobs/'+id+'/trace');assert trace['read_only'] and trace['installation_id']==state['runtime']['installation']
                assert len({e['event_id'] for e in trace['events']})==len(trace['events'])
                verified=[e for e in trace['events'] if e['kind']=='canonical_evidence_verified']
                assert {e['capability_id'] for e in verified}==selected and len(verified)==len(selected)
                assert all(e['evidence'] and all(r['canonical_fragment_id'] and r['retrieved_fragment_id'] and r['projection_id'] for r in e['evidence']) for e in verified)
                assert len([e for e in trace['events'] if e['kind']=='inference_completed'])==len(selected)+2
                with sqlite3.connect(pathlib.Path(active['state'])/'telemetry-outbox.sqlite') as db:
                    assert db.execute('SELECT count(*) FROM outbox WHERE job=? AND delivered=0',(id,)).fetchone()[0]==0
                    for event in trace['events']:
                        for key in ['input_artifact_id','output_artifact_id']:
                            if event[key]:assert db.execute('SELECT 1 FROM artifacts WHERE job=? AND sha=?',(id,event[key])).fetchone()
                record['trace']=trace
            if scenario=='campaign':assert {'marketing_director','operations_director','finance_director','legal_director'}<=selected
            else:assert {'technology_director','legal_director'}<=selected and 'marketing_director' not in selected and 'people_director' not in selected
            before=state['runtime']['usage']['calls'];call('/api/jobs/'+id+'/resume',{})
            state=wait(lambda s:any(j['id']==id and not j['worker_active'] for j in s['jobs']));again=next(j for j in state['jobs'] if j['id']==id)
            assert again['status']=='awaiting_approval' and not again['receipt'] and state['runtime']['usage']['calls']==before
            print('CHECK '+scenario+': '+str(len(selected))+'/21 agents, '+str(len(slots))+' slots, resume without inference',flush=True)
        if all(r['plan'] for r in evidence['scenarios']):assert set(evidence['scenarios'][0]['plan']['capabilities'])!=set(evidence['scenarios'][1]['plan']['capabilities'])
        evidence.update(result='PASS' if all(r['status']=='awaiting_approval' for r in evidence['scenarios']) else 'FAIL',usage=state['runtime']['usage'])
    except BaseException as error:evidence.update(result='FAIL',error=repr(error));raise
    finally:
        evidence['seconds']=time.perf_counter()-start;target.mkdir(parents=True,exist_ok=True);(target/'scenarios.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
    if evidence['result']!='PASS':raise SystemExit(1)
if __name__=='__main__':main()
