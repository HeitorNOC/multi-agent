"""Standard-library client for the shared local qualification contract."""
import asyncio
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError


class Rejected(Exception):
    def __init__(self, code, body):
        self.code, self.body = code, body
        super().__init__(f'{code}: {body}')


def request(url, token, path, payload=None):
    req = Request(url+path, data=json.dumps(payload).encode() if payload is not None else None,
                  headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=20) as response:
            return json.load(response)
    except HTTPError as error:
        raise Rejected(error.code, error.read().decode()) from error


class Client:
    def __init__(self, config):
        self.config = config

    async def call(self, path, payload=None):
        return await asyncio.to_thread(request, self.config['url'], self.config['token'], path, payload)
