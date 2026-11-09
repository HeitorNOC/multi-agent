import asyncio
import json
from urllib.request import Request,urlopen
from urllib.error import HTTPError


class Rejected(Exception):
    def __init__(self,status,text):self.status=status;super().__init__(f'{status}: {text}')


def request(url,path,token=None,data=None,method=None):
    headers={'content-type':'application/json'}
    if token:headers['authorization']='Bearer '+token
    req=Request(url+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
    try:
        with urlopen(req,timeout=90) as response:return json.load(response)
    except HTTPError as e:raise Rejected(e.code,e.read().decode()) from e


async def call(config,path,data=None):return await asyncio.to_thread(request,config['api'],path,config['token'],data)
