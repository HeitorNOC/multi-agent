"""Bancada: signed retained high-watermark and immutable local commit receipts."""

import asyncio
import hashlib
import hmac
import secrets
import time
import uuid

import aiohttp
from aiohttp import web
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from apps.aurora.runtime.services.freshness_authority import dump, sha


def verify(proof, public, installation, nonce, now=None):
    body = proof["payload"]
    now = time.time() if now is None else now
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(public)).verify(
            bytes.fromhex(proof["signature"]), dump(body).encode()
        )
    except Exception:
        raise ValueError("authority signature invalid")
    if (
        body["installation"] != installation
        or body["nonce"] != nonce
        or abs(now - body["issued"]) > 30
    ):
        raise ValueError("authority proof nonce/time/installation invalid")
    rows = body["operations"]
    if (
        body["seq"] != len(rows)
        or sha(rows) != body["head"]
        or [r["seq"] for r in rows] != list(range(1, len(rows) + 1))
    ):
        raise ValueError("authority completeness invalid")
    return body


class Freshness:
    async def authority_request(self, **p):
        nonce = secrets.token_hex(24)
        p.update(nonce=nonce, issued=time.time())
        raw = dump(p).encode()
        sig = hmac.new(bytes.fromhex(self.c["freshness_secret"]), raw, hashlib.sha256).hexdigest()
        try:
            async with self.http.post(
                self.c["freshness_url"], data=raw, headers={"x-signature": sig}
            ) as response:
                if response.status != 200:
                    raise ValueError("retained authority unavailable or rejected request")
                proof = await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            raise web.HTTPServiceUnavailable(text="retained authority unavailable; fenced")
        return verify(proof, self.c["freshness_public"], self.c["installation"], nonce)

    async def fresh_begin(self, kind, key, input):
        id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, self.c["installation"] + ":" + kind + ":" + str(key))
        )
        proof = await self.authority_request(
            action="begin",
            id=id,
            kind=kind,
            input_sha=sha(input),
            context={
                "key": str(key),
                **{
                    k: input[k]
                    for k in ("owner", "source", "request_id", "fingerprint")
                    if k in input
                },
            },
        )
        row = next(r for r in proof["operations"] if r["id"] == id)
        await self.fault("after_fresh_intent")
        return row

    async def fresh_finish(self, ticket, outcome):
        text = dump(outcome)
        digest = hashlib.sha256(text.encode()).hexdigest()
        existing = await self.writer.fetchrow(
            "SELECT * FROM freshness_receipts WHERE seq=$1", ticket["seq"]
        )
        if existing:
            if existing["id"] != uuid.UUID(ticket["id"]) or existing["sha256"] != digest:
                raise ValueError("local operation receipt is immutable")
        else:
            await self.writer.execute(
                "INSERT INTO freshness_receipts VALUES($1,$2,$3,$4,$5)",
                ticket["seq"],
                uuid.UUID(ticket["id"]),
                ticket["kind"],
                text,
                digest,
            )
        await self.fault("after_fresh_receipt")
        await self.authority_request(action="complete", id=ticket["id"], receipt_sha=digest)

    async def freshness_status(self):
        proof = await self.authority_request(action="proof")
        local = [
            {"seq": r["seq"], "id": str(r["id"]), "kind": r["kind"], "receipt_sha": r["sha256"]}
            for r in await self.writer.fetch("SELECT * FROM freshness_receipts ORDER BY seq")
        ]
        remote = [
            {k: r[k] for k in ("seq", "id", "kind", "receipt_sha")} for r in proof["operations"]
        ]
        pending = [r for r in remote if r["receipt_sha"] is None]
        missing = [r for r in remote if r not in local]
        return {
            "seq": proof["seq"],
            "head": proof["head"],
            "pending": pending,
            "missing": missing,
            "matches": not pending and local == remote,
            "local_count": len(local),
        }

    async def freshness_require(self):
        status = await self.freshness_status()
        if not status["matches"]:
            raise ValueError(
                "retained authority ahead or pending; restore stale/uncertain; no override"
            )
        return status

    async def start_freshness(self):
        try:
            await self.freshness_require()
        except Exception:
            self.recovering = True
            await self.db.execute("UPDATE recovery_control SET recovering=TRUE")

    async def dispatch(self, req):
        if req.path == "/freshness/status":
            if req["actor"]["role"] != "board":
                raise PermissionError("governance required")
            return await self.freshness_status()
        if req.path == "/recovery/open":
            if req["actor"]["role"] != "board":
                raise PermissionError("governance required")
            await self.freshness_require()
        return await self._business_dispatch(req)
