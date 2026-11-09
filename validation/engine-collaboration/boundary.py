"""Minimal audit harness, not the future enterprise application."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[2]


class OwnLayer:
    def __init__(self, path, http, workspace):
        self.path, self.http, self.workspace = path, http, workspace
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, digest TEXT, state TEXT, result TEXT, published INTEGER DEFAULT 0)')

    def connect(self):
        return sqlite3.connect(self.path)

    def execute(self, request):
        digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT digest,state,result FROM runs WHERE id=?', (request['run_id'],)).fetchone()
            if row:
                if row[0] != digest:
                    raise ValueError('run identity reused with different request')
                if row[1] == 'executing':
                    raise RuntimeError('uncertain execution requires review; automatic replay denied')
                return json.loads(row[2])
            db.execute('INSERT INTO runs(id,digest,state) VALUES(?,?,?)', (request['run_id'], digest, 'executing'))
        # Separate venvs/processes: no unqualified dependency merger.
        proc = subprocess.run([str(ROOT / 'validation/agentscope/.venv/Scripts/python.exe'), '-X', 'utf8',
                               str(ROOT / 'validation/engine-collaboration/engine_worker.py')],
                              input=json.dumps(request)+'\n', text=True, encoding='utf-8', capture_output=True,
                              cwd=ROOT, timeout=30)
        if proc.returncode:
            raise RuntimeError('engine failure; run remains held: '+proc.stderr[-2000:])
        result = json.loads(proc.stdout)
        if result['run_id'] != request['run_id']:
            raise ValueError('engine correlation mismatch')
        with self.connect() as db:
            db.execute('UPDATE runs SET state=?, result=? WHERE id=?', (result['status'], json.dumps(result), request['run_id']))
        return result

    def publish(self, run_id):
        with self.connect() as db:
            row = db.execute('SELECT state,result,published FROM runs WHERE id=?', (run_id,)).fetchone()
        if not row or row[0] != 'completed':
            raise PermissionError('only completed engine result can be published')
        if row[2]:
            return
        response = self.http.post('/v1/events', json={
            'type': 'workspace.message.posted', 'source': 'openagents:agent-alpha',
            'target': 'channel/'+self.workspace['channel']['name'], 'network': self.workspace['id'],
            'payload': {'content': json.dumps(json.loads(row[1]), sort_keys=True)},
            'metadata': {'enterprise_run_id': run_id, 'event_id': run_id+':result:v1', 'engine': 'agentscope'}},
            headers={'X-Workspace-Token': self.workspace['token']})
        if response.status_code != 200:
            raise RuntimeError('collaboration rejected result '+str(response.status_code))
        with self.connect() as db:
            db.execute('UPDATE runs SET published=1 WHERE id=?', (run_id,))

    def poll(self):
        response = self.http.get('/v1/events', params={'network': self.workspace['id']}, headers={'X-Workspace-Token': self.workspace['token']})
        assert response.status_code == 200, response.text
        return response.json()['data']['events']
