"""Actual PostgreSQL, RLS, concurrent reservation, WAL recovery and logical restore."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

HERE=Path(__file__).resolve().parent
IMAGE='postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
NAME='production-audit-pg-'+uuid.uuid4().hex[:10]
VOLUME=NAME+'-data'
evidence={'image':IMAGE,'checks':[],'scope':'isolated local PostgreSQL canonical catalog fixture, not a full LightRAG PostgreSQL/graph deployment'}


def docker(*args,input=None,check=True):
    result=subprocess.run(['docker',*args],input=input,capture_output=True,timeout=30)
    if check and result.returncode:raise RuntimeError(result.stderr.decode(errors='replace'))
    return result


def sql(query,user='postgres',database='postgres',expect=True,label=None):
    result=docker('exec','-i',NAME,'psql','-X','-v','ON_ERROR_STOP=1','-qAt','-U',user,'-d',database,input=query.encode(),check=False)
    out=result.stdout.decode().strip();err=result.stderr.decode().strip()
    if label:evidence['checks'].append({'name':label,'expected_success':expect,'exit_code':result.returncode,'stdout':out,'stderr':err,'sql_sha256':hashlib.sha256(query.encode()).hexdigest()})
    if expect and result.returncode:raise AssertionError(label or query[:100]+': '+err)
    if not expect and not result.returncode:raise AssertionError('unexpectedly allowed: '+str(label))
    return out


def ready():
    for _ in range(100):
        if docker('exec',NAME,'pg_isready','-U','postgres',check=False).returncode==0:return
        time.sleep(.1)
    raise RuntimeError('PostgreSQL startup deadline')


def main():
    created=False
    try:
        docker('volume','create','--label','audit.owner='+NAME,VOLUME)
        docker('run','-d','--name',NAME,'--label','audit.owner='+NAME,'--network','none','--read-only','--user','postgres',
               '--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','512m','--cpus','1','--pids-limit','128',
               '--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,size=16m',
               '--mount','type=volume,src='+VOLUME+',dst=/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE)
        created=True;ready()
        evidence['version']=sql('SELECT version();')
        evidence['durability_settings']=sql('SHOW fsync; SHOW full_page_writes; SHOW synchronous_commit;')
        schema='''
CREATE EXTENSION pgcrypto;
CREATE ROLE corpus_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE reader_sales LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE reader_finance LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE ingestion LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE TABLE source_versions(source_id TEXT,version INTEGER CHECK(version>0),content TEXT NOT NULL,hash BYTEA NOT NULL,
 valid_from TIMESTAMPTZ NOT NULL,valid_to TIMESTAMPTZ,CHECK(valid_to IS NULL OR valid_to>valid_from),
 CHECK(hash=digest(content,'sha256')),PRIMARY KEY(source_id,version));
ALTER TABLE source_versions OWNER TO corpus_owner;
CREATE TABLE doc_acl(source_id TEXT,principal NAME,PRIMARY KEY(source_id,principal));
CREATE TABLE facts(id TEXT PRIMARY KEY,value TEXT);
CREATE TABLE fact_sources(fact TEXT REFERENCES facts(id),source_id TEXT,version INTEGER,
 FOREIGN KEY(source_id,version) REFERENCES source_versions(source_id,version),PRIMARY KEY(fact,source_id,version));
INSERT INTO source_versions VALUES('public',1,'Revenue 100',digest('Revenue 100','sha256'),'2026-01-01',NULL),
 ('finance',1,'SECRET_FINANCE',digest('SECRET_FINANCE','sha256'),'2026-01-01',NULL);
INSERT INTO doc_acl VALUES('public','reader_sales'),('public','reader_finance'),('finance','reader_finance');
INSERT INTO facts VALUES('derived','Joint public/private conclusion');
INSERT INTO fact_sources VALUES('derived','public',1),('derived','finance',1);
GRANT SELECT ON source_versions,doc_acl,facts,fact_sources TO reader_sales,reader_finance;
GRANT SELECT ON doc_acl TO corpus_owner;
GRANT INSERT ON source_versions TO ingestion;
ALTER TABLE source_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_acl ON source_versions USING(EXISTS(SELECT 1 FROM doc_acl a WHERE a.source_id=source_versions.source_id AND a.principal=current_user));
ALTER TABLE facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE facts FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_acl ON facts USING(EXISTS(SELECT 1 FROM fact_sources s WHERE s.fact=facts.id) AND NOT EXISTS(
 SELECT 1 FROM fact_sources s WHERE s.fact=facts.id AND NOT EXISTS(SELECT 1 FROM doc_acl a WHERE a.source_id=s.source_id AND a.principal=current_user)));
CREATE TABLE budget(id TEXT PRIMARY KEY,budget INTEGER,spent INTEGER DEFAULT 0,held INTEGER DEFAULT 0,CHECK(spent>=0 AND held>=0 AND spent+held<=budget));
INSERT INTO budget VALUES('period-A',6,0,0);
CREATE TABLE active_snapshot(singleton BOOLEAN PRIMARY KEY CHECK(singleton),snapshot TEXT NOT NULL);
CREATE TABLE snapshots(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
CREATE TABLE parts(snapshot TEXT REFERENCES snapshots(id),kind TEXT CHECK(kind IN ('graph','vector','chunks')),ready BOOLEAN,digest BYTEA CHECK(octet_length(digest)=32),PRIMARY KEY(snapshot,kind));
CREATE FUNCTION publish_snapshot(s TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM parts WHERE snapshot=s AND ready AND digest IS NOT NULL)<>3 THEN RAISE EXCEPTION 'Incomplete index generation';END IF;
 INSERT INTO active_snapshot VALUES(TRUE,s) ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot;
END$$;
INSERT INTO snapshots VALUES('g1',1),('g2',2);
INSERT INTO parts VALUES('g1','graph',TRUE,digest('g1graph','sha256')),('g1','vector',TRUE,digest('g1vector','sha256')),('g1','chunks',TRUE,digest('g1chunks','sha256'));
SELECT publish_snapshot('g1');
'''
        (HERE/'catalog_probe.sql').write_text(schema,encoding='utf-8')
        sql(schema,label='create canonical/provenance/ACL/snapshot fixtures')
        assert sql('SELECT count(*) FROM source_versions;',user='reader_sales',label='RLS public role')=='1'
        assert sql('SELECT count(*) FROM source_versions;',user='reader_finance',label='RLS finance role')=='2'
        assert sql('SELECT count(*) FROM facts;',user='reader_sales',label='derived fact requires every source grant')=='0'
        assert sql('SELECT count(*) FROM facts;',user='reader_finance',label='all provenance authorized')=='1'
        assert sql('SET ROLE corpus_owner; SELECT count(*) FROM source_versions;',label='table owner bypass positive control')=='2'
        sql('ALTER TABLE source_versions FORCE ROW LEVEL SECURITY;')
        assert sql('SET ROLE corpus_owner; SELECT count(*) FROM source_versions;',label='FORCE RLS owner no grant')=='0'
        sql("UPDATE source_versions SET content='tampered' WHERE source_id='public';",expect=False,label='content hash mismatch denied')
        sql("INSERT INTO fact_sources VALUES('derived','missing',1);",expect=False,label='dangling provenance denied')
        sql("UPDATE source_versions SET version=2;",user='ingestion',expect=False,label='ingestor cannot mutate historical version')
        sql('SET ROLE reader_finance;',user='reader_sales',expect=False,label='runtime cannot become other reader')
        sql("DELETE FROM doc_acl WHERE source_id='finance' AND principal='reader_finance';")
        assert sql('SELECT count(*) FROM facts;',user='reader_finance',label='revocation removes derived fact immediately on new query')=='0'
        sql("INSERT INTO doc_acl VALUES('finance','reader_finance');")
        sql("SELECT publish_snapshot('g2');",expect=False,label='partial index generation cannot publish')
        assert sql('SELECT snapshot FROM active_snapshot;',label='old complete snapshot remains')=='g1'
        # Unsafe illustrative policy: caller-set SQL GUC is not an authenticated identity.
        sql("CREATE TABLE unsafe_guc(domain TEXT,value TEXT);INSERT INTO unsafe_guc VALUES('public','ok'),('finance','SECRET');GRANT SELECT ON unsafe_guc TO reader_sales;ALTER TABLE unsafe_guc ENABLE ROW LEVEL SECURITY;CREATE POLICY bad_policy ON unsafe_guc USING(domain=current_setting('app.domain',true));")
        assert sql("SET app.domain='finance';SELECT value FROM unsafe_guc;",user='reader_sales',label='unsafe GUC impersonation positive control')=='SECRET'
        def reserve(_):return sql("UPDATE budget SET held=held+4 WHERE id='period-A' AND budget-spent-held>=4 RETURNING held;")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:reservations=list(pool.map(reserve,range(2)))
        assert sum(x=='4' for x in reservations)==1
        evidence['concurrent_reservations']=reservations
        # Abrupt server kill with one uncommitted canonical row.
        proc=subprocess.Popen(['docker','exec','-e','PGAPPNAME='+NAME+'-crash','-i',NAME,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        proc.stdin.write(b"BEGIN;INSERT INTO source_versions VALUES('uncommitted',1,'x',digest('x','sha256'),now(),NULL);SELECT pg_sleep(30);COMMIT;\n");proc.stdin.close();proc.stdin=None
        for _ in range(80):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+NAME+"-crash' AND query LIKE '%pg_sleep%';")=='1':break
            time.sleep(.05)
        else:raise AssertionError('uncommitted transaction not observed')
        docker('kill',NAME);proc.communicate(timeout=10);docker('start',NAME);ready()
        assert sql("SELECT count(*) FROM source_versions WHERE source_id='uncommitted';",label='WAL discards uncommitted transaction after SIGKILL')=='0'
        assert sql('SELECT count(*) FROM source_versions;',label='committed canonical rows survive crash')=='2'
        dump=docker('exec',NAME,'pg_dump','-U','postgres','-Fc','postgres').stdout
        sql('CREATE DATABASE restore_audit;')
        docker('exec','-i',NAME,'pg_restore','-U','postgres','-d','restore_audit','--exit-on-error',input=dump)
        assert sql('SELECT count(*) FROM source_versions;',database='restore_audit',user='reader_sales',label='logical restore retains data and RLS')=='1'
        assert sql("SELECT snapshot FROM active_snapshot;",database='restore_audit',label='logical restore retains active generation')=='g1'
        evidence['logical_dump']={'bytes':len(dump),'sha256':hashlib.sha256(dump).hexdigest(),'scope':'same isolated cluster; roles already exist; no PITR/key/object-store restore qualification'}
        evidence['available_extensions']=sql("SELECT name FROM pg_available_extensions WHERE name IN ('vector','age');")
        evidence['result']='PASS'
    except Exception as error:evidence['result']='FAIL';evidence['error']=str(error);raise
    finally:
        if created:
            (HERE/'evidence/postgres-server.log').write_bytes(docker('logs',NAME,check=False).stdout+docker('logs',NAME,check=False).stderr)
        assert NAME.startswith('production-audit-pg-') and VOLUME==NAME+'-data'
        evidence['container_removed']=docker('rm','-f',NAME,check=False).returncode==0
        evidence['volume_removed']=docker('volume','rm',VOLUME,check=False).returncode==0
        (HERE/'evidence/postgres.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        print(json.dumps({'result':evidence['result'],'checks':len(evidence['checks'])}))


if __name__=='__main__':main()
