"""Independent synthetic provider; its receipts deliberately survive stack restore."""

import asyncio
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from pathlib import Path

from aiohttp import web


async def main(c):
    path = Path(c["path"])
    path.parent.mkdir(parents=True, exist_ok=True)

    def db():
        return sqlite3.connect(path, timeout=10)

    with db() as d:
        d.execute(
            "CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY,digest TEXT,receipt TEXT,run TEXT)"
        )
        d.execute(
            "CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,action TEXT,key TEXT)"
        )
    fault = False

    async def rpc(req):
        nonlocal fault
        raw = await req.read()
        signature = hmac.new(bytes.fromhex(c["secret"]), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, req.headers.get("x-signature", "")):
            raise web.HTTPForbidden()
        p = json.loads(raw)
        if abs(p["issued"] - time.time()) > 60:
            raise web.HTTPForbidden()
        if p["action"] == "fault":
            fault = True
            return web.json_response({"armed": True})
        key = p["key"]
        with db() as d:
            d.execute("BEGIN IMMEDIATE")
            row = d.execute(
                "SELECT digest,receipt,run FROM receipts WHERE key=?", (key,)
            ).fetchone()
            d.execute("INSERT INTO requests(action,key) VALUES(?,?)", (p["action"], key))
            if row and row[0] != p["digest"]:
                raise web.HTTPConflict(text="intent payload collision")
            if p["action"] == "send" and not row:
                row = (p["digest"], secrets.token_hex(12), p["run"])
                d.execute("INSERT INTO receipts VALUES(?,?,?,?)", (key, *row))
        if p["action"] == "send" and fault:
            fault = False
            req.transport.close()
            return web.Response()
        return web.json_response(
            {
                "found": bool(row),
                "receipt": row[1] if row else None,
                "source_run": row[2] if row else None,
                "deliveries": 1 if row else 0,
            }
        )

    app = web.Application()
    app.router.add_post("/rpc", rpc)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    print(json.dumps({"ready": True, "port": site._server.sockets[0].getsockname()[1]}), flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    import sys

    asyncio.run(main(json.loads(sys.stdin.readline())))
