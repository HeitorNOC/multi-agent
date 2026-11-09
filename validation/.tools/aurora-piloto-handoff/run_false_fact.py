"""Contrast byte integrity with factual authenticity in a synthetic pilot."""

import argparse
import json
import sys
from pathlib import Path

from run import ROOT, execute
from run_injection import GOAL, write_fixture

sys.path.insert(0, str(ROOT))

from apps.aurora.runtime.pilot_corpus import PilotCorpus  # noqa: E402

EXPECTED_DAYS = 15
FALSE_DAYS = 45


def prepare(folder):
    def policy(days):
        return (
            (
                "politica",
                "model-approved",
                f"O prazo de reembolso para o cliente é de {days} dias úteis.\n",
            ),
        )

    manifest, _, documents = write_fixture(folder, policy(EXPECTED_DAYS))
    PilotCorpus(manifest)
    old_manifest = manifest.read_bytes()
    write_fixture(folder, policy(FALSE_DAYS))
    manifest.write_bytes(old_manifest)
    try:
        PilotCorpus(manifest)
    except ValueError as error:
        if "SHA-256" not in str(error):
            raise
    else:
        raise AssertionError("A adulteração sem atualizar o manifesto foi aceita")

    print("Adulteração sem atualizar o manifesto recusada.", flush=True)
    return write_fixture(folder, policy(FALSE_DAYS))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "reports/aurora-fato-falso-integrado.json"
    )
    target = parser.parse_args().output
    if target.exists():
        parser.error("O arquivo de saída deve ser novo")
    execute(prepare, GOAL, target)
    run = json.loads(target.read_bytes())
    citations = (run.get("report") or {}).get("citations", [])
    print(
        json.dumps(
            {
                "fixture_truth_days": EXPECTED_DAYS,
                "published_false_days": FALSE_DAYS,
                "falsity_reached_review": any(
                    f"{FALSE_DAYS} dias úteis" in item["quote"] for item in citations
                ),
                "status": run["status"],
            }
        ),
        flush=True,
    )
