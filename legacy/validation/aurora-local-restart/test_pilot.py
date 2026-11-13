import hashlib
import json
import os
import secrets
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

import pytest
from pilot_fixture import INJECTION, OPERATOR_PASSWORD, VIEWER_PASSWORD
from test_launcher import HERE, PYTHON, ROOT, wait_for


def make_manifest(tmp_path, context=False):
    folder = tmp_path / "authorized"
    folder.mkdir()
    documents = []
    rows = [
        ("reembolso", 1, False, "model-approved", "O prazo do reembolso é de 30 dias. MARCADOR-REVOGADO."),
        ("reembolso", 2, True, "model-approved", "O prazo do reembolso é de 15 dias úteis. A contagem começa na aprovação.\nNotas de treinamento da equipe interna."),
        ("reserva", 1, True, "local-only", "O prazo do reembolso é de 90 dias. MARCADOR-LOCAL."),
        ("campanha", 1, True, "model-approved", "A campanha de publicidade usa banners de cor azul."),
    ]
    if context:
        rows.append(("ataque", 1, True, "model-approved", INJECTION))
    for source, version, current, classification, text in rows:
        name = f"{source}-{version}.txt"
        data = text.encode()
        (folder / name).write_bytes(data)
        documents.append({
            "source": source, "version": version, "current": current,
            "classification": classification, "title": name, "area": "finance",
            "origin": "ensaio controlado", "file": name, "sha256": hashlib.sha256(data).hexdigest(),
        })
        if context and source == "reembolso" and current:
            documents[-1]["context_lines"] = [1]
    manifest = folder / "manifest.json"
    manifest.write_text(json.dumps({"version": 1, "documents": documents}), encoding="utf-8")
    return manifest


def test_manifest_rejects_paths_outside_scope_and_changed_bytes(tmp_path):
    from apps.aurora.runtime.pilot_corpus import PilotCorpus

    manifest = make_manifest(tmp_path)
    config = json.loads(manifest.read_text(encoding="utf-8"))
    (manifest.parent / config["documents"][0]["file"]).write_text("alterado", encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256"):
        PilotCorpus(manifest)
    config["documents"][0]["file"] = "../fora.txt"
    manifest.write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(ValueError, match="fora da pasta"):
        PilotCorpus(manifest)


def test_provider_privacy_mode_keeps_usage_without_content(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from apps.aurora.runtime.services import codex_provider

    completed = [
        {"type": "item.completed", "item": {"type": "agent_message", "text": '{"text":"trecho-sintetico"}'}},
        {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2}},
    ]
    monkeypatch.setattr(codex_provider.shutil, "which", lambda _: "fake-codex")
    monkeypatch.setattr(
        codex_provider.subprocess, "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout="\n".join(map(json.dumps, completed)), stderr="stderr-sintetico"
        ),
    )
    provider = codex_provider.CodexProvider({
        "model_budget": str(tmp_path / "unused"),
        "evidence": str(tmp_path),
        "model_cwd": str(tmp_path),
        "instance": "fixture",
        "retain_model_content": False,
    })
    assert provider.run("pergunta-sintetica", "", [], {"id": "test", "number": 1}) == "trecho-sintetico"
    assert [p.name for p in tmp_path.iterdir()] == ["model-calls.jsonl"]
    data = (tmp_path / "model-calls.jsonl").read_text(encoding="utf-8")
    assert all(marker not in data for marker in ("trecho-sintetico", "pergunta-sintetica", "stderr-sintetico"))
    assert json.loads(data)["usage"] == [{"input_tokens": 10, "output_tokens": 2}]


def test_provider_rejects_unexpected_tool_event(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from apps.aurora.runtime.services import codex_provider

    def simulated_cli(args, **options):
        assert args[args.index("--sandbox") + 1] == "read-only"
        assert "features.shell_tool=false" in args and 'web_search="disabled"' in args
        assert "CANARIO_AMBIENTE" not in options["env"]
        events = [
            {"type": "item.started", "item": {"type": "command_execution"}},
            {"type": "item.completed", "item": {"type": "agent_message", "text": '{"text":"{}"}'}},
            {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2}},
        ]
        return SimpleNamespace(returncode=0, stdout="\n".join(map(json.dumps, events)), stderr="")

    monkeypatch.setenv("CANARIO_AMBIENTE", "valor-ficticio")
    monkeypatch.setattr(codex_provider.shutil, "which", lambda _: "fake-codex")
    monkeypatch.setattr(codex_provider.subprocess, "run", simulated_cli)
    provider = codex_provider.CodexProvider({
        "model_budget": str(tmp_path / "unused"), "evidence": str(tmp_path),
        "model_cwd": str(tmp_path), "instance": "fixture", "retain_model_content": False,
    })
    with pytest.raises(RuntimeError, match="model invocation failed") as error:
        provider.run("ataque fictício", "", [], {"id": "test", "number": 1})
    assert error.value.code == "provider_unexpected_tool"
    entry = json.loads((tmp_path / "model-calls.jsonl").read_text(encoding="utf-8"))
    assert entry["unexpected_tool_events"] == 1


def test_local_diagnostic_preserves_cause_without_payload():
    from apps.aurora.runtime.diagnostics import diagnostic

    try:
        try:
            json.loads('MARCADOR-CONFIDENCIAL')
        except ValueError as error:
            raise RuntimeError("MARCADOR-CONFIDENCIAL") from error
    except RuntimeError as error:
        record = diagnostic(error, "worker", {"slot": "synthesis", "prompt": "MARCADOR-CONFIDENCIAL"})
    assert [cause["code"] for cause in record["causes"]] == ["unexpected_exception", "invalid_json"]
    assert record["causes"][1]["frames"]
    assert "MARCADOR-CONFIDENCIAL" not in json.dumps(record)


def test_requirement_assessments_keep_proposals_and_pending_tests_out_of_citations():
    from apps.aurora.runtime.pilot_corpus import requirement_assessments

    questions = ["Qual estado indica atendimento ativo?", "Qual modelo de dados usar?", "O canal impede duplicação?", "Quais tópicos e schemas são documentados?"]
    rows = [
        {"status": "documented", "note": "O atendimento passa a ativo.", "evidence_ids": ["allowed"]},
        {"status": "proposal", "note": "Adotar chaves por empresa.", "evidence_ids": []},
        {"status": "test_pending", "note": "Reentregar o evento em homologação.", "evidence_ids": []},
        {"status": "partial", "note": "O tópico é conhecido, mas o schema está ausente.", "evidence_ids": ["topic"]},
    ]
    ids, gaps, assessments = requirement_assessments({"assessments": rows}, questions, {"allowed", "topic"})
    assert ids == ["allowed", "topic"]
    assert gaps == questions[1:]
    assert [row["requirement"] for row in assessments] == questions
    rows[0]["evidence_ids"] = ["outside"]
    with pytest.raises(ValueError, match="fora da tarefa"):
        requirement_assessments({"assessments": rows}, questions, {"allowed", "topic"})
    rows[0]["evidence_ids"] = []
    with pytest.raises(ValueError, match="Parecer por requisito inválido"):
        requirement_assessments({"assessments": rows}, questions, {"allowed", "topic"})


def test_requirement_labels_resolve_to_canonical_ids():
    from apps.aurora.runtime.pilot_corpus import requirement_assessments

    labels = {"E1": "a" * 64}
    row = {"status": "partial", "note": "Um tópico foi identificado.", "evidence_ids": ["E1"]}
    result = {"assessments": [row]}
    ids, gaps, assessments = requirement_assessments(
        result, ["Quais contratos foram documentados?"], labels, canonical_ids=labels
    )
    assert ids == assessments[0]["evidence_ids"] == [labels["E1"]]
    assert gaps == ["Quais contratos foram documentados?"]
    assert row["evidence_ids"] == ["E1"]
    for invalid in ("E2", labels["E1"]):
        row["evidence_ids"] = [invalid]
        with pytest.raises(ValueError, match="fora da tarefa"):
            requirement_assessments(
                result, gaps, labels, canonical_ids=labels
            )


def refund_reference_fixture(manifest, tmp_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from apps.aurora.runtime.pilot_refund_reference import FIELD, ISSUER
    from apps.aurora.runtime.services.freshness_authority import dump

    publication = json.loads(manifest.read_bytes())
    doc = next(d for d in publication["documents"] if d["source"] == "reembolso" and d["current"])
    quote = "O prazo de reembolso para o cliente é de 45 dias úteis."
    data = (quote + "\n").encode()
    (manifest.parent / doc["file"]).write_bytes(data)
    doc["sha256"] = hashlib.sha256(data).hexdigest()
    manifest.write_text(json.dumps(publication), encoding="utf-8")
    key = Ed25519PrivateKey.generate()
    path = tmp_path / "finance-reference.json"

    def publish(days):
        now = datetime.now(timezone.utc)
        payload = {
            "issuer": ISSUER, "field": FIELD, "source": doc["source"], "version": doc["version"],
            "value": days, "valid_from": (now - timedelta(minutes=1)).isoformat(),
            "valid_until": (now + timedelta(hours=1)).isoformat(),
        }
        signed = {"payload": payload, "signature": key.sign(dump(payload).encode()).hex()}
        path.write_text(json.dumps(signed), encoding="utf-8")

    publish(45)
    args = ["--pilot-refund-reference", str(path), "--pilot-refund-public-key", key.public_key().public_bytes_raw().hex()]
    return args, path, publish


@pytest.fixture
def connector_destination(tmp_path, monkeypatch):
    from apps.aurora.runtime.pilot_refund_reference import FIELD, ISSUER

    monkeypatch.syspath_prepend(str(ROOT / "validation/observability-recovery"))
    from test_reference_destination import call, destination

    control, executor = secrets.token_bytes(32), secrets.token_bytes(32)
    scope = json.dumps([ISSUER, FIELD, "reembolso", 2], ensure_ascii=False, separators=(",", ":"))
    database = tmp_path / "destination.sqlite"
    config = {"database": str(database), "controller": control.hex(), "executor": executor.hex(), "drop_send_scope": scope}
    with destination(config) as url:
        path = tmp_path / "destination-config.json"
        path.write_text(json.dumps({"url": url, "controller": control.hex(), "executor": executor.hex()}), encoding="utf-8")

        def grant(review):
            intent = {"id": review["hash"], "scope": scope, "epoch": 2, "payload": review["payload"]}
            assert call(url, control, "grant", {"intent": intent}) == (200, {"granted": True})

        yield path, database, grant


@pytest.mark.parametrize("mode", ["sentence", "context", "reference", "reference_approval", "reference_connector", "directive"])
def test_pilot_open_task_access_minimization_and_citations(tmp_path, mode, request):
    context = mode == "context"
    manifest = make_manifest(tmp_path, context=context)
    reference_args = []
    if mode == "directive":
        directive = tmp_path / "directive.txt"
        directive.write_text(
            "# Diretiva\n## Fluxo vertical obrigatório\n1. Conferir o recibo.\n",
            encoding="utf-8",
        )
        reference_args = ["--pilot-directive", str(directive)]
    if mode in ("reference", "reference_approval", "reference_connector"):
        reference_args, reference_path, publish = refund_reference_fixture(manifest, tmp_path)
    connector_env = {}
    if mode == "reference_connector":
        config_path, destination_db, grant = request.getfixturevalue("connector_destination")
        connector_env = {"AURORA_TEST_DESTINATION_CONFIG": str(config_path)}
    with (tmp_path / "launcher.log").open("w", encoding="utf-8") as log:
        launcher = subprocess.Popen(
            [PYTHON, str(HERE / "pilot_fixture.py"), "--pilot-manifest", str(manifest),
             "--pilot-user", "operador-teste", "--pilot-viewer", "consulta-teste", *reference_args],
            cwd=ROOT, stdout=log, stderr=log, env={
                **os.environ, **connector_env, "AURORA_TEST_MANIFEST": str(manifest),
                "AURORA_TEST_REFUND_REVOCATION": "1" if mode == "reference_approval" else "0",
            },
        )

        def api_address():
            if launcher.poll() is not None:
                raise AssertionError("Launcher saiu antes da prontidão")
            for line in (tmp_path / "launcher.log").read_text(encoding="utf-8").splitlines():
                if line.startswith('{"url":'):
                    return json.loads(line)["url"]
            return None

        try:
            url = wait_for(api_address)

            def call(path, body=None, cookie=None, key=None):
                request = Request(
                    url + path, None if body is None else json.dumps(body).encode(),
                    {"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {}),
                     **({"Idempotency-Key": key} if key else {})},
                )
                try:
                    response = urlopen(request, timeout=5)
                except HTTPError as error:
                    response = error
                with response:
                    return response.status, json.load(response), response.headers

            def login(id, password):
                status, _, headers = call("/api/pilot/login", {"id": id, "password": password})
                assert status == 200
                cookie = headers["Set-Cookie"]
                assert "HttpOnly" in cookie and "SameSite=Strict" in cookie
                return cookie.split(";", 1)[0]

            assert call("/api/state")[0] == 401
            assert call("/api/jobs", {"goal": "Qual é o prazo de reembolso?"})[0] == 401
            operator = login("operador-teste", OPERATOR_PASSWORD)
            viewer = login("consulta-teste", VIEWER_PASSWORD)
            wait_for(lambda: call("/api/state", cookie=operator)[1]["runtime"]["phase"] == "ready")
            status = call("/api/state", cookie=viewer)[1]
            installation = status["runtime"]["installation"]
            assert status["actor"]["role"] == "viewer"
            assert not any("content" in row for row in status["runtime"]["sources"] + status["runtime"]["history"])
            assert call("/api/jobs", {"goal": "Qual é o prazo de reembolso?"}, viewer)[0] == 403

            def submit(goal):
                status, result, _ = call("/api/jobs", {"goal": goal}, operator, uuid4().hex)
                assert status == 202
                return result["id"]

            def find(id, status):
                jobs = call("/api/state", cookie=operator)[1]["jobs"]
                return next((job for job in jobs if job["id"] == id and job["status"] == status), None)

            if mode == "directive":
                digest = hashlib.sha256(directive.read_bytes()).hexdigest()
                status, admitted, _ = call("/api/jobs", {"directive": digest}, operator, uuid4().hex)
                assert status == 202
                pending = wait_for(lambda: find(admitted["id"], "awaiting_approval"))
                report = pending["review"]["report"]
                assessments = report["requirement_assessments"]
                assert report["directive_sha256"] == digest
                assert [item["status"] for item in assessments] == ["documented", "unanswered", "documented", "documented"]
                deadline, start, requirement = report["citations"]
                assert requirement["source"] == "directive"
                assert requirement["line"] == 3
                assert requirement["sha256"] == digest
                assert assessments[3]["evidence_ids"] == [requirement["id"]]
                assert "15 dias úteis" in deadline["quote"]
                assert "contagem começa" in start["quote"]
                assert len(deadline["id"]) == len(start["id"]) == 64
                assert assessments[0]["evidence_ids"] == [deadline["id"]]
                assert assessments[2]["evidence_ids"] == [start["id"]]
                assert report["unanswered"] == ["Qual é o teto por pedido?"]
                assert call("/api/pilot/stop", {}, operator)[0] == 200
                assert launcher.wait(timeout=90) == 0
                return

            if mode == "reference_connector":
                from apps.aurora.runtime.pilot_refund_reference import REFUND_GOAL

                id_ = submit(REFUND_GOAL)
                pending = wait_for(lambda: find(id_, "awaiting_approval"))
                review = pending["review"]
                grant(review)
                assert call(f"/api/jobs/{id_}/approve", {"hash": review["hash"]}, operator)[0] == 202
                failed = wait_for(lambda: find(id_, "failed"))
                assert failed["receipt"] is None
                assert any(e["node"] == "destination_intent_recorded" for e in failed["events"])
                capture = tmp_path / "fake-provider.jsonl"
                before_resume = capture.read_bytes()
                assert len(before_resume.splitlines()) == 5
                status, revoked, _ = call("/api/pilot/revoke-reference", {"job": id_, "hash": review["hash"]}, operator)
                assert status == 200 and revoked["destination"] == "acknowledged"
                assert call(f"/api/jobs/{id_}/resume", {}, operator)[0] == 202
                completed = wait_for(lambda: find(id_, "completed"))
                loaded = [e["detail"] for e in completed["events"] if e["node"] == "checkpoint_loaded"]
                assert loaded[-1]["has_state"] and loaded[-1]["next"] == ["effect"]
                assert loaded[-1]["telemetry"]["checkpoint_id"]
                assert sum(e["node"] == "synthesis" for e in completed["events"]) == 1
                assert capture.read_bytes() == before_resume
                assert completed["receipt"]["simulated"] is True
                with closing(sqlite3.connect(destination_db)) as db:
                    receipts = db.execute("SELECT receipt FROM effects").fetchall()
                    assert len(receipts) == 1
                    assert completed["receipt"]["destination_receipt_id"] == json.loads(receipts[0][0])["id"]
                    assert db.execute("SELECT action FROM requests ORDER BY rowid").fetchall() == [("send",), ("lookup",)]
                assert call("/api/pilot/stop", {}, operator)[0] == 200
                assert launcher.wait(timeout=90) == 0
                return

            if mode == "reference_approval":
                from apps.aurora.runtime.pilot_refund_reference import REFUND_GOAL

                def pending_review():
                    publish(45)
                    job = submit(REFUND_GOAL)
                    return wait_for(lambda: find(job, "awaiting_approval"))

                def approve(job):
                    return call(f"/api/jobs/{job['id']}/approve", {"hash": job["review"]["hash"]}, operator)[0]

                good = pending_review()
                assert approve(good) == 202
                completed = wait_for(lambda: find(good["id"], "completed"))
                assert completed["receipt"]["simulated"] is True

                for change, reason in (
                    (lambda: publish(15), "refund_reference_divergent:value_mismatch"),
                    (reference_path.unlink, "refund_reference_unavailable:missing_reference"),
                ):
                    pending = pending_review()
                    original = reference_path.read_bytes()
                    change()
                    assert approve(pending) == 409
                    blocked = find(pending["id"], "rejected")
                    assert blocked and blocked["review"] == pending["review"] and not blocked.get("receipt")
                    assert any(e["node"] == "approval_reference_rejected" and e["detail"]["reason"] == reason for e in blocked["events"])
                    assert all(e["node"] != "human_approved" for e in blocked["events"])
                    reference_path.write_bytes(original)
                    assert approve(pending) == 409

                revoked = pending_review()
                reference_path.with_suffix(".revoke-after-check").touch()
                assert approve(revoked) == 202
                blocked = wait_for(lambda: find(revoked["id"], "failed"))
                assert not blocked.get("receipt")
                assert any(e["node"] == "effect_reference_rejected" and e["detail"]["reason"] == "refund_reference_unavailable:missing_reference" for e in blocked["events"])
                assert call("/api/pilot/stop", {}, operator)[0] == 200
                assert launcher.wait(timeout=90) == 0
                return

            if mode == "reference":
                from apps.aurora.runtime.pilot_refund_reference import REFUND_GOAL

                confirmed_id = submit(REFUND_GOAL)
                confirmed = wait_for(lambda: find(confirmed_id, "awaiting_approval"))
                reference = confirmed["review"]["report"]["reference_check"]
                assert reference["status"] == "confirmed"
                assert reference["sha256"] == hashlib.sha256(reference_path.read_bytes()).hexdigest()
                assert "45 dias úteis" in confirmed["review"]["report"]["citations"][0]["quote"]

                def assert_blocked(goal, reason):
                    job = submit(goal)
                    blocked = wait_for(lambda: find(job, "failed"))
                    assert blocked["review"] is None and blocked.get("receipt") is None
                    assert any(e["node"] == "review_rejected" and e["detail"]["reason"] == reason for e in blocked["events"])
                    assert call(f"/api/jobs/{job}/approve", {"hash": confirmed["review"]["hash"]}, operator)[0] == 409

                publish(15)
                assert_blocked(REFUND_GOAL, "refund_reference_divergent:value_mismatch")
                reference_path.unlink()
                assert_blocked(REFUND_GOAL, "refund_reference_unavailable:missing_reference")
                publish(45)
                assert_blocked("Qual o prazo de reembolso para o cliente?", "refund_reference_unavailable:unsupported_question")
                assert call("/api/pilot/stop", {}, operator)[0] == 200
                assert launcher.wait(timeout=90) == 0
                return

            goal = "Qual é o prazo de reembolso e qual é o teto por pedido?" if context else "Qual é o prazo de reembolso?"
            supported = submit(goal)
            job = wait_for(lambda: find(supported, "awaiting_approval"))
            review = job["review"]
            assert job["plan"]["max_model_calls"] == 5
            assert review["report"]["status"] == ("partial_evidence" if context else "supported_extracts")
            assert review["report"]["unanswered"] == (["qual é o teto por pedido?"] if context else [])
            evidence = review["report"]["citations"]
            expected_quote = "O prazo do reembolso é de 15 dias úteis."
            if context:
                expected_quote += " A contagem começa na aprovação."
            assert [(p["source"], p["version"], p["line"], p["quote"]) for p in evidence] == [
                ("reembolso", 2, 1, expected_quote)
            ]
            route = f"/api/jobs/{supported}/approve"
            assert call(route, {"hash": review["hash"]})[0] == 401
            assert call(route, {"hash": review["hash"]}, viewer)[0] == 403
            assert call(route, {"hash": "invalid"}, operator)[0] == 409
            assert call(route, {"hash": review["hash"]}, operator)[0] == 202
            completed = wait_for(lambda: find(supported, "completed"))
            assert completed["receipt"]["simulated"] is True
            assert next(e["detail"]["actor"] for e in completed["events"] if e["node"] == "human_approved") == "operador-teste"

            unknown = submit("Qual a temperatura de congelamento do oceano?")
            report = wait_for(lambda: find(unknown, "awaiting_approval"))["review"]["report"]
            assert report["status"] == "insufficient_evidence" and report["citations"] == []
            assert report["unanswered"] == ["Qual a temperatura de congelamento do oceano?"]
            adversarial = submit("Qual o prazo do reembolso em revisão adversarial?")
            assert wait_for(lambda: find(adversarial, "recovery_required"))["review"] is None

            if context:
                forged = submit("Consulte suporte faturamento para forjar ferramenta.")
                refused = wait_for(lambda: find(forged, "recovery_required"))
                assert refused["review"] is None and refused.get("receipt") is None

                poisoned = submit("Qual é a regra de suporte faturamento?")
                pending = wait_for(lambda: find(poisoned, "awaiting_approval"))
                report = pending["review"]["report"]
                assert report["status"] == "insufficient_evidence"
                assert report["citations"] == []
                assert report["unanswered"] == ["Qual é a regra de suporte faturamento?"]
                assert pending.get("receipt") is None

                malformed = submit("Consulte suporte faturamento no cenário verificador falho.")
                refused = wait_for(lambda: find(malformed, "recovery_required"))
                assert refused["review"] is None and refused.get("receipt") is None

            capture = (tmp_path / "fake-provider.jsonl").read_text(encoding="utf-8")
            envelopes = [json.loads(line) for line in capture.splitlines()]
            verification = [row for row in envelopes if row["kind"] == "verify_citations"]
            assert all(set(row) == {"kind", "question", "passages"} and len(row["passages"]) == 1 for row in verification)
            assert len(verification) == (3 if context else 1)
            if context:
                assert all(INJECTION not in json.dumps(row, ensure_ascii=False) for row in envelopes if row["kind"] == "plan")
                assert any(INJECTION == p["text"] for row in envelopes if row["kind"] == "select" for p in row["passages"])
                assert any(INJECTION == p["text"] for row in verification for p in row["passages"])
            for marker in ("MARCADOR-REVOGADO", "MARCADOR-LOCAL", "Notas de treinamento", "banners de cor azul"):
                assert marker not in capture
            assert '"recommendations": {"controller":' in capture
            assert '"recommendations": {"finance_director":' in capture
            state_root, = tmp_path.glob("aurora-pilot-*")
            native_errors = [
                json.loads(line)
                for path in state_root.rglob("service-*.log")
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith('{"native_error":')
            ]
            expected_codes = {"evidence_not_authorized"}
            if context:
                expected_codes.update({"evidence_contract", "verification_invalid_gap"})
            assert expected_codes <= {
                cause["code"] for row in native_errors for cause in row["causes"]
            }
            assert all("job" in row and "slot" in row for row in native_errors)
            diagnostic_text = json.dumps(native_errors, ensure_ascii=False)
            assert "lacuna inventada pelo modelo" not in diagnostic_text
            assert "reserva.txt" not in diagnostic_text
            assert not (state_root / "active.json").exists()
            assert not list(state_root.rglob("*.prompt.json"))
            outbox, = state_root.rglob("telemetry-outbox.sqlite")
            with closing(sqlite3.connect(outbox)) as db:
                assert db.execute("SELECT count(*) FROM artifacts").fetchone() == (0,)
            assert call("/api/pilot/logout", {}, viewer)[0] == 200
            assert call("/api/state", cookie=viewer)[0] == 401
            assert call("/api/pilot/stop", {}, operator)[0] == 200
            assert launcher.wait(timeout=90) == 0
            assert not state_root.exists()
            for command in (["ps", "-aq"], ["volume", "ls", "-q"]):
                assert not subprocess.check_output(
                    ["docker", *command, "--filter", "label=qualification=" + installation],
                    text=True, timeout=15,
                ).strip()
        finally:
            if launcher.poll() is None:
                launcher.terminate()
                launcher.wait(timeout=20)
