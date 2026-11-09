"""Deterministic provider for the complete Aurora incident workflow."""
import asyncio
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'validation/brain-recovery'))
from native import main

AGENTS=json.loads((ROOT/'demo-enterprise/catalog.json').read_text(encoding='utf-8'))['agents']
SPECIALIST=next(a for a in AGENTS if a['kind']=='specialist' and 'aurora-incident' in a['sources'])
LEAD=SPECIALIST['parent']


class Fixture:
    def __init__(self,config):
        self.calls=Path(config['fixture_calls'])
        self.provider_lock=asyncio.Lock()

    async def run_reserved(self,prompt,system_prompt,id,number):
        with self.calls.open('a',encoding='utf-8') as stream:
            stream.write(json.dumps({'id':id,'number':number})+'\n')
        if prompt.startswith('Você é Chief of Staff do Grupo Aurora fictício.'):
            value={'strategy':'A2','reason':'Equipe mínima para o incidente fictício.',
                   'teams':[{'lead':LEAD,'specialists':[SPECIALIST['id']],'reason':'Escopo do incidente de teste.'}],
                   'not_selected':[{'id':a['id'],'reason':'Fora do escopo fictício.'} for a in AGENTS if a['id'] not in (LEAD,SPECIALIST['id'])]}
        elif prompt.startswith('Você é Chief of Staff. Pedido:'):
            facts={'potential_records':1200,'confirmed_exfiltration':False,'response_sla_minutes':90,
                   'minutes_elapsed':25,'minutes_remaining':65}
            value={'summary':'Parecer sintético para testar fluxo completo e aprovação.',
                   'action':'Registrar o checklist fictício no comitê local da bancada.',
                   'facts':[{'key':key,'value':value,'sources':['aurora-incident']} for key,value in facts.items()],
                   'cited_sources':['aurora-incident'],'risks':[],'conditions':[],'requires_approval':True}
        else:
            value={'facts':[],'risks':[],'recommendation':'Análise fictícia.'}
        # Match the native Codex adapter's serialized access to the model.
        async with self.provider_lock:
            await asyncio.sleep(.15)
        return json.dumps(value,ensure_ascii=False)


if __name__=='__main__':
    if sys.platform=='win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(json.loads(sys.stdin.readline()),Fixture))
