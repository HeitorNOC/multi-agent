"""Crash the local pilot with an in-flight receipt and reopen its persisted installation."""

import json
import os
import secrets
import sqlite3
import subprocess
from contextlib import closing
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from pilot_fixture import OPERATOR_PASSWORD
from test_launcher import HERE, PYTHON, ROOT, inspect, wait_for
from test_pilot import make_manifest, refund_reference_fixture

from apps.aurora.ops.local_session import load_resume
from apps.aurora.runtime.pilot_refund_reference import FIELD, ISSUER, REFUND_GOAL


def test_same_host_pilot_restart_preserves_connector_state(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "validation/observability-recovery"))
    from test_reference_destination import call as destination_call, destination

    manifest = make_manifest(tmp_path)
    reference_args, _, _ = refund_reference_fixture(manifest, tmp_path)
    state_root = tmp_path / "persistent-pilot"
    control, executor = secrets.token_bytes(32), secrets.token_bytes(32)
    scope = json.dumps([ISSUER, FIELD, "reembolso", 2], separators=(",", ":"))
    remote_db = tmp_path / "destination.sqlite"
    remote_config = {
        "database": str(remote_db),
        "controller": control.hex(),
        "executor": executor.hex(),
        "hold_after_commit_scope": scope,
        "drop_revoke_scope": scope,
    }
    process = record = None
    launch_count = 0

    def stop_tree():
        if process and process.poll() is None:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                check=True,
                capture_output=True,
                timeout=15,
            )
            assert process.wait(timeout=15) != 0

    def resource_names(kind):
        for resource_type, name in record["engine"]["docker_resources"]:
            if resource_type != kind:
                continue
            resource = inspect(kind, name)
            labels = (
                resource["Config"]["Labels"]
                if kind == "container"
                else resource["Labels"]
            )
            identity = resource["Id"] if kind == "container" else resource["CreatedAt"]
            assert labels["qualification"] == record["engine"]["id"]
            assert identity == record["resources"][name]
            yield name

    def launch(target):
        nonlocal process, launch_count
        launch_count += 1
        config_path = tmp_path / "destination-config.json"
        config_path.write_text(
            json.dumps(
                {"url": target, "controller": control.hex(), "executor": executor.hex()}
            ),
            encoding="utf-8",
        )
        log_path = tmp_path / f"launcher-{launch_count}.log"
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [
                    PYTHON,
                    str(HERE / "pilot_fixture.py"),
                    "--pilot-manifest",
                    str(manifest),
                    "--pilot-user",
                    "operador-teste",
                    "--pilot-viewer",
                    "consulta-teste",
                    "--pilot-recovery-lab",
                    "--state-root",
                    str(state_root),
                    *reference_args,
                ],
                cwd=ROOT,
                stdout=log,
                stderr=log,
                env={
                    **os.environ,
                    "AURORA_TEST_MANIFEST": str(manifest),
                    "AURORA_TEST_DESTINATION_CONFIG": str(config_path),
                },
            )

        def address():
            lines = log_path.read_text(encoding="utf-8").splitlines()
            if process.poll() is not None:
                raise AssertionError("Launcher não iniciou; consulte os logs do ensaio")
            return next(
                (
                    json.loads(line)["url"]
                    for line in lines
                    if line.startswith('{"url":')
                ),
                None,
            )

        url = wait_for(address, timeout=70)
        cookie = None

        def request(path, data=None, key=None):
            headers = {
                "Content-Type": "application/json",
                **({"Cookie": cookie} if cookie else {}),
                **({"Idempotency-Key": key} if key else {}),
            }
            req = Request(
                url + path, None if data is None else json.dumps(data).encode(), headers
            )
            try:
                response = urlopen(req, timeout=8)
            except HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response), response.headers

        status, _, headers = request(
            "/api/pilot/login", {"id": "operador-teste", "password": OPERATOR_PASSWORD}
        )
        assert status == 200
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        wait_for(
            lambda: request("/api/state")[1]["runtime"]["phase"] == "ready", timeout=100
        )
        return request

    with destination(remote_config) as target:
        try:
            api = launch(target)
            pointer = state_root / "active.json"
            state = Path(json.loads(pointer.read_bytes())["state"])
            record = load_resume(state)

            def job_state(id_, expected):
                jobs = api("/api/state")[1]["jobs"]
                return next(
                    (
                        item
                        for item in jobs
                        if item["id"] == id_ and item["status"] == expected
                    ),
                    None,
                )

            def submit():
                status, result, _ = api("/api/jobs", {"goal": REFUND_GOAL}, uuid4().hex)
                assert status == 202
                pending = wait_for(
                    lambda: job_state(result["id"], "awaiting_approval"), timeout=30
                )
                review = pending["review"]
                intent = {
                    "id": review["hash"],
                    "scope": scope,
                    "epoch": 2,
                    "payload": review["payload"],
                }
                assert destination_call(
                    target, control, "grant", {"intent": intent}
                ) == (200, {"granted": True})
                return {"job": pending["id"], "hash": review["hash"]}

            unknown = submit()
            assert (
                destination_call(
                    target, control, "arm-before", {"id": unknown["hash"]}
                )[0]
                == 200
            )
            assert (
                api(f"/api/jobs/{unknown['job']}/approve", {"hash": unknown["hash"]})[0]
                == 202
            )
            assert (
                wait_for(lambda: job_state(unknown["job"], "failed"), timeout=30)[
                    "receipt"
                ]
                is None
            )

            committed = submit()
            assert (
                api(
                    f"/api/jobs/{committed['job']}/approve", {"hash": committed["hash"]}
                )[0]
                == 202
            )
            assert destination_call(target, control, "arrived", {}) == (
                200,
                {"arrived": True},
            )
            capture = tmp_path / "fake-provider.jsonl"
            recorded_calls = capture.read_bytes()
            status, response, _ = api("/api/pilot/revoke-reference", committed)
            assert status == 202 and response["destination"] == "pending"
            assert job_state(committed["job"], "running")["receipt"] is None
            stop_tree()
            destination_call(target, control, "release", {})
            subprocess.run(
                ["docker", "kill", *resource_names("container")],
                check=True,
                capture_output=True,
                timeout=30,
            )
            assert not (state / "parked").exists()

            api = launch(target)
            resumed = api("/api/state")[1]["runtime"]
            assert (
                resumed["resumed"] and resumed["installation"] == record["engine"]["id"]
            )
            assert job_state(committed["job"], "interrupted")["receipt"] is None
            with closing(sqlite3.connect(state / "journey.sqlite")) as db:
                assert db.execute(
                    "SELECT acknowledged FROM pilot_destination_revocations"
                ).fetchall() == [(0,)]
            status, response, _ = api("/api/pilot/revoke-reference", committed)
            assert status == 200 and response["destination"] == "acknowledged"
            assert api(f"/api/jobs/{committed['job']}/resume", {})[0] == 202
            completed = wait_for(
                lambda: job_state(committed["job"], "completed"), timeout=30
            )
            loaded = [
                event["detail"]
                for event in completed["events"]
                if event["node"] == "checkpoint_loaded"
            ]
            assert (
                loaded[-1]["next"] == ["effect"]
                and loaded[-1]["telemetry"]["checkpoint_id"]
            )
            assert (
                capture.read_bytes() == recorded_calls
                and len(recorded_calls.splitlines()) == 10
            )

            assert api("/api/pilot/connector/reconcile", unknown)[:2] == (
                200,
                {"status": "unknown"},
            )
            assert job_state(unknown["job"], "failed")["receipt"] is None
            assert api("/api/pilot/stop", {})[0] == 409
            with closing(sqlite3.connect(remote_db)) as db:
                effects = db.execute("SELECT id,receipt FROM effects").fetchall()
                assert len(effects) == 1 and effects[0][0] == committed["hash"]
                assert (
                    completed["receipt"]["destination_receipt_id"]
                    == json.loads(effects[0][1])["id"]
                )
                assert db.execute(
                    "SELECT action,intent FROM requests ORDER BY rowid"
                ).fetchall() == [
                    ("send", unknown["hash"]),
                    ("send", committed["hash"]),
                    ("lookup", committed["hash"]),
                    ("lookup", unknown["hash"]),
                ]
        finally:
            stop_tree()
            if record:
                for kind, command in (
                    ("container", ["docker", "rm", "-f"]),
                    ("volume", ["docker", "volume", "rm"]),
                ):
                    subprocess.run(
                        [*command, *resource_names(kind)],
                        check=True,
                        capture_output=True,
                        timeout=30,
                    )
