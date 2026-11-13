"""Run the Chief's Omnichannel review loop in an isolated candidate directory."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from apps.aurora.runtime.services.codex_provider import CodexProvider
from apps.aurora.runtime.diagnostics import ProviderError

ROOT = Path(__file__).resolve().parents[3]
PLAN = ROOT / "reports/aurora-omnichannel-acervo-chief/03-chief-delegacao.json"
SOURCE = ROOT / "apps/omnichannel"
SCHEMA = Path(__file__).with_name("services") / "provider.schema.json"
CONTRACT = (
    "Responda JSON puro com decision (continue, accepted ou human_intervention) "
    "e feedback (texto). Só aceite com evidências. Se precisar de decisão, acesso "
    "ou ação humana, explique o pré-requisito e como retomar."
)
EDITABLE = re.compile(r"(?:src/(?:[\w-]+/)*[\w.-]+\.ts|test/[\w.-]+\.test\.ts|migrations/\d{3}_[\w-]+\.sql)")


def apply_candidate_changes(candidate, changes):
    if not isinstance(changes, dict) or len(changes) > 12:
        raise ValueError("Lista de alterações inválida")
    validated = []
    for name, content in changes.items():
        path = candidate / name
        if (not EDITABLE.fullmatch(name) or not path.resolve().is_relative_to(candidate)
                or not isinstance(content, str) or len(content) > 100_000):
            raise ValueError(f"Alteração fora do contrato: {name}")
        validated.append((path, content))
    for path, content in validated:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def test_candidate(candidate):
    identifier = uuid.uuid4().hex
    network = "aurora-a9-" + identifier
    database = network + "-pg"
    broker = network + "-kafka"
    password = uuid.uuid4().hex
    created = started = broker_started = False

    def docker(*args):
        return subprocess.run(
            ["docker", *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, check=True,
        ).stdout

    try:
        docker("network", "create", "--internal", network)
        created = True
        docker("run", "--pull", "never", "--rm", "-d", "--name", database, "--network", network,
               "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=omnichannel", "postgres:16-alpine")
        started = True
        docker("run", "--pull", "never", "--rm", "-d", "--name", broker, "--network", network,
               "-e", "KAFKA_NODE_ID=1", "-e", "KAFKA_PROCESS_ROLES=broker,controller",
               "-e", "KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093",
               "-e", "KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093",
               "-e", f"KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://{broker}:9092",
               "-e", "KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
               "-e", "KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
               "-e", "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT",
               "-e", "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
               "-e", "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0", "apache/kafka:4.1.0")
        broker_started = True
        docker("exec", database, "sh", "-ec",
               "for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -U postgres && exit 0; sleep 1; done; exit 1")
        (candidate / "dist").mkdir(exist_ok=True)
        output = docker(
            "run", "--pull", "never", "--rm", "--network", network, "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "1000:1000",
            "--tmpfs", "/tmp", "--tmpfs", "/work/dist:mode=1777", "--pids-limit", "128",
            "--memory", "1g", "--mount", f"type=bind,source={candidate},target=/work,readonly",
            "-w", "/work", "-e",
            f"OMNICHANNEL_TEST_DATABASE_URL=postgresql://postgres:{password}@{database}:5432/omnichannel",
            "-e", f"OMNICHANNEL_TEST_KAFKA_BROKER={broker}:9092",
            "--entrypoint", "sh", "mcr.microsoft.com/playwright:v1.63.0-noble", "-ec",
            "node node_modules/typescript/bin/tsc; node --test --test-concurrency=1 dist/test/*.test.js",
        )
        return {"exit_code": 0, "output": output.replace(password, "[redigido]")[-10000:],
                "runner": "Docker isolado: build TypeScript e testes de PostgreSQL e Kafka"}
    except subprocess.CalledProcessError as error:
        return {"exit_code": error.returncode,
                "output": (error.stdout + error.stderr).replace(password, "[redigido]")[-10000:]}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"error": type(error).__name__}
    finally:
        if broker_started:
            subprocess.run(["docker", "stop", broker], capture_output=True, timeout=30)
        if started:
            subprocess.run(["docker", "stop", database], capture_output=True, timeout=30)
        if created:
            subprocess.run(["docker", "network", "rm", network], capture_output=True, timeout=30)


def run(task_id, resume=None, human_decision=None):
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    task = next(item for item in plan["tasks"] if item["id"] == task_id)
    workspace = (Path(resume).resolve() if resume else
                 Path(tempfile.mkdtemp(prefix="omnichannel-", dir=ROOT / "validation")))
    if workspace.parent != ROOT / "validation" or not workspace.name.startswith("omnichannel-"):
        raise ValueError("Diretório de execução inválido")
    candidate = workspace / "candidate"
    def ignore_copy(directory, names):
        excluded = shutil.ignore_patterns(".git", ".env*")(directory, names)
        if Path(directory) == SOURCE:
            excluded.add("dist")
        return excluded

    if not resume:
        shutil.copytree(SOURCE, candidate, ignore=ignore_copy)
    evidence = workspace / "evidence"
    evidence.mkdir(exist_ok=True)
    shutil.copy2(SCHEMA, workspace)
    provider = CodexProvider(
        {
            "evidence": str(evidence),
            "model_budget": str(workspace / "unused"),
            "model_cwd": str(candidate),
            "instance": "omnichannel-chief-executor",
            "retain_model_content": False,
            "structured_source_changes": True,
        }
    )
    print(f"Evidências em {workspace}", flush=True)
    journal = evidence / "decisions.jsonl"
    prior = [json.loads(line) for line in journal.read_text(encoding="utf-8").splitlines()] if resume else []
    if resume and not prior:
        raise ValueError("Execução sem histórico")
    previous_human_decision = next(
        (row["result"]["decision"] for row in reversed(prior) if row["role"] == "human_decision"),
        None,
    )
    human_decision = human_decision or previous_human_decision
    call_log = evidence / "model-calls.jsonl"
    calls = [json.loads(line) for line in call_log.read_text(encoding="utf-8").splitlines()] if call_log.exists() else []
    number = max((row["call"] for row in calls), default=len(prior))
    reports = PLAN.parent
    dependencies = {
        "A4": (reports / "06-A4-capacidades-mba.md").read_text(encoding="utf-8"),
        "A4_retomada": (reports / "10-A4-evidencia-para-retomada.md").read_text(encoding="utf-8"),
        "A7": (reports / "09-A7-reteste-qa.json").read_text(encoding="utf-8"),
        "A8": "O ensaio local em Kafka 4.1 e PostgreSQL 16 passou. O canal era simulado.",
    }
    historical_receipt = evidence / "006-whatsapp-binding-proveniencia.json"
    historical_sql = evidence / "006-whatsapp-binding-historica.sql"
    if historical_receipt.is_file() and historical_sql.is_file():
        dependencies["historical_006"] = {
            "provenance": json.loads(historical_receipt.read_text(encoding="utf-8")),
            "sql": historical_sql.read_text(encoding="utf-8"),
        }

    def record(role, result):
        with (evidence / "decisions.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"role": role, "result": result}, ensure_ascii=False) + "\n")
        print(role, flush=True)

    def snapshot():
        paths = [candidate / "README.md", candidate / "package.json"]
        for folder, extension in (("src", "*.ts"), ("test", "*.ts"), ("migrations", "*.sql")):
            paths.extend(sorted((candidate / folder).rglob(extension)))
        return {
            path.relative_to(candidate).as_posix(): path.read_text(encoding="utf-8")
            for path in paths
            if path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(candidate)
        }

    def ask(role, prompt, data):
        nonlocal number
        for attempt in range(2):
            number += 1
            try:
                answer = provider.run(
                    json.dumps(data, ensure_ascii=False), prompt, [],
                    {"id": role, "number": number},
                )
                break
            except ProviderError as error:
                record("executor_error", {"stage": role, "call": number, "error": str(error)})
                if attempt == 1:
                    raise
        result = json.loads(answer)
        record(role, result)
        return result

    def chief(data):
        result = ask("chief", "Você é o Chief de Omnichannel. " + CONTRACT, data)
        if result.get("decision") not in {"continue", "accepted", "human_intervention"} or not result.get("feedback"):
            raise ValueError("Decisão inválida do Chief")
        return result

    baseline = test_candidate(candidate)
    record("baseline_tests", baseline)
    if human_decision and human_decision != previous_human_decision:
        record("human_decision", {"decision": human_decision})
    state = chief({
        "task": task,
        "dependencies": dependencies,
        "prior_decision": prior[-1] if prior else None,
        "last_chief": next((row["result"] for row in reversed(prior) if row["role"] == "chief"), None),
        "human_decision": human_decision,
        "local_tests": baseline,
        "executor": "Backend recebe os arquivos e pode devolver alterações estruturadas. "
        "O executor aplica essas alterações na candidata e roda testes com PostgreSQL isolado.",
        "scope": "O usuário autorizou leitura, escrita e testes locais na candidata. "
        "Avalie a prontidão local. A homologação com a 360dialog será feita depois que o código estiver pronto.",
        "request": "Se historical_006 estiver disponível, avalie primeiro se ela permite reproduzir o upgrade "
        "em laboratório. Separe a evidência da candidata histórica de qualquer implantação externa. "
        "Se suficiente para o laboratório, delegue um ensaio que preserve o SQL já aplicado e teste a evolução em 007. "
        "Para A9, resolva a fronteira local com A10. Se for possível decidir com "
        "evidência simulada, inclua handoff_contract no JSON com um contrato implementável que fixe estados, "
        "identidade da conversa, reserva, entradas de eventos, transições, correlação, eventos duplicados "
        "e atrasados e teste de corrida nas duas ordens. Delegue sua implementação local ao diretor sem "
        "depender de código A10 prévio. A variante real da 360dialog fica para homologação posterior. "
        "Use a evidência A4_retomada e o resultado local desta rodada.",
    })
    empty_rounds = 0
    while state["decision"] == "continue":
        assignment = ask(
            "director",
            "Você é o diretor de engenharia. Escolha apenas o menor marco executável e verificável "
            "dentro da decisão do Chief. A entrega desse marco não encerra a A9. Se a migration 005 "
            "existir sem registro no DataSource, comece por registrá-la e testar a aplicação isoladamente. "
            "Se o teste de upgrade falhar apenas na contagem de migrations, atribua essa correção "
            "isoladamente antes de delegar o tratamento de vínculos legados. "
            'Responda JSON puro com instruction (texto).',
            {"task": task, "chief": state, "dependencies": dependencies, "candidate": snapshot(),
             "human_decision": human_decision},
        )
        result = ask(
            task["owner"],
            "Você é o Backend designado pelo diretor. Revise os arquivos fornecidos e implemente as "
            "somente o marco específico atribuído. Entregue o código desse marco mesmo que outros critérios "
            "da A9 permaneçam pendentes. Retorne JSON puro com report (texto) e changes (objeto que "
            "mapeia caminhos relativos para o conteúdo integral de arquivos TypeScript ou migrations SQL). "
            "Preserve funções existentes quando possível. Use changes vazio se nenhuma correção local "
            "for necessária. A saída JSON é sua forma de entregar código. O executor aplicará seus arquivos "
            "e rodará os testes fixos com dados fictícios. Se houver parte bloqueada, entregue as correções "
            "independentes e indique o bloqueio no report.",
            {"task": task, "assignment": assignment, "chief": state,
             "candidate": snapshot(), "dependencies": dependencies, "human_decision": human_decision},
        )
        try:
            apply_candidate_changes(candidate, result["changes"])
            execution = {"report": result["report"], "files": list(result["changes"]),
                         "tests": test_candidate(candidate), "candidate_sha256": hashlib.sha256(
                             json.dumps(snapshot(), sort_keys=True, ensure_ascii=False).encode("utf-8")
                         ).hexdigest()}
        except (KeyError, ValueError, OSError) as error:
            execution = {"error": str(error)}
        record(task["owner"], execution)
        empty_rounds = 0 if execution.get("files") else empty_rounds + 1
        qa = ask(
            "qa",
            'Você é QA independente. Avalie a entrega e o relato de execução. Retorne JSON puro com '
            'findings (lista), tests_verified (lista) e recommendation (texto). Separe o relato do Backend '
            'dos campos tests e candidate_sha256 emitidos pelo executor, que documentam a execução real isolada.',
            {"task": task, "execution": execution, "candidate": snapshot(), "dependencies": dependencies},
        )
        decision = chief({"task": task, "execution": execution, "qa": qa, "dependencies": dependencies,
                       "human_decision": human_decision,
                       "empty_rounds": empty_rounds,
                       "review_guidance": "Se há duas rodadas consecutivas sem alterações, redefina "
                       "a atribuição para um marco menor e verificável ou identifique a intervenção concreta. "
                       "Se o marco passar, delegue o próximo sem dar aceite global à A9 antes de cumprir os critérios.",
                       "scope": "Aceite local com dados fictícios. A homologação com a 360dialog foi adiada pelo usuário.",
                       "previous_feedback": state["feedback"], "handoff_contract": state.get("handoff_contract")})
        if "handoff_contract" not in decision and "handoff_contract" in state:
            decision["handoff_contract"] = state["handoff_contract"]
        state = decision
    print(json.dumps(state, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task")
    parser.add_argument("--resume")
    parser.add_argument("--human-decision")
    args = parser.parse_args()
    run(args.task, args.resume, args.human_decision)

