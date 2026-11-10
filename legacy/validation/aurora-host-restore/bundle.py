"""Authenticate a local recovery bundle with a separate custody record."""
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import stat

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def inventory(path: Path):
    hashes = {}
    for file in sorted(path.rglob('*')):
        if file.is_symlink() or getattr(file.lstat(),'st_file_attributes',0)&stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError('bundle links are not allowed')
        if file.is_file():
            with file.open('rb') as stream:
                hashes[file.relative_to(path).as_posix()] = hashlib.file_digest(stream,'sha256').hexdigest()
    return hashes


def snapshot_db(source: Path, target: Path):
    with sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True) as origin, sqlite3.connect(target) as copy:
        origin.backup(copy)


def authority_anchor(proof):
    return {field:proof[field] for field in ('installation','head','budgets','model_slots','recovery_votes','backups')}


def require_current_authority(proof, sealed_anchor):
    if authority_anchor(proof)!=sealed_anchor:
        raise ValueError('authority differs from the sealed recovery point')


def seal(path: Path, custody: Path, key: bytes, metadata):
    nonce = secrets.token_bytes(12)
    body = json.dumps({'files':inventory(path),'metadata':metadata},ensure_ascii=False,sort_keys=True).encode()
    with (custody/'sealed-generation').open('xb') as stream:
        stream.write(nonce+AESGCM(key).encrypt(nonce,body,b'aurora-recovery-generation-1'))


def verify(path: Path, custody: Path, key: bytes):
    sealed = (custody/'sealed-generation').read_bytes()
    body = AESGCM(key).decrypt(sealed[:12],sealed[12:],b'aurora-recovery-generation-1')
    record = json.loads(body)
    if inventory(path)!=record['files']:
        raise ValueError('bundle diverges from external custody record')
    return record['metadata']
