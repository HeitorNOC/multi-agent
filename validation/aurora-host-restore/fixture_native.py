"""Closed Aurora data and deterministic model for the installation restore drill."""
import asyncio
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'aurora-queue'))
from fixture_complete import Fixture, main

if "--aurora-app" in sys.argv:
    sys.path.insert(0, str(HERE.parents[1]))
    from apps.aurora.runtime.services.native import main


class RestoreFixture(Fixture):
    def __init__(self, config):
        super().__init__(config)
        self.drop = Path(config['fixture_drop'])
        self.hold = Path(config['fixture_hold']) if config.get('fixture_hold') else None
        self.stages = Path(config['fixture_stages']) if config.get('fixture_stages') else None

    async def __call__(self,prompt,**kwargs):
        marker='---Input Text---\n```'
        if marker not in prompt:
            raise ValueError('unexpected model call in restore drill')
        content=prompt.split(marker,1)[1].split('```',1)[0].strip()
        if self.stages:
            with self.stages.open('a',encoding='utf-8') as stream:stream.write('extraction\n')
        separator='<|#|>'
        return '\n'.join(separator.join(row) for row in (
            ('entity','Grupo Aurora','Organization','Empresa fictícia do ensaio.'),
            ('entity','Política Aurora','Document',content),
            ('relation','Grupo Aurora','Política Aurora','política,regulamento',content),
            ('<|COMPLETE|>',),
        ))

    async def run_reserved(self,prompt,system_prompt,id,number):
        if prompt.startswith('{"objective":'):
            envelope = json.loads(prompt)
            role = envelope['role'].split(':')[0]
            context = envelope['context'] if isinstance(envelope['context'], dict) else {}
            def task(key, agent, *dependencies):
                return {'id': key, 'agent': agent, 'task': key, 'depends_on': list(dependencies)}

            assignment = context.get('assignment', {}).get('agent')
            values = {
                'chief': {'director': 'technology_director', 'roster': ['tech_lead', 'backend_engineer', 'qa_engineer', 'platform_engineer']},
                'director_assign': {'assignments': [
                    {'agent': 'tech_lead', 'task': 'Definir chave composta e transação'},
                    {'agent': 'backend_engineer', 'task': 'Implementar ingestão idempotente'},
                    {'agent': 'qa_engineer', 'task': 'Verificar os resultados do executor'},
                ]},
                'tech_lead_design': {'design': 'Chave composta por tenant e evento.'},
                'director_propose': {'requests': [
                    task('Entrada', 'backend_engineer'),
                    task('Persistencia', 'backend_engineer_2'),
                ]},
                'chief_subdelegation_review': {'approved': [
                    item['id'] for item in context.get('requests', []) if item['id'] != 'Recusar'
                ]},
                'specialist_subtask': {'result': assignment, 'requests': {
                    'backend_engineer': [
                        task('Validacao', 'backend_developer_a'),
                        task('Adaptador', 'backend_developer_b', 'Validacao'),
                    ],
                    'backend_engineer_2': [
                        task('Reentrega', 'backend_developer_c'),
                        task('Recusar', 'backend_developer_d'),
                    ],
                }.get(assignment, [])},
                'specialist_consolidate': {'result': 'Entrega consolidada.'},
                'backend_implement': {'code': (HERE.parents[1] / 'reports/aurora-engenharia-webhook/webhook.cjs').read_text(encoding='utf-8')},
                'qa_review': {'verdict': 'pass' if context.get('passed') else 'fail', 'evidence': 'Resultados do executor conferidos.'},
                'tech_lead_review': {'verdict': 'pass', 'evidence': 'A chave composta preserva o escopo por tenant.'},
                'director_review': {'action': 'human_review' if context.get('ready') else 'rework', 'reason': 'Decisão baseada nos testes e pareceres.'},
            }
            with self.calls.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps({'id': id, 'number': number, 'role': role}) + '\n')
            return json.dumps(values[role])
        if self.hold and self.hold.exists():
            with self.calls.open('a',encoding='utf-8') as stream:
                stream.write(json.dumps({'id':id,'number':number,'outcome':'held'})+'\n')
            while self.hold.exists():await asyncio.sleep(.1)
            raise RuntimeError('controlled interruption before receipt')
        if self.drop.exists():
            self.drop.unlink()
            with self.calls.open('a',encoding='utf-8') as stream:
                stream.write(json.dumps({'id':id,'number':number,'outcome':'unknown'})+'\n')
            raise RuntimeError('controlled interruption before receipt')
        return await super().run_reserved(prompt,system_prompt,id,number)


if sys.platform=='win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
asyncio.run(main(json.loads(sys.stdin.readline()),RestoreFixture))
