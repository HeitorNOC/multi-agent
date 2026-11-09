"""Qualify an independent signed reference for one synthetic pilot field."""

import argparse
import copy
import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from run import ROOT
from run_injection import GOAL, write_fixture

sys.path.insert(0, str(ROOT))

from apps.aurora.runtime.pilot_corpus import PilotCorpus  # noqa: E402
from apps.aurora.runtime.pilot_refund_reference import (
    FIELD,
    ISSUER,
    evaluate_refund_reference,
)  # noqa: E402
from apps.aurora.runtime.services.freshness_authority import dump  # noqa: E402


def run_cases(folder):
    as_of = datetime(2026, 11, 6, 18, tzinfo=timezone.utc)
    key = Ed25519PrivateKey.generate()
    payload = {
        "issuer": ISSUER,
        "field": FIELD,
        "source": "politica",
        "version": 1,
        "value": 15,
        "valid_from": (as_of - timedelta(days=1)).isoformat(),
        "valid_until": (as_of + timedelta(days=1)).isoformat(),
    }

    def sign(**changes):
        record = {**payload, **changes}
        return {"payload": record, "signature": key.sign(dump(record).encode()).hex()}

    def corpus_for(quote):
        manifest, _, _ = write_fixture(
            folder, (("politica", "model-approved", quote + "\n"),)
        )
        return PilotCorpus(manifest)

    good = corpus_for("O prazo de reembolso para o cliente é de 15 dias úteis.")
    good_report = good.report(GOAL, {"evidence_ids": [good.retrieve(GOAL)[0]["id"]]})
    false = corpus_for("O prazo de reembolso para o cliente é de 45 dias úteis.")
    actual = json.loads(
        (ROOT / "reports/aurora-fato-falso-integrado.json").read_bytes()
    )
    assert actual["goal"] == GOAL and actual["report"]["status"] == "supported_extracts"
    assert actual["report"]["manifest_sha256"] == false.sha256

    signed = sign()
    tampered = copy.deepcopy(signed)
    tampered["payload"]["value"] = 45
    rewritten_report = copy.deepcopy(good_report)
    rewritten_report["citations"][0]["quote"] = false.retrieve(GOAL)[0]["quote"]
    wrong_unit = corpus_for(
        "O prazo de reembolso para o cliente é de 15 dias corridos."
    )
    wrong_unit_report = wrong_unit.report(
        GOAL, {"evidence_ids": [wrong_unit.retrieve(GOAL)[0]["id"]]}
    )

    cases = [
        ("correspondencia", good, good_report, signed, "confirmed", None),
        (
            "parecer-real-com-fato-falso",
            false,
            actual["report"],
            signed,
            "divergent",
            None,
        ),
        ("sem-referencia", good, good_report, None, "unavailable", "missing_reference"),
        (
            "referencia-adulterada",
            false,
            actual["report"],
            tampered,
            "unavailable",
            "invalid_signature",
        ),
        (
            "referencia-expirada",
            good,
            good_report,
            sign(valid_until=as_of.isoformat()),
            "unavailable",
            "stale_reference",
        ),
        (
            "versao-incompativel",
            good,
            good_report,
            sign(version=2),
            "unavailable",
            "source_or_version_mismatch",
        ),
        (
            "citacao-alterada",
            good,
            rewritten_report,
            signed,
            "unavailable",
            "invalid_citation_binding",
        ),
        (
            "unidade-incompativel",
            wrong_unit,
            wrong_unit_report,
            signed,
            "unavailable",
            "unsupported_claim_format",
        ),
    ]
    results = []
    for name, corpus, report, reference, expected, reason in cases:
        result = evaluate_refund_reference(
            corpus, report, reference, key.public_key(), as_of
        )
        passed = (
            result["status"] == expected
            and result.get("reason") == reason
            and result["eligible_for_review"] == (expected == "confirmed")
        )
        results.append({"case": name, "expected": expected, "passed": passed, **result})
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "reports/aurora-referencia-financeira.json",
    )
    args = parser.parse_args()
    with args.output.open("x", encoding="utf-8") as stream:
        with tempfile.TemporaryDirectory(
            prefix="refund-reference-", dir=Path(__file__).parent
        ) as folder:
            results = run_cases(Path(folder))
        passed = all(case["passed"] for case in results)
        stream.write(
            json.dumps({"passed": passed, "field": FIELD, "cases": results}, indent=2)
            + "\n"
        )
    print(f"{sum(case['passed'] for case in results)}/{len(results)} casos passaram.")
    sys.exit(0 if passed else 1)
