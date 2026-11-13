"""Read-only Vitest executor for the pinned que repository."""

import json
import re
import subprocess
from difflib import unified_diff
from pathlib import Path
from tempfile import TemporaryDirectory

REVISION = "5cf77950e29c0d203b3ee1d10471b775f6b91af4"
TEST = "rejects a provider event for a different requested charge"
OBJECTIVE = (
    f"Acrescente ao final do spec um teste Vitest chamado '{TEST}'. Preserve o teste existente. "
    "Quando chargeId do pedido for diferente do chargeId do evento verificado, execute deve "
    "rejeitar com code PAYMENT_CHARGE_NOT_FOUND sem chamar runSystem. Use os imports existentes, "
    "mocks locais, dados fictícios e altere apenas o spec."
)
COMMAND = Path(
    "packages/modules/sales/src/application/commands/process-terminal-payment-webhook"
)
SOURCE = COMMAND / "process-terminal-payment-webhook.ts"
SPEC = COMMAND / "process-terminal-payment-webhook.spec.ts"
SUITE = (
    "process-terminal-payment-webhook",
    "sandbox-terminal-provider",
    "stripe-terminal-provider",
    "mercado-pago-terminal-provider",
)


def vitest(volume, *, mounts=(), filters=SUITE):
    command = [
        "docker",
        "run",
        "--rm",
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user=65534:65534",
        "--pids-limit=128",
        "--cpus=2",
        "--memory=512m",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=64m",
        "--mount",
        f"type=volume,source={volume},target=/repo,readonly",
        "--workdir",
        "/repo",
        "--entrypoint",
        "node",
    ]
    for file, target in mounts:
        command.extend(
            [
                "--mount",
                f"type=bind,source={file},target=/repo/{target.as_posix()},readonly",
            ]
        )
    command.extend(
        [
            "adaptive-webchat-executor:local",
            "node_modules/vitest/vitest.mjs",
            "run",
            "--configLoader",
            "runner",
            "--no-cache",
            "--reporter=json",
            *filters,
        ]
    )
    process = subprocess.run(command, capture_output=True, encoding="utf-8", timeout=50)
    try:
        output = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError((process.stderr + process.stdout)[-5000:]) from error
    return process.returncode, output


def summarize(result):
    status, output = result
    return {
        "exit_code": status,
        "files": output["numTotalTestSuites"],
        "passed_tests": output["numPassedTests"],
        "failed_tests": output["numFailedTests"],
        "tests": [
            {
                "name": test["fullName"],
                "status": test["status"],
                "failures": test["failureMessages"],
            }
            for file in output["testResults"]
            for test in file["assertionResults"]
        ],
    }


class QueExecutor:
    def __init__(self, root, volume):
        if not re.fullmatch(r"aurora-que-panel-[0-9a-f]{12}", volume):
            raise ValueError("Volume do que fora do perfil autorizado")
        label = subprocess.check_output(
            [
                "docker",
                "volume",
                "inspect",
                "--format",
                '{{index .Labels "aurora.que.revision"}}',
                volume,
            ],
            text=True,
            timeout=12,
        ).strip()
        if label != REVISION:
            raise ValueError("Volume do que vinculado a outra revisão")
        self.volume = volume
        checkout = root / "validation/aurora-engineering/.state/que-5cf7795"
        self.baseline, self.implementation = (
            subprocess.check_output(
                ["git", "-C", str(checkout), "show", f"{REVISION}:{file.as_posix()}"],
                encoding="utf-8",
                timeout=12,
            )
            for file in (SPEC, SOURCE)
        )

    def patch(self, code):
        return "".join(
            unified_diff(
                self.baseline.splitlines(keepends=True),
                (code.rstrip() + "\n").splitlines(keepends=True),
                fromfile="a/" + SPEC.as_posix(),
                tofile="b/" + SPEC.as_posix(),
            )
        )

    def check(self, code):
        if (
            not code.startswith(self.baseline.rstrip() + "\n")
            or len(code) > len(self.baseline) + 4000
        ):
            return {
                "passed": False,
                "log": "Preserve o spec e acrescente apenas o teste solicitado.",
            }
        with TemporaryDirectory(prefix="aurora-que-") as directory:
            root = Path(directory)
            baseline = root / SPEC
            baseline.parent.mkdir(parents=True)
            baseline.write_bytes(self.baseline.encode("utf-8"))
            candidate = root / SPEC.name
            candidate.write_bytes((code.rstrip() + "\n").encode("utf-8"))
            diff = self.patch(code)
            patch = root / "que.patch"
            patch.write_bytes(diff.encode("utf-8"))
            subprocess.run(
                ["git", "apply", "--check", str(patch)],
                cwd=root,
                check=True,
                capture_output=True,
                timeout=15,
            )
            mutant = root / SOURCE.name
            guard = "if (input.chargeId && verified.chargeId !== input.chargeId)"
            if self.implementation.count(guard) != 1:
                raise ValueError("Barreira de regressão ausente na revisão fixada")
            mutant.write_bytes(
                self.implementation.replace(guard, "if (false)").encode("utf-8")
            )
            overlay = ((candidate, SPEC),)
            suite = summarize(vitest(self.volume, mounts=overlay))
            mutation = summarize(
                vitest(
                    self.volume,
                    mounts=(*overlay, (mutant, SOURCE)),
                    filters=(SUITE[0],),
                )
            )
        failures = [test for test in mutation["tests"] if test["status"] == "failed"]
        caught = (
            mutation["exit_code"] == 1
            and len(failures) == 1
            and failures[0]["name"] == TEST
        )
        return {
            "passed": suite["exit_code"] == 0
            and suite["passed_tests"] == 12
            and caught,
            "exit_code": suite["exit_code"],
            "log": f"{suite['passed_tests']} testes passaram · regressão detectada: {'sim' if caught else 'não'}\ngit apply --check passou em {REVISION}.",
            "diff": diff,
            "evidence": {"suite": suite, "mutation": mutation},
        }
