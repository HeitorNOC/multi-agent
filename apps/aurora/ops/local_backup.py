"""Offline PostgreSQL recovery on the same prepared Aurora installation."""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path

from apps.aurora.ops.local_engine import DatabaseResources
from apps.aurora.ops.local_session import (
    atomic_write,
    dpapi,
    inspect_resources,
    load_resume,
    save_resume,
)

ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT / "demo-enterprise"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def sqlite_ro(path):
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


def local_ledgers(state, engine):
    databases = {
        name: state / name
        for name in ("journey.sqlite", "model-slots.sqlite", "telemetry-outbox.sqlite")
    }
    databases.update(
        {
            "canonical": Path(engine["config"]["editorial"]),
            "business": Path(engine["config"]["db"]),
            "authority": Path(engine["authority_config"]["path"]),
            "native": state / "engines/native/native.sqlite",
            "provider": state / "engines/provider.sqlite",
        }
    )
    digests = {}
    for name, path in databases.items():
        if name == "telemetry-outbox.sqlite" and not path.exists():
            digests[name] = None
            continue
        with closing(sqlite_ro(path)) as db:
            if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise ValueError("Diário local não está íntegro: " + name)
            content = hashlib.sha256()
            for line in db.iterdump():
                content.update((line + "\n").encode())
            digests[name] = content.hexdigest()
    with closing(sqlite_ro(databases["journey.sqlite"])) as db:
        jobs = [row[0] for row in db.execute("SELECT id FROM jobs ORDER BY id")]
    return digests, jobs


class LocalBackup(DatabaseResources):
    def __init__(self, state, record):
        self.state = state
        self.record = record
        self.engine = record["engine"]
        self.id = self.engine["id"]
        self.secret = self.engine["secret"]
        self.container = self.engine["container"]
        self.docker_resources = []
        self.evidence = {}

    def redact(self, text):
        return text.replace(self.secret, "[redacted]")

    def verify_parked_resources(self):
        actual = inspect_resources(self.docker, self.id, self.engine["docker_resources"])
        if any(
            item["running"] or item["identity"] != self.record["resources"].get(name)
            for name, item in actual.items()
        ):
            raise ValueError("Recursos da instalação não correspondem à sessão parada")

    def backup(self, bundle):
        self.verify_parked_resources()
        ledgers, jobs = local_ledgers(self.state, self.engine)
        image = json.loads(self.docker("inspect", "--type", "container", self.container).stdout)[0][
            "Config"
        ]["Image"]
        if not re.fullmatch(r"pgvector/pgvector@sha256:[0-9a-f]{64}", image):
            raise ValueError("Imagem PostgreSQL da sessão não está fixada por digest")
        bundle.mkdir()
        self.docker("start", self.container)
        try:
            deadline = time.monotonic() + 45
            while self.docker(
                "exec",
                self.container,
                "pg_isready",
                "-h",
                "127.0.0.1",
                "-U",
                "postgres",
                check=False,
            ).returncode:
                if time.monotonic() > deadline:
                    raise RuntimeError("PostgreSQL não abriu para a cópia")
                time.sleep(0.25)
            for name, args in {
                "runtime.dump": ("-n", "runtime", "postgres"),
                "knowledge.dump": ("knowledge",),
            }.items():
                atomic_write(
                    bundle / name,
                    self.docker(
                        "exec", self.container, "pg_dump", "-U", "postgres", "-Fc", *args
                    ).stdout,
                )
        finally:
            self.docker("stop", self.container)
        files = {name: digest(bundle / name) for name in ("runtime.dump", "knowledge.dump")}
        record = {
            "version": 1,
            "installation": self.id,
            "corpus_sha": self.record["corpus_sha"],
            "image": image,
            "files": files,
            "ledgers": ledgers,
            "jobs": jobs,
        }
        atomic_write(bundle / "backup.dpapi", dpapi(json.dumps(record).encode(), True))
        return {"status": "backup_ready", "jobs": len(jobs), "directory": str(bundle)}

    def restore(self, bundle):
        manifest = json.loads(dpapi((bundle / "backup.dpapi").read_bytes(), False))
        if (
            manifest.get("version") != 1
            or manifest["installation"] != self.id
            or manifest["corpus_sha"] != self.record["corpus_sha"]
        ):
            raise ValueError("Backup incompatível com a instalação atual")
        if set(manifest["files"]) != {"runtime.dump", "knowledge.dump"} or any(
            digest(bundle / name) != sha for name, sha in manifest["files"].items()
        ):
            raise ValueError("Integridade do backup PostgreSQL inválida")
        self.verify_parked_resources()
        ledgers, jobs = local_ledgers(self.state, self.engine)
        if ledgers != manifest["ledgers"]:
            return {
                "status": "refused_newer_or_changed_state",
                "jobs_missing_from_backup": sorted(set(jobs) - set(manifest["jobs"])),
                "divergent_ledgers": sorted(
                    name for name in ledgers if ledgers[name] != manifest["ledgers"][name]
                ),
            }

        self.image = manifest["image"]
        original = self.container
        original_volume = original + "-data"
        try:
            self.restore_postgres(bundle / "runtime.dump")
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
                "pg_restore",
                "-U",
                "postgres",
                "-d",
                "knowledge",
                "--exit-on-error",
                input=(bundle / "knowledge.dump").read_bytes(),
            )
            self.docker("stop", self.container)
            records = inspect_resources(self.docker, self.id, self.docker_resources)
            engine = {
                **self.engine,
                "container": self.container,
                "port": self.port,
                "dsn": self.dsn,
                "docker_resources": [
                    item
                    for item in self.engine["docker_resources"]
                    if item[1] not in (original, original_volume)
                ]
                + self.docker_resources,
            }
            resources = {
                name: identity
                for name, identity in self.record["resources"].items()
                if name not in (original, original_volume)
            }
            resources.update({name: row["identity"] for name, row in records.items()})
            save_resume(self.state, {**self.record, "engine": engine, "resources": resources})
        except Exception:
            # Only resources created by this attempt may be removed.
            inspect_resources(self.docker, self.id, self.docker_resources)
            for kind, name in reversed(self.docker_resources):
                self.docker(
                    *(("rm", "-f", name) if kind == "container" else ("volume", "rm", name))
                )
            raise
        return {
            "status": "postgres_restored",
            "jobs": len(jobs),
            "original_container_preserved": True,
            "postgres_container": self.container,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "restore"])
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, default=HERE / ".state", help=argparse.SUPPRESS)
    args = parser.parse_args()
    root = args.state_root.resolve()
    with closing(sqlite3.connect(root / "launcher-owner.sqlite", timeout=0)) as owner:
        owner.execute("BEGIN EXCLUSIVE")
        state = Path(
            json.loads((root / "active.json").read_text(encoding="utf-8"))["state"]
        ).resolve()
        if state.parent != root or not (state / "parked").is_file():
            raise ValueError("Encerre o Aurora e aguarde a confirmação de parada")
        tool = LocalBackup(state, load_resume(state))
        result = getattr(tool, args.operation)(args.directory.resolve())
        print(json.dumps(result, ensure_ascii=False))
        return 2 if result["status"].startswith("refused") else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        sys.exit(str(error))
