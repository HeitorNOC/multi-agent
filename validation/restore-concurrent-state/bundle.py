"""Coordinated cold bundle for this dedicated lab installation; secrets stay in .state."""
import hashlib,json,secrets,shutil,sqlite3,time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from controls import dump,sign
from maintenance import FORMAT

def source_fingerprint():
    root=Path(__file__).parent
    return {name:digest(root/name) for name in ['application.py','controls.py','coordination.py','freshness.py','freshness_authority.py','maintenance.py','schema.sql','editorial.ts','provenance.ts','codex_provider.py']}

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(s):
    root=s.backup_path;envelope=json.loads((root/'manifest.json').read_text(encoding='utf-8'));body=envelope['payload']
    # KEK is retained outside the bundle in this fixture; real KMS disaster recovery is unqualified.
    raw=(root/'keys.enc').read_bytes();keys=json.loads(AESGCM(s.bundle_keys[str(root)]).decrypt(raw[:12],raw[12:],s.id.encode()))
    if sign(keys['journal_key'],body)!=envelope['signature'] or body['installation']!=s.id:raise ValueError('bundle signature/installation mismatch')
    if body.get('format')!=FORMAT or body.get('sources')!=source_fingerprint():raise ValueError('unsupported bundle format/source revision; migration required')
    if set(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file())!=set(body['files'])|{'manifest.json'}:raise ValueError('bundle file inventory mismatch')
    for name,meta in body['files'].items():
        p=root/name
        if p.resolve().is_relative_to(root.resolve()) is False or digest(p)!=meta['sha256'] or p.stat().st_size!=meta['bytes']:raise ValueError('bundle hash mismatch: '+name)
    return keys,body

def backup(s,generation):
    snapshot=s.call('controlador','/recovery/freeze',{});inventory=snapshot['inventory']
    if getattr(s,'hold_backup',False):
        (s.state/('backup-frozen-'+generation+'.json')).write_text(dump(snapshot),encoding='utf-8')
        release=s.state/('backup-release-'+generation+'.json');deadline=time.monotonic()+30
        while not release.exists() or not json.loads(release.read_text()).get('release'):
            if time.monotonic()>deadline:raise RuntimeError('private backup hold deadline')
            time.sleep(.05)
    s.stop_apps();s.d('stop',s.kc_name);s.d('stop',s.neo_name)
    root=s.state/('joint-backup-'+generation);root.mkdir();s.backup_path=root
    try:
        for db in ['pilot','knowledge','identity']:(root/(db+'.dump')).write_bytes(s.d('exec',s.pg_name,'pg_dump','-U','postgres','-Fc',db).stdout)
        (root/'roles.sql').write_bytes(s.d('exec',s.pg_name,'pg_dumpall','-U','postgres','--globals-only').stdout)
        shutil.copytree(s.app_state,root/'application-state')
        with sqlite3.connect(s.app_config['editorial_db']) as src,sqlite3.connect(root/'editorial.sqlite') as dst:src.backup(dst)
        shutil.copytree(s.app_config['vault'],root/'vault')
        s.neo_backup(root,'dump',s.neo_volume)
        s.wrapping_key=secrets.token_bytes(32);s.bundle_keys=getattr(s,'bundle_keys',{});s.bundle_keys[str(root)]=s.wrapping_key;nonce=secrets.token_bytes(12)
        keys={'editorial_key':s.editorial_key,'journal_key':s.journal_key}
        (root/'keys.enc').write_bytes(nonce+AESGCM(s.wrapping_key).encrypt(nonce,dump(keys).encode(),s.id.encode()))
        files={p.relative_to(root).as_posix():{'bytes':p.stat().st_size,'sha256':digest(p)} for p in root.rglob('*') if p.is_file()}
        body={'installation':s.id,'generation':generation,'files':files,'inventory':inventory,'format':FORMAT,'sources':source_fingerprint(),
              'budget_floors':snapshot['budget_floors'],'authority_head':snapshot['authority_head'],'authority_seq':snapshot['authority_seq'],
              'journal_events_at_backup':len((s.state/'security-journal.jsonl').read_text().splitlines()) if (s.state/'security-journal.jsonl').exists() else 0}
        (root/'manifest.json').write_text(dump({'payload':body,'signature':sign(s.journal_key,body)}),encoding='utf-8')
        verify(s)
        s.evidence['joint_bundle']={'generation':generation,'files':files,'inventory':inventory,'budget_floors':snapshot['budget_floors'],'authority_seq':snapshot['authority_seq'],'format':FORMAT,'keys':'AES-256-GCM; KEK retained in lab memory; not KMS qualification'}
        s.evidence.setdefault('bundle_generations',[]).append(s.evidence['joint_bundle'])
        return root
    finally:
        s.d('start',s.neo_name);s.wait_neo();s.d('start',s.kc_name);s.wait_idp();s.start_apps()
        s.call('controlador','/recovery/thaw',{'token':snapshot['token']})

def restore(s):
    # Validate all inputs and unwrap keys before removing this installation's containers.
    keys,body=verify(s)
    s.restore_number=getattr(s,'restore_number',0)+1
    s.stop_apps()
    for name in [s.kc_name,s.neo_name,s.pg_name]:s.d('stop',name);s.d('rm',name)
    s.pg(s.volume('joint-restored-pg-'+str(s.restore_number)))
    roles=(s.backup_path/'roles.sql').read_text(encoding='utf-8')
    s.sql('\n'.join(x for x in roles.splitlines() if x.strip()!='CREATE ROLE postgres;'))
    for db,owner in [('pilot','app_owner'),('knowledge','knowledge_owner'),('identity','identity_owner')]:
        s.sql(f'CREATE DATABASE {db} OWNER {owner};')
        s.d('exec','-i',s.pg_name,'pg_restore','--exit-on-error','-U','postgres','-d',db,input=(s.backup_path/(db+'.dump')).read_bytes())
    neo=s.volume('joint-restored-neo-'+str(s.restore_number));s.neo_backup(s.backup_path,'load',neo);s.neo(neo);s.idp()
    target=s.state/('joint-restored-files-'+str(s.restore_number));target.mkdir()
    shutil.copytree(s.backup_path/'application-state',target/'application-state')
    shutil.copy2(s.backup_path/'editorial.sqlite',target/'editorial.sqlite');shutil.copytree(s.backup_path/'vault',target/'vault')
    s.app_state=target/'application-state';s.editorial_key=keys['editorial_key'];s.journal_key=keys['journal_key']
    s.recovered_paths={'editorial_db':str(target/'editorial.sqlite'),'vault':str(target/'vault')}
    permit={'installation':s.id,'inventory':body['inventory'],'generation':body['generation'],'format':body['format'],'budget_floors':body['budget_floors']}
    s.recovery_permit={'payload':permit,'signature':sign(s.journal_key,permit)}
    s.start_apps(restoring=True)
