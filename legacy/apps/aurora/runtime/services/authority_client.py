"""Authenticated synchronous transport for budget reservations; verifies signed response."""

import hashlib
import hmac
import json
import secrets
import time
from urllib.request import Request, urlopen

from apps.aurora.runtime.services.freshness import verify
from apps.aurora.runtime.services.freshness_authority import dump


def request(c, **p):
    nonce = secrets.token_hex(24)
    p.update(nonce=nonce, issued=time.time())
    raw = dump(p).encode()
    sig = hmac.new(bytes.fromhex(c["freshness_secret"]), raw, hashlib.sha256).hexdigest()
    with urlopen(
        Request(c["freshness_url"], raw, {"content-type": "application/json", "x-signature": sig}),
        timeout=30,
    ) as r:
        proof = json.load(r)
    return verify(proof, c["freshness_public"], c["installation"], nonce)
