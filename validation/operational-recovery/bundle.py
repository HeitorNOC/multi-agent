"""Coordinated cold bundle for this dedicated lab installation; secrets stay in .state."""
import hashlib,json,secrets,shutil,sqlite3
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from controls import dump,sign

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(s):
    root=s.backup_path;envelope=json.loads((root/'manifest.json').read_text(encoding='utf-8'));body=envelope['payload']
    # KEK is retained outside the bundle in this fixture; real KMS disaster recovery is unqualified.
    raw=(root/'keys.enc').read_bytes();keys=json.loads(AESGCM(s.wrapping_key).decrypt(raw[:12],raw[12:],s.id.encode()))
    if sign(keys['journal_key'],body)!=envelope['signature'] or body['installation']!=s.id:raise ValueError('bundle signature/installation mismatch')
    if set(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file())!=set(body['files'])|{'manifest.json'}:raise ValueError('bundle file inventory mismatch')
    for name,meta in body['files'].items():
        p=root/name
        if p.resolve().is_relative_to(root.resolve()) is False or digest(p)!=meta['sha256'] or p.stat().st_size!=meta['bytes']:raise ValueError('bundle hash mismatch: '+name)
    return keys,body

def backup(s):
    inventory=s.call('aprovador','/recovery/inventory',{})
    # Single process/lab writer; stop app and IdP before database dumps and canonical snapshot.
    s.stop_app();s.d('stop',s.kc_name);s.d('stop',s.neo_name)
    root=s.state/'joint-backup';root.mkdir();s.backup_path=root
    try:
        for db in ['pilot','knowledge','identity']:(root/(db+'.dump')).write_bytes(s.d('exec',s.pg_name,'pg_dump','-U','postgres','-Fc',db).stdout)
        (root/'roles.sql').write_bytes(s.d('exec',s.pg_name,'pg_dumpall','-U','postgres','--globals-only').stdout)
        shutil.copytree(s.app_state,root/'application-state')
        with sqlite3.connect(s.app_config['editorial_db']) as src,sqlite3.connect(root/'editorial.sqlite') as dst:src.backup(dst)
        shutil.copytree(s.app_config['vault'],root/'vault')
        s.neo_backup(root,'dump',s.neo_volume)
        s.wrapping_key=secrets.token_bytes(32);nonce=secrets.token_bytes(12)
        keys={'editorial_key':s.editorial_key,'journal_key':s.journal_key}
        (root/'keys.enc').write_bytes(nonce+AESGCM(s.wrapping_key).encrypt(nonce,dump(keys).encode(),s.id.encode()))
        files={p.relative_to(root).as_posix():{'bytes':p.stat().st_size,'sha256':digest(p)} for p in root.rglob('*') if p.is_file()}
        body={'installation':s.id,'generation':'joint-g1','files':files,'inventory':inventory,
              'journal_events_at_backup':len((s.state/'security-journal.jsonl').read_text().splitlines()) if (s.state/'security-journal.jsonl').exists() else 0}
        (root/'manifest.json').write_text(dump({'payload':body,'signature':sign(s.journal_key,body)}),encoding='utf-8')
        verify(s)
        s.evidence['joint_bundle']={'generation':'joint-g1','files':files,'inventory':inventory,'keys':'AES-256-GCM; KEK retained in lab memory; not KMS qualification'}
        return root
    finally:
        s.d('start',s.neo_name);s.wait_neo();s.d('start',s.kc_name);s.wait_idp();s.start_app()

def restore(s):
    # Validate all inputs and unwrap keys before removing this installation's containers.
    keys,body=verify(s)
    s.stop_app()
    for name in [s.kc_name,s.neo_name,s.pg_name]:s.d('stop',name);s.d('rm',name)
    s.pg(s.volume('joint-restored-pg'))
    roles=(s.backup_path/'roles.sql').read_text(encoding='utf-8')
    s.sql('\n'.join(x for x in roles.splitlines() if x.strip()!='CREATE ROLE postgres;'))
    for db,owner in [('pilot','app_owner'),('knowledge','knowledge_owner'),('identity','identity_owner')]:
        s.sql(f'CREATE DATABASE {db} OWNER {owner};')
        s.d('exec','-i',s.pg_name,'pg_restore','--exit-on-error','-U','postgres','-d',db,input=(s.backup_path/(db+'.dump')).read_bytes())
    neo=s.volume('joint-restored-neo');s.neo_backup(s.backup_path,'load',neo);s.neo(neo);s.idp()
    target=s.state/'joint-restored-files';target.mkdir()
    shutil.copytree(s.backup_path/'application-state',target/'application-state')
    shutil.copy2(s.backup_path/'editorial.sqlite',target/'editorial.sqlite');shutil.copytree(s.backup_path/'vault',target/'vault')
    s.app_state=target/'application-state';s.editorial_key=keys['editorial_key'];s.journal_key=keys['journal_key']
    s.recovered_paths={'editorial_db':str(target/'editorial.sqlite'),'vault':str(target/'vault')}
    permit={'installation':s.id,'inventory':body['inventory'],'generation':body['generation']}
    s.recovery_permit={'payload':permit,'signature':sign(s.journal_key,permit)}
    s.start_app(restoring=True)
