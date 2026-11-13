"""Synthetic upstream inventory, independent of the restored stack. No credentials in documents."""
import asyncio,hashlib,hmac,json,time
from pathlib import Path
from aiohttp import web

async def main(c):
    async def snapshot(req):
        state=json.loads(Path(c['path']).read_text())
        if state['mode']=='unavailable':raise web.HTTPServiceUnavailable()
        body={'installation':c['installation'],'nonce':req.query.get('nonce'),
              'issued':time.time(),'sequence':state['sequence'],'complete':True,
              'documents':state['documents'],'security_head':state['security_head']}
        if state['mode']=='expired':body['issued']-=120
        if state['mode']=='replay':body['nonce']='old-challenge'
        if state['mode']=='incomplete':body['complete']=False
        raw=json.dumps(body,sort_keys=True).encode()
        signature=hmac.new(bytes.fromhex(c['secret']),raw,hashlib.sha256).hexdigest()
        if state['mode']=='bad-signature':signature='0'*64
        return web.json_response({'snapshot':body,'signature':signature})
    app=web.Application();app.router.add_get('/snapshot',snapshot)
    runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    print(json.dumps({'ready':True,'port':site._server.sockets[0].getsockname()[1]}),flush=True)
    await asyncio.Event().wait()

if __name__=='__main__':
    import sys
    asyncio.run(main(json.loads(sys.stdin.readline())))
