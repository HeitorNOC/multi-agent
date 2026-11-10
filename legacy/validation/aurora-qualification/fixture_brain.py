"""Controlled LLM transport for the native graph/embedding integration exercise."""
import asyncio
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'brain-recovery'))
from native import main

CORPUS = json.loads((HERE.parent/'brain-recovery/corpus.json').read_text(encoding='utf-8'))['documents']


class CorpusFixture:
    def __init__(self, config):
        pass

    async def __call__(self,prompt,system_prompt=None,**kwargs):
        if '---Input Text---\n```' in prompt:
            document = prompt.split('---Input Text---\n```',1)[1].split('```',1)[0].strip()
            policy = 'Política de Aquisição' if 'Aquisição' in document else 'Política Remoto'
            delimiter = '<|#|>'
            return '\n'.join(delimiter.join(row) for row in (
                ('entity','ACME','Organization','Empresa fictícia ACME.'),
                ('entity',policy,'Document',document),
                ('relation','ACME',policy,'política,regulamento',document),
                ('<|COMPLETE|>',),
            ))
        if 'high_level_keywords' in prompt and 'low_level_keywords' in prompt:
            return json.dumps({'high_level_keywords':['política'],'low_level_keywords':['ACME']})
        context = (system_prompt or '')+'\n'+prompt
        for record in reversed(CORPUS):
            if record['content'] in context:
                return record['content']+' Fonte: '+record['source']+'.'
        raise ValueError('controlled model received no known retrieval context')


if sys.platform=='win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
asyncio.run(main(json.loads(sys.stdin.readline()),CorpusFixture))
