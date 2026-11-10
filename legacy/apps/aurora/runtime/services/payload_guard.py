"""Closed synthetic corpus gate. Never prints credentials or blocked payloads."""

import hashlib
import json
from pathlib import Path

CORPUS = Path(__file__).resolve().parents[4] / "demo-enterprise/corpus.json"


class PayloadGuard:
    def __init__(self, expected_sha, secrets=(), corpus=CORPUS, expected_count=3):
        raw = corpus.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected_sha:
            raise ValueError("synthetic corpus manifest changed")
        self.manifest = json.loads(raw)
        if (
            self.manifest.get("fixture_only") is not True
            or len(self.manifest["documents"]) != expected_count
        ):
            raise ValueError("explicit synthetic corpus required")
        self.allowed = {
            (d["source"], d["version"]): d["content"] for d in self.manifest["documents"]
        }
        self.secrets = [value for value in secrets if isinstance(value, str) and len(value) >= 12]

    def source(self, payload, content):
        if self.allowed.get((payload["source"], payload["version"])) != content:
            raise ValueError("source outside closed synthetic allowlist")
        if hashlib.sha256(content.encode()).hexdigest() != payload["content_sha"]:
            raise ValueError("synthetic content hash mismatch")
        self.prompt(content)

    def prompt(self, value):
        text = (
            value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
        )
        if any(secret in text for secret in self.secrets):
            raise ValueError("credential detected before inference; payload blocked")
