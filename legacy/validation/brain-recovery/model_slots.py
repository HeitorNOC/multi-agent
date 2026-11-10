"""Durable direct model calls. The workflow and its checkpoint stay in LangGraph."""
import asyncio
import hashlib
import json
import sqlite3

from authority_client import request
from freshness_authority import dump, sha


class ModelSlots:
    def __init__(self, path, config, generate):
        self.config = config
        self.installation = config['installation']
        self.prefix = self.installation + ':model:'
        self.generate = generate
        self.active = {}
        self.admission_lock = asyncio.Lock()
        # One writer for this native receipt store. Process death releases the lease.
        self.owner = sqlite3.connect(str(path) + '.owner', timeout=0)
        self.owner.execute('BEGIN EXCLUSIVE')
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('''CREATE TABLE IF NOT EXISTS slots(
            job TEXT, slot TEXT, prompt_sha TEXT, status TEXT, result TEXT,
            PRIMARY KEY(job,slot))''')

    def close(self):
        self.db.close()
        self.owner.close()

    async def authority(self, action='list', **fields):
        return await asyncio.to_thread(request, self.config, action='model_slot_' + action, **fields)

    def binding(self, job, slot, prompt):
        context = {'installation':self.installation, 'job':job, 'slot':slot,
                   'input_sha':hashlib.sha256(prompt.encode()).hexdigest(), 'owner':'operador-local-demo'}
        return self.prefix + sha([job,slot]), context

    def local(self, context):
        row = self.db.execute('SELECT prompt_sha,status,result FROM slots WHERE job=? AND slot=?',
                              (context['job'],context['slot'])).fetchone()
        if row and (row[0] != context['input_sha'] or row[1] != 'completed'):
            raise ValueError('recibo local legado ou incompatível')
        return json.loads(row[2]) if row else None

    async def receipt(self, item):
        value = self.local(item['context'])
        if value is None or item['receipt_sha'] not in (None, sha(value)):
            raise ValueError('recibo ausente ou divergente')
        if item['state'] != 'completed':
            await self.authority('commit', id=item['id'], receipt_sha=sha(value))
        return value

    async def execute(self, id, context, prompt, number):
        try:
            text = await self.generate(prompt, id, number)
            value = {'text':text}
            with self.db:
                self.db.execute("INSERT INTO slots VALUES(?,?,?,'completed',?)",
                                (context['job'],context['slot'],context['input_sha'],dump(value)))
            await self.authority('commit', id=id, receipt_sha=sha(value))
            return value
        finally:
            self.active.pop(id, None)

    async def run(self, job, slot, prompt, limit):
        id, context = self.binding(job,slot,prompt)
        async with self.admission_lock:
            existing = self.local(context)
            if existing is not None:
                proof = await self.authority()
                item = next((item for item in proof['model_slots'] if item['id']==id), None)
                if not item or item['context']!=context or item['state']=='closed_unknown':
                    raise ValueError('recibo local sem admissão compatível')
                return await self.receipt(item)
            proof = await self.authority('admit',id=id,context=context,limit=limit)
            number = proof['model_slot_claim']
            task = self.active.get(id)
            if number is not None:
                task = asyncio.create_task(self.execute(id,context,prompt,number))
                self.active[id] = task
                # A disconnected client may no longer await the task.
                task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
            if task is None:
                raise ValueError('slot já admitido; resultado indisponível ou encerrado')
        return await asyncio.shield(task)

    def votes(self, proof, id):
        return [dict(actor=v['actor'],reason=v['reason']) for v in proof['model_slot_votes'] if v['operation_id']==id]

    async def recovery(self, actor, command):
        # The development bridge is the authenticated identity boundary.
        if actor not in ('board','reviewer2'):
            return {'ok':False,'status':403,'code':'forbidden'}
        async with self.admission_lock:
            return await self.inspect_or_review(actor,command,await self.authority())

    async def inspect_or_review(self, actor, command, proof):
        action = command['action']
        id = command.get('case_id')
        items = proof['model_slots']
        if action == 'recovery_queue':
            cases, history = [], []
            for item in items:
                context = item['context']
                id = item['id']
                base = {'case_id':id,'job_id':context['job'],'owner_id':context['owner'],'model_slot':context['slot']}
                if item['state']=='closed_unknown':
                    history.append({**base,'operation_id':id,'outcome':'closed_unknown',
                                    'reviewers':[vote['actor'] for vote in self.votes(proof,id)]})
                elif item['state']=='completed' and self.receipt_missing(item):
                    cases.append({**base,'kind':'model_slot_receipt_unavailable','actionable':False,
                                  'status':'receipt_unavailable'})
                elif item['state']=='admitted' and self.local(context) is None:
                    active = id in self.active
                    cases.append({**base,'kind':'model_slot_unknown','actionable':not active,
                                  'status':'inference_active' if active else 'review_required'})
            return {'ok':True,'result':{'cases':cases,'history':history}}
        item = next((item for item in items if item['id']==id),None)
        if not item or id in self.active or item['state']=='completed' or self.local(item['context']) is not None:
            return {'ok':False,'status':409,'code':'model_evidence_changed'}
        context = item['context']
        evidence = sha({'id':id,'context':context,'outcome':'unknown_not_reexecuted'})
        votes = self.votes(proof,id)
        if action == 'recovery_inspect' and item['state']=='admitted':
            return {'ok':True,'result':{
                'installation_id':self.installation,'case_id':id,'operation_id':id,'operation_kind':'model_slot_unknown',
                'mode':'inference_unknown','evidence_sha':evidence,'votes':votes,
                'evidence_summary':{'input_sha':context['input_sha'],'model_slot':context['slot'],
                                    'provider_state':'pending_or_unknown','sources':[],
                                    'read_already_committed':None,'reserved_units':1,'spent_units':None}}}
        if command.get('operation_id')!=id or command.get('evidence_sha')!=evidence:
            return {'ok':False,'status':409,'code':'model_evidence_changed'}
        if action=='recovery_propose':
            await self.authority('propose',id=id,actor=actor,evidence_sha=evidence,reason=command['reason'])
            return {'ok':True,'result':{'operation_id':id,'proposed':True,'actor':actor}}
        if action=='recovery_confirm':
            if not votes or actor==votes[0]['actor']:
                return {'ok':False,'status':403,'code':'forbidden'}
            proof = await self.authority('confirm',id=id,actor=actor,evidence_sha=evidence)
            return {'ok':True,'result':{'kind':'closed_inference_unknown','operation_id':id,'job':context['job'],
                                       'evidence_sha':evidence,'approvers':[v['actor'] for v in self.votes(proof,id)]}}
        return {'ok':False,'status':400,'code':'unsupported_command'}

    def receipt_missing(self, item):
        try:
            value = self.local(item['context'])
            return value is None or sha(value)!=item['receipt_sha']
        except (ValueError,TypeError):
            return True

    async def job_status(self, job):
        async with self.admission_lock:
            proof = await self.authority()
            slots = [item for item in proof['model_slots'] if item['context']['job']==job]
            if any(item['state']=='closed_unknown' for item in slots):
                return 'closed_unknown'
            for item in slots:
                if item['state']=='completed' and self.receipt_missing(item):
                    return 'receipt_unavailable'
                if item['state']=='admitted' and self.local(item['context']) is None:
                    return 'inference_active' if item['id'] in self.active else 'review_required'
            return 'resumable'
