import json
import os
from pathlib import Path
import sqlite3
import shutil
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import Request,urlopen
from uuid import uuid4
import pytest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
PYTHON = os.environ.get("AURORA_TEST_PYTHON", sys.executable)
sys.path.insert(0,str(ROOT/'demo-enterprise'))
from local_session import load_resume


def wait_for(check,timeout=240):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            value=check()
            if value:return value
        except (OSError,URLError,json.JSONDecodeError):pass
        time.sleep(.15)
    raise AssertionError('launcher did not reach the expected state')


def request(url,path,body=None,headers=None):
    req=Request(url+path,None if body is None else json.dumps(body).encode(),
                {'content-type':'application/json',**(headers or {})})
    with urlopen(req,timeout=4) as response:return response.status,json.load(response)


def inspect(kind,name):
    cmd=['docker','inspect','--type','container',name] if kind=='container' else ['docker','volume','inspect',name]
    return json.loads(subprocess.check_output(cmd,timeout=15))[0]


def test_stop_start_same_installation(tmp_path):
    run_drill(tmp_path, restore_pg=False)


def test_operational_postgres_backup_restore(tmp_path):
    run_drill(tmp_path, restore_pg=True)


@pytest.mark.parametrize("scenario", ["engineering_webhook", "engineering_webhook_team"])
def test_engineering_delivery_through_dashboard_api(tmp_path, scenario):
    run_drill(tmp_path, restore_pg=False, engineering=scenario)


def run_drill(tmp_path,restore_pg,engineering=False):
    launcher=None
    state=None
    logs=[]
    previous_pid=None
    retired=[]

    def launch(*extra):
        nonlocal previous_pid
        previous_pid=active()['launcher_pid'] if (tmp_path/'active.json').exists() else None
        log=(tmp_path/f'launcher-{len(logs)}.log').open('w',encoding='utf-8');logs.append(log)
        return subprocess.Popen([PYTHON,str(HERE/'fixture_launcher.py'),'--state-root',str(tmp_path),*extra],
                                cwd=ROOT,stdout=log,stderr=log)

    def active():return json.loads((tmp_path/'active.json').read_text(encoding='utf-8'))

    def ready():
        if launcher.poll() is not None:raise AssertionError('launcher exited early; see private launcher log')
        pointer=active()
        if pointer['launcher_pid']==previous_pid:return None
        _,value=request(pointer['url'],'/api/state')
        if value['runtime']['phase']=='failed':raise AssertionError('launcher setup failed; see private startup log')
        return value if value['runtime']['phase']=='ready' else None

    def stop():
        pointer=active()
        assert pointer['launcher_pid']!=previous_pid
        request(pointer['backend'],'/rpc',{'action':'stop'},{'x-demo-token':pointer['token']})
        assert launcher.wait(timeout=120)==0
        assert (Path(pointer['state'])/'parked').is_file()

    def job(url,id):return next(job for job in request(url,'/api/state')[1]['jobs'] if job['id']==id)

    def submit(url,key):
        status,value=request(url,'/api/jobs',{'scenario':'incident'},{'Idempotency-Key':key})
        assert status==202
        return value['id']

    def backup_command(operation,directory,expected=0):
        result=subprocess.run([PYTHON,'-X','utf8',str(ROOT/'demo-enterprise/local_backup.py'),operation,
                               '--state-root',str(tmp_path),'--directory',str(directory)],
                              cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=150)
        assert result.returncode==expected,result.stderr
        return json.loads(result.stdout) if result.stdout else None

    try:
        launcher=launch('--workers','1')
        original=wait_for(ready)
        assert original['performance']['apiResidentBytes'] > 0
        assert 0 <= original['performance']['hostMemoryUsedBytes'] <= original['performance']['hostMemoryTotalBytes']
        source=active();state=Path(source['state']);url=source['url']
        if engineering:
            status, accepted = request(url, '/api/jobs', {'scenario': engineering}, {'Idempotency-Key': uuid4().hex})
            assert status == 202
            id_ = accepted['id']

            def reviewed():
                work = job(url, id_)
                if work['status'] in ('failed', 'recovery_required'):
                    raise AssertionError(work)
                return work if work['status'] == 'awaiting_approval' and not work['worker_active'] else None

            work = wait_for(reviewed, timeout=100)
            report = work['review']['report']
            assert report['tests']['passed'] and report['diff'].startswith('--- a/webhook.cjs')
            events = {event['node']: event['detail'] for event in work['events']}
            assert set(events['engineering_chief']['roster']) - {item['agent'] for item in events['engineering_assign']['assignments']} == {'platform_engineer'}
            assert events['engineering_qa']['tests']['passed']
            assert not work['receipt']
            assert request(url, f'/api/jobs/{id_}/approve', {'hash': work['review']['hash']})[0] == 202
            wait_for(lambda: job(url, id_)['status'] == 'completed', timeout=40)
            assert job(url, id_)['receipt']['recipient'] == 'registro-local-engenharia'
            calls = (state/'fixture-dispatches.jsonl').read_text(encoding='utf-8').splitlines()
            if engineering == "engineering_webhook_team":
                reviewed = [e["detail"] for e in work["events"] if e["node"] == "engineering_delegation" and e["detail"]["status"] == "reviewed"]
                assert [(e["requester"], e["approved"]) for e in reviewed] == [
                    ("technology_director", ["Entrada", "Persistencia"]),
                    ("backend_engineer", ["Validacao", "Adaptador"]),
                    ("backend_engineer_2", ["Reentrega"]),
                ]
                started = [e["detail"]["capability"] for e in work["events"] if e["node"] == "engineering_delegation" and e["detail"]["status"] == "started"]
                assert set(started) == {"backend_engineer", "backend_engineer_2", "backend_developer_a", "backend_developer_b", "backend_developer_c"}
                assert len(started) == 5
                assert len(calls) == 18
            else:
                assert len(calls) == 7
            return
        completed=submit(url,uuid4().hex)
        wait_for(lambda:job(url,completed)['status']=='awaiting_approval',timeout=90)
        review_hash=job(url,completed)['review']['hash']
        assert request(url,f'/api/jobs/{completed}/approve',{'hash':review_hash,'crash_after_effect':True})[0]==202
        wait_for(lambda:job(url,completed)['status']=='interrupted',timeout=40)
        receipt=job(url,completed)['receipt'];assert receipt

        (state/'fixture-hold').touch()
        interrupted=submit(url,uuid4().hex)
        calls=state/'fixture-dispatches.jsonl'
        wait_for(lambda:'"outcome": "held"' in calls.read_text(encoding='utf-8'),timeout=40)
        queue_key=uuid4().hex;queued=submit(url,queue_key)
        assert job(url,queued)['status']=='queued'
        stop()
        (state/'fixture-hold').unlink()
        resume=load_resume(state)
        for kind,name in resume['engine']['docker_resources']:
            record=inspect(kind,name)
            if kind=='container':assert not record['State']['Running']
        assert len(calls.read_text().splitlines())==5
        stages=state/'fixture-stages.log'
        index_calls=len(stages.read_text().splitlines())
        assert index_calls>0

        if restore_pg:
            bundle=tmp_path/'backup'
            clock=time.monotonic()
            assert backup_command('backup',bundle)['jobs']==3
            backup_seconds=time.monotonic()-clock
            bad=tmp_path/'altered-backup';shutil.copytree(bundle,bad)
            with (bad/'runtime.dump').open('ab') as stream:stream.write(b'corruption')
            backup_command('restore',bad,expected=1)
            engine=resume['engine'];container=engine['container']
            assert inspect('container',container)['Config']['Labels']['qualification']==engine['id']
            subprocess.run(['docker','start',container],check=True,capture_output=True,timeout=20)
            try:
                def postgres_ready():
                    return subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],
                                          capture_output=True,timeout=10).returncode==0
                wait_for(postgres_ready,timeout=40)
                for statement in ('DROP SCHEMA runtime CASCADE','DROP DATABASE knowledge'):
                    subprocess.run(['docker','exec',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement],
                                   check=True,capture_output=True,timeout=20)
            finally:
                subprocess.run(['docker','stop',container],check=True,capture_output=True,timeout=30)
            clock=time.monotonic()
            restored=backup_command('restore',bundle)
            restore_seconds=time.monotonic()-clock
            assert restored['status']=='postgres_restored' and restored['postgres_container']!=container
            retired=[('volume',container+'-data'),('container',container)]

        started=time.monotonic()
        launcher=launch()
        resumed=wait_for(ready)
        ready_seconds=time.monotonic()-started
        target=active();url=target['url']
        assert target['state']==source['state'] and target['launcher_pid']!=source['launcher_pid']
        assert resumed['runtime']['resumed'] and resumed['runtime']['installation']==original['runtime']['installation']
        assert resumed['runtime']['sources']==original['runtime']['sources']
        assert submit(url,queue_key)==queued
        wait_for(lambda:job(url,queued)['status']=='awaiting_approval',timeout=90)
        assert not job(url,queued)['approval']
        assert request(url,f'/api/jobs/{completed}/resume',{})[0]==202
        wait_for(lambda:job(url,completed)['status']=='completed',timeout=40)
        assert job(url,completed)['receipt']==receipt
        assert request(url,f'/api/jobs/{interrupted}/resume',{})[0]==202
        wait_for(lambda:job(url,interrupted)['status']=='recovery_required',timeout=40)
        late=None
        if restore_pg:
            late=submit(url,uuid4().hex)
            wait_for(lambda:job(url,late)['status']=='awaiting_approval',timeout=90)
        stop()

        with sqlite3.connect(state/'journey.sqlite') as db:
            assert db.execute('SELECT count(*) FROM jobs').fetchone()[0]==(4 if restore_pg else 3)
            assert db.execute('SELECT count(*) FROM effects').fetchone()[0]==1
        assert len(calls.read_text().splitlines())==(13 if restore_pg else 9)
        assert len(stages.read_text().splitlines())==index_calls
        record={'result':'PASS','sources_preserved':len(resumed['runtime']['sources']),
                'restart_to_ready_seconds':round(ready_seconds,3),'new_extraction_calls':0,
                'same_installation':True,'same_resources':True,'queued_job_kept_id':True,
                'unknown_required_review':True,'effect_receipt_reused':True,'jobs':3,
                'controlled_dispatches_before':5,'controlled_dispatches_after':4,'paid_model_calls':0}
        if restore_pg:
            refused=backup_command('restore',bundle,expected=2)
            assert refused['jobs_missing_from_backup']==[late]
            assert {'journey.sqlite','authority'}<=set(refused['divergent_ledgers'])
            assert load_resume(state)['engine']['container']==restored['postgres_container']
            record.update(backup_seconds=round(backup_seconds,3),restore_postgres_seconds=round(restore_seconds,3),
                          same_resources=False,postgres_replaced=True,tampered_backup_refused=True,
                          newer_state_refused=True,late_admissions_reported=1,jobs=4,controlled_dispatches_after=8)
        (HERE/f'evidence-{uuid4().hex[:10]}.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    finally:
        if launcher and launcher.poll() is None:
            try:stop()
            except (OSError,AssertionError,subprocess.TimeoutExpired):launcher.terminate();launcher.wait(timeout=10)
        for log in logs:log.close()
        if state is None and (tmp_path/'active.json').exists():state=Path(active()['state'])
        if state and (state/'resume.dpapi').exists():
            session=load_resume(state)
            engine=session['engine']
            for kind,name in reversed(engine['docker_resources']+retired):
                resource=inspect(kind,name)
                labels=resource['Config']['Labels'] if kind=='container' else resource['Labels']
                assert labels.get('qualification')==engine['id']
                cmd=['docker','rm','-f',name] if kind=='container' else ['docker','volume','rm',name]
                subprocess.run(cmd,check=True,capture_output=True,timeout=25)
