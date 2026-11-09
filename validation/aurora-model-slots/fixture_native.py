"""Launch the native HTTP service with a deterministic, crashable model transport."""
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'brain-recovery'))
from native import main
import model_slots

original_request = model_slots.request


def crash_before_authority_commit(config, **request):
    if request['action'] == 'model_slot_commit' and config.get('fixture_commit_crash'):
        os._exit(85)
    return original_request(config, **request)


model_slots.request = crash_before_authority_commit


class Fixture:
    def __init__(self, config):
        self.calls = Path(config['fixture_calls'])

    async def run_reserved(self, prompt, system_prompt, id, number):
        with self.calls.open('a',encoding='utf-8') as output:
            output.write(json.dumps({'id':id,'number':number})+'\n')
        if prompt == 'Interromper antes do recibo' or prompt.startswith('Você é '):
            if prompt.startswith('Você é Chief of Staff do Grupo Aurora fictício.'):
                catalog = json.loads((Path(__file__).resolve().parents[2]/'demo-enterprise/catalog.json').read_text(encoding='utf-8'))['agents']
                specialist = next(agent for agent in catalog if agent['kind']=='specialist')
                lead = specialist['parent']
                return json.dumps({'strategy':'A2','reason':'Equipe selecionada para o teste de recuperação.',
                    'teams':[{'lead':lead,'specialists':[specialist['id']],'reason':'Teste de delegação fictício.'}],
                    'not_selected':[{'id':agent['id'],'reason':'Fora do escopo deste teste.'} for agent in catalog if agent['id'] not in (lead,specialist['id'])]})
            os._exit(84)
        await asyncio.sleep(.25)
        return '{"fixture":"resultado sintético"}'


if sys.platform=='win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
asyncio.run(main(json.loads(sys.stdin.readline()), Fixture))
