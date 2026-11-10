"""Check the explicitly scoped refund policy against a signed reference."""

import hashlib
import json
import re
from datetime import datetime, timezone

from cryptography.exceptions import InvalidSignature

from apps.aurora.runtime.services.freshness_authority import dump

REFUND_GOAL = "Qual é o prazo de reembolso para o cliente?"
FIELD = "refund_deadline_business_days"
ISSUER = "financeiro-ficticio"
CLAIM = re.compile(
    r"O prazo de reembolso para o cliente é de ([1-9][0-9]{0,2}) dias úteis\."
)


def evaluate_refund_reference(corpus, report, reference, public_key, as_of):
    def unavailable(reason):
        return {"status": "unavailable", "reason": reason, "eligible_for_review": False}

    if reference is None:
        return unavailable("missing_reference")
    try:
        payload = reference["payload"]
        public_key.verify(bytes.fromhex(reference["signature"]), dump(payload).encode())
    except (InvalidSignature, KeyError, TypeError, ValueError):
        return unavailable("invalid_signature")

    try:
        starts = datetime.fromisoformat(payload["valid_from"])
        expires = datetime.fromisoformat(payload["valid_until"])
        current = starts <= as_of < expires
    except (KeyError, TypeError, ValueError):
        return unavailable("invalid_validity")
    if not current:
        return unavailable("stale_reference")
    if (
        payload.get("issuer") != ISSUER
        or payload.get("field") != FIELD
        or type(payload.get("version")) is not int
        or type(payload.get("value")) is not int
        or not 1 <= payload["value"] <= 999
    ):
        return unavailable("invalid_reference_contract")

    citations = report.get("citations", [])
    if report.get("manifest_sha256") != corpus.sha256 or not citations:
        return unavailable("no_bound_citation")
    try:
        expected = corpus.report(
            REFUND_GOAL, {"evidence_ids": [p["id"] for p in citations]}
        )["citations"]
        observed = [
            {key: item[key] for key in verified}
            for item, verified in zip(citations, expected, strict=True)
        ]
    except (KeyError, TypeError, ValueError):
        return unavailable("invalid_citation_binding")
    if observed != expected:
        return unavailable("invalid_citation_binding")
    values = set()
    for item in expected:
        if (item["source"], item["version"]) != (
            payload.get("source"),
            payload["version"],
        ):
            return unavailable("source_or_version_mismatch")
        match = CLAIM.fullmatch(item["quote"])
        if match is None:
            return unavailable("unsupported_claim_format")
        values.add(int(match[1]))

    confirmed = values == {payload["value"]}
    return {
        "status": "confirmed" if confirmed else "divergent",
        "eligible_for_review": confirmed,
        "reference_value": payload["value"],
        "cited_values": sorted(values),
        "reference_issuer": payload["issuer"],
        "reference_version": payload["version"],
    }


def require_refund_reference(corpus, goal, report, path, public_key):
    if goal != REFUND_GOAL:
        raise RefundReferenceBlocked("unavailable", "unsupported_question")
    try:
        with path.open("rb") as stream:
            raw = stream.read(8193)
        if len(raw) > 8192:
            raise ValueError("reference too large")
        reference = json.loads(raw)
    except FileNotFoundError:
        reference = None
    except (OSError, ValueError) as error:
        raise RefundReferenceBlocked("unavailable", "invalid_reference_file") from error
    result = evaluate_refund_reference(
        corpus, report, reference, public_key, datetime.now(timezone.utc)
    )
    if not result["eligible_for_review"]:
        raise RefundReferenceBlocked(
            result["status"], result.get("reason", "value_mismatch")
        )
    return {
        **report,
        "reference_check": {
            "status": "confirmed",
            "field": FIELD,
            "issuer": result["reference_issuer"],
            "version": result["reference_version"],
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
    }


class RefundReferenceBlocked(ValueError):
    def __init__(self, status, reason):
        super().__init__(f"refund_reference_{status}:{reason}")
