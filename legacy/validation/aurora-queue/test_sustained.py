"""Timed pressure on two Aurora workers with real local stores and a controlled model."""
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import math
from pathlib import Path
import sqlite3
import sys
import time
from uuid import uuid4

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'aurora-host-restore'))
from test_host_restore import Aurora, RestoreLab

DURATION=90
INTERVAL=1.5


class LoadLab(RestoreLab):
    def authority(self):
        self.authority_config['caps']['model']=400
        super().authority()


def percentile(samples,p):
    ordered=sorted(samples)
    return round(ordered[math.ceil(len(ordered)*p)-1],3) if ordered else None


def test_two_workers_sustained(tmp_path,monkeypatch):
    monkeypatch.delenv('BRAIN_DETACHED_PROFILE',raising=False)
    custody=tmp_path/'custody';custody.mkdir()
    lab=LoadLab(tmp_path/'aurora',custody)
    app=None
    try:
        lab.start()
        docs=lab.stage_documents()
        app=Aurora(lab,docs,resume_reserve=2)
        arrivals=[]
        started=time.monotonic()

        def submit():
            tick=time.monotonic()
            code,value=app.call('/api/jobs',{'scenario':'incident'},{'Idempotency-Key':uuid4().hex})
            return code,value.get('id'),time.monotonic()-tick

        def produce(pool):
            for index in range(int(DURATION/INTERVAL)):
                deadline=started+index*INTERVAL
                time.sleep(max(0,deadline-time.monotonic()))
                count=13 if index in (0,20,40) else 1
                arrivals.extend(pool.submit(submit) for _ in range(count))

        snapshots=[];approvals=Counter();peak=0;maximum_pending=0;maximum_new=0
        with ThreadPoolExecutor(max_workers=16) as clients, ThreadPoolExecutor(max_workers=1) as driver:
            producer=driver.submit(produce,clients)
            deadline=started+DURATION+120
            while time.monotonic()<deadline:
                tick=time.monotonic()
                code,state=app.call('/api/state')
                assert code==200
                snapshots.append(time.monotonic()-tick)
                peak=max(peak,state['queue']['running'])
                maximum_pending=max(maximum_pending,state['queue']['pending'])
                maximum_new=max(maximum_new,state['queue']['new_pending'])
                for job in state['jobs']:
                    if job['status']=='awaiting_approval' and not job['approval']:
                        code,_=app.call('/api/jobs/'+job['id']+'/approve',{'hash':job['review']['hash']})
                        approvals[code]+=1
                if producer.done() and all(request.done() for request in arrivals):
                    producer.result()
                    responses=[request.result() for request in arrivals]
                    accepted={id for code,id,_ in responses if code==202}
                    terminal={'completed','failed','recovery_required','closed_unknown','interrupted','rejected'}
                    if accepted and accepted=={job['id'] for job in state['jobs'] if job['status'] in terminal}:break
                time.sleep(.3)
            else:
                producer.result()
                responses=[request.result() for request in arrivals]
                accepted={id for code,id,_ in responses if code==202}

        elapsed=time.monotonic()-started
        outcomes=dict(Counter(code for code,_,_ in responses))
        proof=lab.proof()
        completed={job['id'] for job in state['jobs'] if job['status']=='completed'}
        counts=Counter(item['context']['job'] for item in proof['model_slots'])
        with sqlite3.connect(lab.journey/'journey.sqlite') as db:
            effects=db.execute('SELECT job,receipt FROM effects').fetchall()
            departures=defaultdict(list)
            for id,at in db.execute("SELECT job,at FROM events WHERE node='worker_stopped'"):
                departures[id].append(datetime.fromisoformat(at))
            latencies=[(max(departures[id])-datetime.fromisoformat(created)).total_seconds()
                       for id,created in db.execute("SELECT id,created FROM jobs WHERE status='completed'")]
            waits=[json.loads(row[0])['wait_ms']/1000 for row in db.execute("SELECT detail FROM events WHERE node='job_dequeued'")]
            pending=db.execute('SELECT count(*) FROM job_queue').fetchone()[0]
        records=[json.loads(line) for line in (lab.journey/'dispatches.jsonl').read_text(encoding='utf-8').splitlines()]
        evidence={'configured_arrival_seconds':DURATION,'attempts':len(responses),'admission_outcomes':outcomes,
                  'approval_outcomes':dict(approvals),'accepted':len(accepted),'completed':len(completed),
                  'final_job_states':dict(Counter(job['status'] for job in state['jobs'])),
                  'elapsed_to_drain_seconds':round(elapsed,3),'peak_workers':peak,'peak_waiting':maximum_pending,
                  'peak_new_waiting':maximum_new,'resume_reserve':2,
                  'wait_p50_seconds':percentile(waits,.50),'wait_p95_seconds':percentile(waits,.95),
                  'delivery_p50_seconds':percentile(latencies,.50),'delivery_p95_seconds':percentile(latencies,.95),
                  'state_poll_p95_seconds':percentile(snapshots,.95),'effects':len(effects),
                  'slots_per_completed_job':dict(Counter(counts[id] for id in completed)),
                  'reservations':proof['budgets']['model']['reserved'],'controlled_dispatches':len(records),
                  'published_sources':len(docs),'paid_model_calls':0,'pending_at_end':pending,
                  'postgres_image':lab.image,'scope':'one host, real stores, synthetic incident and controlled model'}
        (HERE/f'sustained-{uuid4().hex[:10]}.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        assert set(outcomes)=={202,429} and set(approvals)<= {202,429}
        assert len(accepted)==outcomes[202] and accepted==completed and not pending
        assert peak==2 and maximum_pending<=8 and maximum_new<=6
        assert {id for id,_ in effects}==completed and len({json.loads(receipt)['id'] for _,receipt in effects})==len(completed)
        assert len(records)==len({record['id'] for record in records})==proof['budgets']['model']['reserved']==len(completed)*4
        assert set(counts)==completed and set(counts.values())=={4}
        assert all(item['state']=='completed' for item in proof['model_slots'])
    finally:
        if app:app.close()
        lab.cleanup()
