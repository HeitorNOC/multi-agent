"""Policy regression for already-published replay; no model or infrastructure fixtures."""
import ast,asyncio,hashlib,hmac,json
from pathlib import Path
import pytest

# Compile the exact route from the real source, without importing unrelated AI engines.
tree=ast.parse((Path(__file__).parent/'application.py').read_text(encoding='utf-8'))
api=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='API')
route=next(n for n in api.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_business_dispatch')
module=ast.fix_missing_locations(ast.Module(body=[ast.ClassDef(name='Route',bases=[],keywords=[],body=[route],decorator_list=[])],type_ignores=[]))
scope={'asyncio':asyncio,'hashlib':hashlib,'hmac':hmac,'json':json,'sha':lambda s:hashlib.sha256(s.encode()).hexdigest()}
exec(compile(module,'application.py:_business_dispatch','exec'),scope)
API=scope['Route']

class Request(dict):
    path='/publish';method='POST';can_read_body=True
    async def json(self):return {'id':'draft'}

class Subject(API):
    def __init__(self,permitted,published=True):
        self.c={'installation':'unit','editorial_key':'ab'*32};self.lock=asyncio.Lock();self.recovering=False
        self.permitted=permitted;self.published=published;self.commits=0;self.checks=0
    async def allowed(self,actor,source):
        self.checks+=1
        if not self.permitted:raise PermissionError('current source grant required')
        return 'publico'
    async def editorial(self,actor,p):
        if p['action']=='prepare':
            payload={'installation':'unit','source':'politica-remoto','content_sha':hashlib.sha256(b'content').hexdigest()}
            sig=hmac.new(bytes.fromhex(self.c['editorial_key']),json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode(),hashlib.sha256).hexdigest()
            return {'payload':payload,'signature':sig,'content':'content','published':self.published}
        assert p['action']=='commit';self.commits+=1;return {'id':'draft','state':'published'}

@pytest.mark.parametrize('published',[False,True])
def test_current_grant_required_even_for_published_replay(published):
    s=Subject(False,published)
    with pytest.raises(PermissionError):asyncio.run(s._business_dispatch(Request(actor={'id':'board','role':'board'})))
    assert s.commits==0
def test_authorized_published_replay_checks_grant_without_new_publication():
    s=Subject(True)
    assert asyncio.run(s._business_dispatch(Request(actor={'id':'board','role':'board'})))=={'id':'draft','state':'published'}
    assert s.checks==1 and s.commits==1
