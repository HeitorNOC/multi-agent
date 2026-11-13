"""Exercise Aurora's engineering graph against a pinned, isolated que checkout."""

import argparse
import difflib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from apps.aurora.runtime.engineering import MAX_CALLS, build_graph  # noqa: E402
from apps.aurora.runtime.services.codex_provider import CodexProvider  # noqa: E402

from apps.aurora.runtime.engineering_que import SOURCE, SPEC, SUITE, summarize, vitest  # noqa: E402

TEST = "skips the unit of work when the provider ignores the event"
GOAL = (
    f"Acrescente um teste Vitest chamado '{TEST}' ao final do spec existente, preservando seu conteúdo. "
    "Quando verifyWebhook resolve null, execute deve retornar null e runSystem deve ter zero chamadas. "
    "Use mocks locais e siga os imports existentes. Altere apenas o arquivo spec. "
    "Use a mesma entrada fictícia e APIs públicas do teste existente. Não use rede, banco ou credenciais."
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("work", type=Path)
    args = parser.parse_args()
    checkout, work = args.checkout.resolve(), args.work.resolve()
    revision = subprocess.check_output(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
    ).strip()
    if revision != "5cf77950e29c0d203b3ee1d10471b775f6b91af4":
        raise ValueError("Revisão fora do ensaio")
    volume = (work / "volume.txt").read_text(encoding="ascii").strip()
    if not re.fullmatch(r"aurora-que-[0-9a-f]{12}", volume):
        raise ValueError("Volume fora do ensaio")
    baseline = (checkout / SPEC).read_text(encoding="utf-8")
    implementation = (checkout / SOURCE).read_text(encoding="utf-8")
    reference = summarize(vitest(volume))
    if reference["exit_code"] or reference["passed_tests"] != 11:
        raise RuntimeError(f"Linha de base divergente: {reference}")

    model = work / "model"
    model.mkdir()
    (work / "empty").mkdir()
    shutil.copyfile(
        ROOT / "apps/aurora/runtime/services/provider.schema.json",
        work / "provider.schema.json",
    )
    provider = CodexProvider(
        {
            "model_budget": str(work / "unused"),
            "evidence": str(model),
            "model_cwd": str(work / "empty"),
            "instance": "aurora-que-lab",
            "model_name": "gpt-6.1-terra",
            "retain_model_content": False,
        }
    )
    candidate = work / SPEC.name
    mutant = work / SOURCE.name
    early_return = "if (!verified) return null;"
    assert implementation.count(early_return) == 1
    mutant.write_text(
        implementation.replace(
            early_return,
            "if (!verified) { await this.unitOfWork.runSystem(input.organizationId, async () => null); return null; }",
        ),
        encoding="utf-8",
    )
    calls = []
    attempts = []

    def ask(role, task, context=None):
        if len(calls) >= MAX_CALLS:
            raise ValueError("Limite de chamadas alcançado")
        calls.append(role)
        prompt = json.dumps(
            {
                "objective": GOAL,
                "role": role,
                "task": task,
                "context": context,
                "implementation": implementation
                if role
                in ("tech_lead_design", "backend_implement:1", "backend_implement:2")
                else None,
            },
            ensure_ascii=False,
        )
        value = json.loads(
            provider.run(
                prompt,
                "Responda em JSON e mantenha a mudança limitada ao teste solicitado.",
                [],
                {"id": role, "number": len(calls)},
            )
        )
        if not isinstance(value, dict):
            raise ValueError("Resposta inválida")
        print(role, flush=True)
        return value

    def make_patch(code):
        return "".join(
            difflib.unified_diff(
                baseline.splitlines(keepends=True),
                (code.rstrip() + "\n").splitlines(keepends=True),
                fromfile="a/" + SPEC.as_posix(),
                tofile="b/" + SPEC.as_posix(),
            )
        )

    def check(code):
        if (
            not code.startswith(baseline.rstrip() + "\n")
            or len(code) - len(baseline) > 4000
        ):
            return {
                "passed": False,
                "reason": "Preserve o teste existente e acrescente apenas o caso solicitado.",
            }
        candidate.write_text(code.rstrip() + "\n", encoding="utf-8")
        diff = make_patch(code)
        patch_path = work / "que.patch"
        patch_path.write_text(diff, encoding="utf-8")
        subprocess.run(
            ["git", "-C", str(checkout), "apply", "--check", str(patch_path)],
            check=True,
        )
        overlay = ((candidate, SPEC),)
        normal = summarize(vitest(volume, mounts=overlay))
        altered = summarize(
            vitest(volume, mounts=(*overlay, (mutant, SOURCE)), filters=(SUITE[0],))
        )
        failures = [test for test in altered["tests"] if test["status"] == "failed"]
        caught = (
            altered["exit_code"] == 1
            and len(failures) == 1
            and failures[0]["name"] == TEST
            and any("not be called" in message for message in failures[0]["failures"])
        )
        outcome = {
            "passed": normal["exit_code"] == 0
            and normal["passed_tests"] == 12
            and caught,
            "suite": normal,
            "mutation": altered,
            "revision": revision,
            "scope": "Apenas o spec mudou e git apply --check passou nesta execução.",
            "diff": diff,
        }
        attempts.append(outcome)
        return outcome

    graph = build_graph(
        ask, test_code=check, baseline=baseline, filename=SPEC.name
    ).compile()
    state = graph.invoke({})
    state.pop("code")
    result = {
        "revision": revision,
        "baseline": reference,
        "attempts": attempts,
        "state": state,
        "calls": calls,
    }
    (work / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if state["decision"]["action"] != "human_review":
        raise RuntimeError("Entrega ainda requer correção")


if __name__ == "__main__":
    main()
