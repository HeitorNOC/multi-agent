"""Actual native PostgresSaver across process and abrupt DB restarts."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import uuid

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
IMAGE='postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
NAME='production-audit-saver-'+uuid.uuid4().hex[:10]
VOLUME=NAME+'-data'


def docker(*args,input=None,check=True):
    result=subprocess.run(['docker',*args],input=input,capture_output=True,timeout=30)
    if check and result.returncode:raise RuntimeError(result.stderr.decode(errors='replace'))
    return result


def ready():
    for _ in range(100):
        if docker('exec',NAME,'pg_isready','-U','postgres',check=False).returncode==0:return
        time.sleep(.1)
    raise RuntimeError('DB startup deadline')


def sql(q):return docker('exec','-i',NAME,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','workflow',input=q.encode()).stdout.decode().strip()


def main():
    result={'image':IMAGE,'scope':'native checkpoint and interrupt recovery only; no HA/failover/TLS/cross-client checkpoint ACL certified'}
    try:
        password=secrets.token_hex(24)
        docker('volume','create','--label','audit.owner='+NAME,VOLUME)
        docker('run','-d','--name',NAME,'--label','audit.owner='+NAME,'--read-only','--user','postgres',
               '--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','512m','--cpus','1','--pids-limit','128',
               '--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,size=16m',
               '--mount','type=volume,src='+VOLUME+',dst=/var/lib/postgresql/data','-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD='+password,IMAGE)
        ready()
        bootstrap="CREATE ROLE workflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '"+password+"';CREATE DATABASE workflow OWNER workflow_runtime;"
        docker('exec','-i',NAME,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres',input=bootstrap.encode())
        sql('CREATE TABLE node_calls(run TEXT,node TEXT);ALTER TABLE node_calls OWNER TO workflow_runtime;')
        info=json.loads(docker('inspect',NAME).stdout)[0]['NetworkSettings']['Ports']['5432/tcp'][0]
        assert info['HostIp']=='127.0.0.1'
        with socket.create_connection(('127.0.0.1',int(info['HostPort'])),timeout=3):pass
        result['host_tcp_preflight']='connected'
        dsn='postgresql://workflow_runtime:'+password+'@127.0.0.1:'+info['HostPort']+'/workflow?connect_timeout=5'
        result['worker_stages']=[]
        def worker(resume):
            try:
                proc=subprocess.run([str(HERE/'postgres-runtime/Scripts/python.exe'),'-X','utf8',str(HERE/'pg_saver_worker.py')],input=json.dumps({'dsn':dsn,'run':'installation-A:fixture-run','resume':resume}),text=True,capture_output=True,timeout=20,env={**os.environ,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false'})
            except subprocess.TimeoutExpired as error:
                result['worker_stages'].append({'resume':resume,'stderr':str(error.stderr).replace(password,'[redacted]')});raise
            result['worker_stages'].append({'resume':resume,'stderr':proc.stderr.replace(password,'[redacted]')})
            if proc.returncode:raise RuntimeError(proc.stderr.replace(password,'[redacted]'))
            return json.loads(proc.stdout)
        first=worker(False);assert first['interrupted'] and first['next']==['approval']
        result['first_process']=first
        assert sql('SELECT count(*) FROM node_calls;')=='1'
        docker('kill',NAME);docker('start',NAME);ready()
        refreshed=json.loads(docker('inspect',NAME).stdout)[0]['NetworkSettings']['Ports']['5432/tcp'][0]
        assert refreshed['HostIp']=='127.0.0.1'
        result['ephemeral_port_before_restart']=info['HostPort']
        result['ephemeral_port_after_restart']=refreshed['HostPort']
        dsn='postgresql://workflow_runtime:'+password+'@127.0.0.1:'+refreshed['HostPort']+'/workflow?connect_timeout=5'
        second=worker(True);assert second['values']['completed'] and second['next']==[]
        assert sql('SELECT count(*) FROM node_calls;')=='1'
        assert sql("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='workflow_runtime';")=='f'
        result.update(result='PASS',first_process=first,new_process_after_sigkill=second,evidence_node_calls=1,checkpoint_tables=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"))
    except Exception as error:result.update(result='FAIL',error=str(error));raise
    finally:
        result['server_log']=docker('logs',NAME,check=False).stderr.decode(errors='replace')[-3000:]
        result['container_removed']=docker('rm','-f',NAME,check=False).returncode==0
        result['volume_removed']=docker('volume','rm',VOLUME,check=False).returncode==0
        (HERE/'evidence/pg-saver.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'result':result['result']}))


if __name__=='__main__':main()
