"""Lifecycle of Aurora's local services and dedicated database resources."""

import hashlib
import hmac
import importlib.metadata
import json
import os
import queue
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps/aurora"
BUSINESS = ROOT / "packages/aurora-business"
SERVICES = APP / "runtime/services"
PG = "pgvector/pgvector@sha256:c0cd736fe8b8b5d408db56b780570bac404fe518e66e39de624aa46f9aabc60a"
NEO = "neo4j@sha256:fe8607113c4177fbd2466bf2c30f1ebab5b9530594e86487c58c98e113145192"
MODEL_REVISION = "faf4aa4225822f3bc6376869cb1164e8e3feedd0"


def python_service(name, executable=sys.executable):
    return [str(executable), "-m", f"apps.aurora.runtime.services.{name}"]


class DatabaseResources:
    def docker(self, *args, input=None, check=True):
        result = subprocess.run(["docker", *args], input=input, capture_output=True, timeout=50)
        if check and result.returncode:
            raise RuntimeError(self.redact(result.stderr.decode(errors="replace"))[-2500:])
        return result

    def restore_postgres(self, dump):
        container = self.id + "-pg-restored-" + uuid.uuid4().hex[:6]
        volume = container + "-data"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.docker("volume", "create", "--label", "qualification=" + self.id, volume)
        self.docker_resources.append(("volume", volume))
        self.docker(
            "run",
            "-d",
            "--name",
            container,
            "--label",
            "qualification=" + self.id,
            "--user",
            "postgres",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges=true",
            "--memory",
            "512m",
            "--cpus",
            "1",
            "--pids-limit",
            "128",
            "-e",
            "POSTGRES_PASSWORD=" + self.secret,
            "--mount",
            f"type=volume,src={volume},dst=/var/lib/postgresql/data",
            "-p",
            f"127.0.0.1:{port}:5432",
            self.image,
        )
        self.docker_resources.append(("container", container))
        deadline = time.monotonic() + 45
        while self.docker(
            "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", check=False
        ).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("restored Postgres startup timeout")
            time.sleep(0.2)
        self.docker(
            "exec",
            "-i",
            container,
            "psql",
            "-Xq",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            input=f"CREATE ROLE workflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}';".encode(),
        )
        self.docker(
            "exec",
            "-i",
            container,
            "pg_restore",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "--exit-on-error",
            input=dump.read_bytes(),
        )
        self.dsn = f"postgresql://workflow_runtime:{self.secret}@127.0.0.1:{port}/postgres?options=-csearch_path%3Druntime&connect_timeout=5"
        self.container = container
        self.port = port
        self.evidence["cold_restore_new_postgres"] = {"container": container, "volume": volume}


class LocalEngine(DatabaseResources):
    def __init__(self, state):
        self.id = "business-flow-" + uuid.uuid4().hex[:10]
        self.state = state
        self.children, self.logs, self.docker_resources, self.businesses = [], [], [], []
        self.secret, self.provider_key = secrets.token_hex(24), secrets.token_hex(32)
        self.brain_key, self.embedding_key = secrets.token_hex(32), secrets.token_hex(32)
        self.tokens = {
            name: secrets.token_hex(24)
            for name in ("owner", "analyst", "board", "worker", "foreign")
        }
        self.evidence = {}
        self.native_process = None

    def redact(self, text):
        secrets_to_hide = [
            self.secret,
            self.provider_key,
            self.brain_key,
            self.embedding_key,
            getattr(self, "authority_secret", ""),
            *self.tokens.values(),
        ]
        for value in filter(None, secrets_to_hide):
            text = text.replace(value, "[redacted]")
        return text

    def start_provider(self):
        _, url = self.service(
            python_service("provider"),
            {"path": str(self.state / "provider.sqlite"), "secret": self.provider_key},
        )
        return url

    def start_embeddings(self):
        interpreter = os.environ.get(
            "AURORA_EMBEDDING_PYTHON", APP / ".embedding-venv/Scripts/python.exe"
        )
        weights = os.environ.get("AURORA_EMBEDDING_WEIGHTS", APP / ".models" / MODEL_REVISION)
        _, self.embedding_url = self.service(
            python_service("embedding_server", interpreter),
            {
                "secret": self.embedding_key,
                "weights": str(weights),
                "evidence": str(self.state / "embedding-calls.jsonl"),
                **self.embedding_options,
            },
        )

    def start_business(self):
        self.business, self.api = self.service(["node", str(BUSINESS / "business.ts")], self.config)
        self.businesses.append(self.business)

    def call(self, actor, action, **payload):
        req = Request(
            self.api + "/rpc",
            json.dumps({"action": action, **payload}).encode(),
            {"content-type": "application/json", "authorization": "Bearer " + self.tokens[actor]},
        )
        with urlopen(req, timeout=15) as response:
            return json.load(response)

    def service(self, args, config):
        log = (self.state / f"service-{len(self.logs)}.log").open("a", encoding="utf-8")
        self.logs.append(log)
        proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log,
            text=True,
            encoding="utf-8",
            cwd=ROOT,
            env={
                **os.environ,
                "LANGSMITH_TRACING": "false",
                "LANGCHAIN_TRACING_V2": "false",
                "PYTHONIOENCODING": "utf-8",
            },
        )
        self.children.append(proc)
        proc.stdin.write(json.dumps(config) + "\n")
        proc.stdin.close()
        lines = queue.Queue()

        def read():
            for line in proc.stdout:
                try:
                    value = json.loads(line)
                    if value.get("ready"):
                        lines.put(value)
                        return
                except ValueError:
                    continue

        threading.Thread(target=read, daemon=True).start()
        try:
            message = lines.get(timeout=25)
        except queue.Empty:
            raise RuntimeError("service readiness deadline; see private service logs")
        return proc, "http://127.0.0.1:" + str(message["port"])

    def editorial(self, actor, payload):
        config = {
            "db": str(self.state / "canonical.sqlite"),
            "vault": str(self.state / "vault"),
            "installation": self.id,
            "key": self.secret,
            "actor": actor,
        }
        result = subprocess.run(
            ["node", str(BUSINESS / "editorial.ts")],
            input=json.dumps({"config": config, "payload": payload}),
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=ROOT,
            timeout=15,
        )
        if result.returncode:
            raise RuntimeError(self.redact(result.stderr))
        return json.loads(result.stdout)

    def start_business_storage(self):
        self.image = PG
        self.evidence["postgres_image"] = self.image
        self.container = self.id + "-pg"
        self.volume = self.id + "-pg-data"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.docker("volume", "create", "--label", "qualification=" + self.id, self.volume)
        self.docker_resources.append(("volume", self.volume))
        self.docker(
            "run",
            "-d",
            "--name",
            self.container,
            "--label",
            "qualification=" + self.id,
            "--user",
            "postgres",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges=true",
            "--memory",
            "512m",
            "--cpus",
            "1",
            "--pids-limit",
            "128",
            "-e",
            "POSTGRES_PASSWORD=" + self.secret,
            "--mount",
            f"type=volume,src={self.volume},dst=/var/lib/postgresql/data",
            "-p",
            f"127.0.0.1:{self.port}:5432",
            self.image,
        )
        self.docker_resources.append(("container", self.container))
        deadline = time.monotonic() + 45
        while self.docker(
            "exec", self.container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", check=False
        ).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("PostgreSQL startup timeout")
            time.sleep(0.2)
        sql = f"CREATE ROLE workflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}'; CREATE SCHEMA runtime AUTHORIZATION workflow_runtime;"
        self.docker(
            "exec",
            "-i",
            self.container,
            "psql",
            "-Xq",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            input=sql.encode(),
        )
        self.dsn = f"postgresql://workflow_runtime:{self.secret}@127.0.0.1:{self.port}/postgres?options=-csearch_path%3Druntime&connect_timeout=5"
        vault = self.state / "vault"
        vault.mkdir()
        for source, domain, body in [
            ("politica-remoto", "publico", "Trabalho remoto autorizado por dois dias por semana."),
            (
                "aquisicao",
                "financeiro",
                "Limite sintético de aquisição: 1000 unidades. SIGILO_FIXTURE_FINANCEIRO",
            ),
        ]:
            name = source + ".md"
            (vault / name).write_text(
                f"---\nsource: {source}\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: {domain}\n---\n{body}\n",
                encoding="utf-8",
            )
            draft = self.editorial(
                {"id": "owner", "role": "finance"}, {"action": "submit", "path": name}
            )
            self.editorial(
                {"id": "board", "role": "board"},
                {"action": "review", "id": draft["id"], "raw_sha": draft["raw_sha"]},
            )
            self.editorial(
                {"id": "board", "role": "board"},
                {
                    "action": "commit",
                    "id": draft["id"],
                    "receipt": {
                        "fixture": "canonical-only; no graph projection in this experiment"
                    },
                },
            )
        self.provider_url = self.start_provider()
        principals = []
        for name, role, installation, sources in [
            ("owner", "finance", self.id, ["politica-remoto", "aquisicao"]),
            ("analyst", "analyst", self.id, ["politica-remoto"]),
            ("board", "board", self.id, ["politica-remoto", "aquisicao"]),
            ("worker", "worker", self.id, []),
            ("foreign", "finance", "different-installation", ["politica-remoto", "aquisicao"]),
        ]:
            principals.append(
                {
                    "id": name,
                    "role": role,
                    "installation": installation,
                    "sources": sources,
                    "token": self.tokens[name],
                }
            )
        self.config = {
            "installation": self.id,
            "db": str(self.state / "business.sqlite"),
            "editorial": str(self.state / "canonical.sqlite"),
            "vault": str(vault),
            "editorialKey": self.secret,
            "principals": principals,
            "budget": 64,
            "provider": self.provider_url,
            "providerKey": self.provider_key,
            "leaseMs": 60000,
        }
        self.start_business()
        packages = (
            "langgraph",
            "langgraph-checkpoint",
            "langgraph-checkpoint-postgres",
            "psycopg",
            "lightrag-hku",
        )
        self.evidence["versions"] = {
            package: importlib.metadata.version(package) for package in packages
        }
        self.evidence["source_sha"] = None

    def start(self):
        self.start_business_storage()
        self.stop_businesses()
        self.config["leaseMs"] = 900000
        key = Ed25519PrivateKey.generate()
        self.public = key.public_key().public_bytes_raw().hex()
        self.authority_secret = secrets.token_hex(32)
        self.authority_config = {
            "path": str(self.state / "retained-outside-backup.sqlite"),
            "installation": self.id,
            "private_key": key.private_bytes_raw().hex(),
            "secret": self.authority_secret,
            "caps": {"business": 64, "model": 16},
            "evidence": str(self.state / "signed-proofs.jsonl"),
        }
        self.authority()
        self.config["retained"].update(commitLeaseMs=900000, commitWaitMs=330000)
        self.evidence_dir.mkdir(exist_ok=True)
        (self.evidence_dir / "authority-public.json").write_text(
            json.dumps({"installation": self.id, "public": self.public}), encoding="utf-8"
        )
        sql = f"CREATE ROLE knowledge_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}'; CREATE DATABASE knowledge OWNER knowledge_owner;"
        self.docker(
            "exec",
            "-i",
            self.container,
            "psql",
            "-Xq",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            input=sql.encode(),
        )
        self.docker(
            "exec",
            "-i",
            self.container,
            "psql",
            "-Xq",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            "knowledge",
            input=b"CREATE EXTENSION vector;",
        )
        self.start_neo()
        self.start_embeddings()
        self.start_native()
        self.config["brain"] = {"url": self.native_url, "key": self.brain_key}
        if os.environ.get("BRAIN_DETACHED_PROFILE") == "1":
            self.config["detachedInference"] = True
        self.start_business()

    def authority(self):
        self.authority_process, self.authority_url = self.service(
            python_service("freshness_authority"), self.authority_config
        )
        self.authority_client = {
            "freshness_url": self.authority_url,
            "freshness_secret": self.authority_secret,
            "freshness_public": self.public,
            "installation": self.id,
        }
        self.config["retained"] = {
            "url": self.authority_url,
            "secret": self.authority_secret,
            "public": self.public,
            "scope": "business",
        }

    def stop_businesses(self):
        for proc in self.businesses:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=8)
        self.businesses = []

    def start_neo(self, volume=None):
        self.neo_name = self.id + "-neo-" + uuid.uuid4().hex[:6]
        if not volume:
            volume = self.neo_name + "-data"
            self.docker("volume", "create", "--label", "qualification=" + self.id, volume)
            self.docker_resources.append(("volume", volume))
        self.neo_volume = volume
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.neo_port = sock.getsockname()[1]
        self.docker(
            "run",
            "-d",
            "--name",
            self.neo_name,
            "--label",
            "qualification=" + self.id,
            "--user",
            "neo4j",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges=true",
            "--memory",
            "1g",
            "--cpus",
            "1",
            "--pids-limit",
            "256",
            "-e",
            "NEO4J_AUTH=neo4j/" + self.secret,
            "-e",
            "NEO4J_dbms_usage__report_enabled=false",
            "-e",
            "NEO4J_server_memory_heap_initial__size=256m",
            "-e",
            "NEO4J_server_memory_heap_max__size=256m",
            "-e",
            "NEO4J_server_memory_pagecache_size=128m",
            "--mount",
            f"type=volume,src={volume},dst=/data",
            "-p",
            f"127.0.0.1:{self.neo_port}:7687",
            NEO,
        )
        self.docker_resources.append(("container", self.neo_name))
        self.wait_neo()

    def wait_neo(self):
        deadline = time.monotonic() + 80
        while self.docker(
            "exec",
            self.neo_name,
            "cypher-shell",
            "-u",
            "neo4j",
            "-p",
            self.secret,
            "RETURN 1",
            check=False,
        ).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("Neo4j readiness deadline")
            time.sleep(0.3)

    def native(self, action, **payload):
        raw = json.dumps(
            {"action": action, **payload, "issued": time.time()}, ensure_ascii=False
        ).encode()
        sig = hmac.new(bytes.fromhex(self.brain_key), raw, hashlib.sha256).hexdigest()
        with urlopen(
            Request(
                self.native_url + "/rpc",
                raw,
                {"content-type": "application/json", "x-signature": sig},
            ),
            timeout=360,
        ) as response:
            return json.load(response)

    def start_native(self):
        model = self.state / "model"
        model.mkdir(exist_ok=True)
        shutil.copy2(SERVICES / "provider.schema.json", self.state / "provider.schema.json")
        cwd = self.state / "model-io"
        cwd.mkdir(exist_ok=True)
        config = {
            "state": str(self.native_state),
            "installation": self.id,
            "editorial_key": self.config["editorialKey"],
            "brain_key": self.brain_key,
            "embedding_key": self.embedding_key,
            "embedding_url": self.embedding_url,
            "model_budget": str(self.state / "unused-model-budget.json"),
            "evidence": str(model),
            "model_cwd": str(cwd),
            "model_name": "gpt-6.1-terra",
            "instance": uuid.uuid4().hex,
            **self.authority_client,
        }
        config.update(getattr(self, "native_options", {}))
        # Service env only; the provider's own allowlist strips these from model subprocesses.
        env = {
            "POSTGRES_HOST": "127.0.0.1",
            "POSTGRES_PORT": str(self.port),
            "POSTGRES_USER": "knowledge_owner",
            "POSTGRES_PASSWORD": self.secret,
            "POSTGRES_DATABASE": "knowledge",
            "POSTGRES_MAX_CONNECTIONS": "5",
            "POSTGRES_WORKSPACE": "",
            "NEO4J_WORKSPACE": "",
            "NEO4J_URI": f"bolt://127.0.0.1:{self.neo_port}",
            "NEO4J_USERNAME": "neo4j",
            "NEO4J_PASSWORD": self.secret,
            "NEO4J_DATABASE": "neo4j",
            "NEO4J_MAX_CONNECTION_POOL_SIZE": "5",
        }
        previous = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            self.native_process, self.native_url = self.service(python_service("native"), config)
        finally:
            for k, v in previous.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        if "brain" in self.config:
            self.config["brain"]["url"] = self.native_url

    def cleanup(self):
        for proc in reversed(self.children):
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=8)
        for log in self.logs:
            log.close()
        for kind, name in reversed(self.docker_resources):
            inspect = self.docker(
                *(("inspect", name) if kind == "container" else ("volume", "inspect", name)),
                check=False,
            )
            if inspect.returncode:
                continue
            value = json.loads(inspect.stdout)[0]
            labels = (
                value.get("Config", {}).get("Labels", {})
                if kind == "container"
                else value.get("Labels", {})
            )
            assert labels.get("qualification") == self.id, "cleanup ownership mismatch"
            self.docker(*(("rm", "-f", name) if kind == "container" else ("volume", "rm", name)))
