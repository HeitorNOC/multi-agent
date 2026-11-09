"""Exercise the running demo via its real HTTP API; uses four real model calls."""
import json,pathlib,sqlite3,time,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parent
def main():
    active=json.loads((ROOT/'.state/active.json').read_text());url=active['url'];evidence={'checks':[],'production_approved':False};start=time.perf_counter()
    def call(path,body=None,headers=None):
        req=urllib.request.Request(url+path,None if body is None else json.dumps(body).encode(),{'content-type':'application/json',**(headers or {})})
        with urllib.request.urlopen(req,timeout=20) as res:return json.load(res)
    def wait(predicate,limit=240):
        deadline=time.monotonic()+limit
        while time.monotonic()<deadline:
            value=call('/api/state')
            if value['runtime']['phase']=='failed':raise AssertionError('Launcher failed; see private startup log')
            if predicate(value):return value
            time.sleep(.8)
        raise AssertionError('Timed out waiting for journey state')
    def job(s):return next(j for j in s['jobs'] if j['id']==id)
    def mark(name,**extra):evidence['checks'].append({'name':name,**extra});print('CHECK '+name,flush=True)
    def deny(path,body,status=409,headers=None):
        try:call(path,body,headers)
        except urllib.error.HTTPError as error:assert error.code==status
        else:raise AssertionError('Expected refusal: '+path)
    try:
        s=wait(lambda s:s['runtime']['phase']=='ready');assert len(s['runtime']['sources'])==3
        mark('three_native_sources_ready',sources=[{'source':d['source'],'sha256':d['sha256']} for d in s['runtime']['sources']])
        deny('/api/jobs',{'goal':'Read local credentials'})
        deny('/api/jobs',{},headers={'Origin':'https://untrusted.example'})
        id=call('/api/jobs',{})['id'];evidence['job']=id
        s=wait(lambda s:job(s)['status'] in ['awaiting_approval','failed'] and not job(s)['worker_active']);j=job(s)
        assert j['status']=='awaiting_approval',j.get('error');assert j['receipt'] is None and not j['approval']
        r=j['review']['report'];assert r['revenue_drop_pct']==20 and r['causal_proof'] is False
        assert {e['detail']['capability'] for e in j['events'] if e['node']=='specialist_completed'}=={'sales_analysis','inventory_analysis'}
        mark('real_cos_two_specialists_synthesis_and_approval_pause',report=r,hash=j['review']['hash'])
        model_calls=s['runtime']['usage']['calls'];denied_hash='0'*64
        deny('/api/jobs/'+id+'/approve',{'hash':denied_hash});deny('/internal/effect',{'job':id,'hash':j['review']['hash']},403)
        # A fresh worker without approval must stay paused, without model replay.
        call('/api/jobs/'+id+'/resume',{});s=wait(lambda s:not job(s)['worker_active']);j=job(s)
        assert j['status']=='awaiting_approval' and j['receipt'] is None and s['runtime']['usage']['calls']==model_calls
        mark('new_process_without_approval_stays_paused_no_new_inference')
        hash=j['review']['hash'];call('/api/jobs/'+id+'/approve',{'hash':hash,'crash_after_effect':True})
        s=wait(lambda s:not job(s)['worker_active']);j=job(s)
        assert j['status']=='interrupted' and j['receipt']['simulated'] is True
        receipt=j['receipt']['id'];mark('worker_exit_88_after_simulated_effect_before_checkpoint',receipt=receipt)
        call('/api/jobs/'+id+'/resume',{});s=wait(lambda s:not job(s)['worker_active']);j=job(s)
        assert j['status']=='completed' and j['receipt']['id']==receipt and s['runtime']['usage']['calls']==model_calls
        call('/api/jobs/'+id+'/resume',{});s=wait(lambda s:not job(s)['worker_active']);j=job(s)
        assert j['status']=='completed' and j['receipt']['id']==receipt
        with sqlite3.connect(pathlib.Path(active['state'])/'journey.sqlite') as db:
            count=db.execute('SELECT count(*) FROM effects WHERE job=?',(id,)).fetchone()[0]
        assert count==1
        pids={e['detail']['pid'] for e in j['events'] if e['node']=='worker_started'};assert len(pids)>=4
        mark('restart_and_completed_replay_one_effect_no_new_inference',effects=count,worker_processes=len(pids),receipt=receipt)
        evidence.update(result='PASS',usage=s['runtime']['usage'],events=j['events'],report=r)
    except BaseException as error:
        evidence.update(result='FAIL',error=repr(error));raise
    finally:
        evidence['seconds']=time.perf_counter()-start;(ROOT/'evidence').mkdir(exist_ok=True)
        (ROOT/'evidence/journey.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
