"""Larger fictional domain on the existing engines; no claim of enterprise load."""

import argparse
import getpass
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from apps.aurora.ops.local_engine import LocalEngine
from apps.aurora.ops.local_session import (
    atomic_write,
    inspect_resources,
    load_resume,
    save_resume,
)
from apps.aurora.runtime.model_gateway import call_model
from apps.aurora.runtime.diagnostics import diagnostic
from apps.aurora.runtime.directive_source import SOURCE, TITLE, DirectiveSource
from apps.aurora.runtime.subdelegation import TEAM_MODEL_LIMIT, TEAM_MODEL_PREFIX
from apps.aurora.runtime.pilot_corpus import (
    PilotCorpus,
    citation_verification,
    requirement_assessments,
)
from apps.aurora.runtime.pilot_refund_reference import (
    RefundReferenceBlocked,
    require_refund_reference,
)
from apps.aurora.runtime.pilot_retrieval import HybridRetriever, load_facets
from apps.aurora.runtime.recovery_bridge import RecoveryBridge, reviewers

ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = ROOT / "demo-enterprise"

CORPUS = json.loads((HERE / "corpus.json").read_text(encoding="utf-8"))
CATALOG = json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))
AGENTS = {a["id"]: a for a in CATALOG["agents"]}
DOCS = {d["source"]: d for d in CORPUS["documents"] if d["current"]}
parser = argparse.ArgumentParser()
parser.add_argument("--run-profile", choices=["original", "observability-v1"])
parser.add_argument(
    "--workers",
    type=int,
    choices=[1, 2],
    help="Dois workers habilitam o perfil concorrente de laboratório.",
)
parser.add_argument(
    "--new-session",
    action="store_true",
    help="Inicia outra instalação e mantém os arquivos da anterior.",
)
parser.add_argument(
    "--state-root", type=pathlib.Path, default=HERE / ".state", help=argparse.SUPPRESS
)
parser.add_argument("--pilot-manifest", type=pathlib.Path)
parser.add_argument("--pilot-directive", type=pathlib.Path)
parser.add_argument("--pilot-recovery-lab", action="store_true", help=argparse.SUPPRESS)
parser.add_argument("--pilot-refund-reference", type=pathlib.Path)
parser.add_argument(
    "--pilot-refund-public-key", help="Chave pública Ed25519 confiável em hexadecimal"
)
parser.add_argument(
    "--pilot-retrieval", choices=["lexical", "hybrid"], default="lexical"
)
parser.add_argument(
    "--pilot-facets",
    type=pathlib.Path,
    help="Vocabulário técnico local para uma pergunta exata",
)
parser.add_argument("--pilot-user", default="operador")
parser.add_argument("--pilot-viewer")
args = parser.parse_args()
if args.pilot_facets and (not args.pilot_manifest or args.pilot_retrieval != "hybrid"):
    parser.error("--pilot-facets requer o perfil piloto com busca híbrida")
pilot_facets = load_facets(args.pilot_facets) if args.pilot_facets else None
refund_public_key = None
if args.pilot_refund_reference is not None or args.pilot_refund_public_key is not None:
    if not (
        args.pilot_manifest
        and args.pilot_refund_reference
        and args.pilot_refund_public_key
    ):
        parser.error(
            "A referência de reembolso requer manifesto, arquivo de referência e chave pública"
        )
    try:
        refund_public_key = Ed25519PublicKey.from_public_bytes(
            bytes.fromhex(args.pilot_refund_public_key)
        )
    except ValueError:
        parser.error("Chave pública Ed25519 inválida")


def pilot_account(id, role):
    if not 1 <= len(id) <= 64 or not all(c.isalnum() or c in ".@_-" for c in id):
        raise ValueError("Identificação local inválida")
    if not sys.stdin.isatty():
        raise ValueError("Configure as credenciais do piloto em um terminal interativo")
    password = getpass.getpass(f"Senha local para {id} ({role}): ")
    if not 12 <= len(password) <= 128:
        raise ValueError("Use uma senha local de 12 a 128 caracteres")
    salt = secrets.token_bytes(16)
    verifier = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return {"id": id, "role": role, "salt": salt.hex(), "verifier": verifier.hex()}


pilot = PilotCorpus(args.pilot_manifest) if args.pilot_manifest else None
directive = None
directive_source = None
if args.pilot_directive:
    if not pilot or args.pilot_recovery_lab:
        parser.error("--pilot-directive requer uma sessão consultiva temporária")
    with args.pilot_directive.open("rb") as stream:
        raw_directive = stream.read(32769)
    if not 1 <= len(raw_directive) <= 32768:
        parser.error("A diretiva deve ter até 32 KiB")
    try:
        directive_text = raw_directive.decode("utf-8-sig")
    except UnicodeDecodeError:
        parser.error("A diretiva deve estar em UTF-8")
    if not directive_text.strip():
        parser.error("A diretiva está vazia")
    directive = (hashlib.sha256(raw_directive).hexdigest(), directive_text)
    directive_source = DirectiveSource(*directive)
pilot_recovery = args.pilot_recovery_lab
if pilot_recovery and (
    not pilot
    or args.pilot_retrieval != "lexical"
    or args.state_root.resolve() == (HERE / ".state").resolve()
):
    parser.error(
        "A retomada de laboratório exige piloto lexical e diretório de estado dedicado"
    )
pilot_accounts = None
pilot_temp = None
pilot_expires = None
if pilot:
    if args.new_session or args.run_profile or args.workers not in (None, 1):
        parser.error("O piloto inicia uma sessão própria e usa um worker")
    if args.pilot_viewer == args.pilot_user:
        parser.error("As identidades de consulta e operação devem ser diferentes")
    if not pilot_recovery:
        pilot_temp = tempfile.TemporaryDirectory(prefix="aurora-pilot-")
    pilot_expires = time.time() + 7200
pilot_binding = (
    {
        "manifest": pilot.sha256,
        "reference_path": str(args.pilot_refund_reference.resolve())
        if args.pilot_refund_reference
        else None,
        "reference_key": refund_public_key.public_bytes_raw().hex()
        if refund_public_key
        else None,
    }
    if pilot_recovery
    else None
)
state_root = pathlib.Path(pilot_temp.name) if pilot_temp else args.state_root.resolve()
state_root.mkdir(parents=True, exist_ok=True)
owner = sqlite3.connect(state_root / "launcher-owner.sqlite", timeout=0)
owner.execute("BEGIN EXCLUSIVE")
active_path = state_root / "active.json"
resume = None
if active_path.exists() and not args.new_session:
    state = pathlib.Path(
        json.loads(active_path.read_text(encoding="utf-8"))["state"]
    ).resolve()
    if state.parent != state_root or not (state / "resume.dpapi").is_file():
        raise SystemExit(
            "Sessão sem metadados de retomada. Use --new-session para inicializar outra instalação."
        )
    if not pilot_recovery and not (state / "parked").is_file():
        raise SystemExit(
            "A sessão anterior não confirmou parada limpa. Consulte os logs antes de reabrir."
        )
    resume = load_resume(state)
    if resume.get("pilot_binding") != pilot_binding:
        raise SystemExit(
            "O perfil ou a publicação do piloto diverge da sessão registrada"
        )
    if args.workers not in (None, resume["workers"]) or args.run_profile not in (
        None,
        resume["run_profile"],
    ):
        raise SystemExit(
            "A retomada usa o perfil original. Use --new-session para escolher outro perfil."
        )
    args.run_profile = resume["run_profile"]
    args.workers = resume["workers"]
    CAP = resume["cap"]
else:
    args.run_profile = args.run_profile or "observability-v1"
    args.workers = args.workers or 1
    prior_path = state_root / "prior-attempt.json"
    prior = (
        json.loads(prior_path.read_text())
        if prior_path.exists()
        else {"reserved_calls": 0}
    )
    CAP = (
        24
        if pilot
        else 40
        if args.run_profile == "observability-v1"
        else 64 - prior["reserved_calls"]
    )
    state = state_root / ("session-" + uuid.uuid4().hex[:10])
    state.mkdir()
if pilot:
    if resume:
        pilot_accounts = resume["pilot_accounts"]
        pilot_expires = resume["pilot_expires"]
        if pilot_expires <= time.time():
            raise SystemExit("A sessão do piloto expirou")
    else:
        pilot_accounts = [pilot_account(args.pilot_user, "operator")]
        if args.pilot_viewer:
            pilot_accounts.append(pilot_account(args.pilot_viewer, "viewer"))
token = secrets.token_hex(32)
recovery_key = secrets.token_hex(32)
stop = threading.Event()
retrieval_lock = threading.Lock()
cache = {}
lab = None
node = None
api = ""
progress = {
    "phase": "starting",
    "message": "Preparando o cérebro do Grupo Aurora.",
    "sources": [],
    "resumed": bool(resume),
}


class EnterpriseLab(LocalEngine):
    resume_fields = (
        "id",
        "secret",
        "provider_key",
        "brain_key",
        "embedding_key",
        "public",
        "authority_secret",
        "authority_config",
        "config",
        "tokens",
        "container",
        "neo_name",
        "port",
        "neo_port",
        "dsn",
        "docker_resources",
    )

    def __init__(self):
        super().__init__(state / "engines")
        self.state.mkdir(exist_ok=True)
        self.evidence_dir = state / "evidence"
        self.evidence_dir.mkdir(exist_ok=True)
        self.projections = {}
        self.native_state = self.state / "native"
        self.native_options = {
            "profile": "enterprise-demo",
            "synthetic_corpus_sha": hashlib.sha256(
                (HERE / "corpus.json").read_bytes()
            ).hexdigest(),
            "model_slots_path": str(state / "model-slots.sqlite"),
            "pilot": bool(pilot),
            "retain_model_content": not pilot,
        }
        self.embedding_options = {"pool_long_inputs": True}
        self.tokens["reviewer2"] = secrets.token_hex(24)
        self.attached = False

    def inspect_resources(self):
        return inspect_resources(self.docker, self.id, self.docker_resources)

    def embed_passages(self, texts):
        body = json.dumps(
            {"texts": texts, "issued": time.time()}, ensure_ascii=False
        ).encode()
        signature = hmac.new(
            bytes.fromhex(self.embedding_key), body, hashlib.sha256
        ).hexdigest()
        with urlopen(
            Request(self.embedding_url + "/embed", body, {"x-signature": signature}),
            timeout=45,
        ) as response:
            return json.load(response)["vectors"]

    def save_local_session(self, sources):
        records = self.inspect_resources()
        save_resume(
            state,
            {
                "version": 1,
                "state": str(state),
                "run_profile": args.run_profile,
                "workers": args.workers,
                "cap": CAP,
                "corpus_sha": self.native_options["synthetic_corpus_sha"],
                "sources": sources,
                "resources": {name: row["identity"] for name, row in records.items()},
                "engine": {name: getattr(self, name) for name in self.resume_fields},
                **(
                    {
                        "pilot_binding": pilot_binding,
                        "pilot_accounts": pilot_accounts,
                        "pilot_expires": pilot_expires,
                    }
                    if pilot_recovery
                    else {}
                ),
            },
        )

    def attach(self, record):
        for name in self.resume_fields:
            setattr(self, name, record["engine"][name])
        if self.native_options["synthetic_corpus_sha"] != record["corpus_sha"]:
            raise ValueError("Corpus mudou desde a sessão anterior")
        for path in (
            state / "journey.sqlite",
            state / "model-slots.sqlite",
            self.native_state / "native.sqlite",
            self.state / "provider.sqlite",
            pathlib.Path(self.authority_config["path"]),
            pathlib.Path(self.config["db"]),
            pathlib.Path(self.config["editorial"]),
        ):
            if not path.is_file():
                raise ValueError(
                    "Arquivo obrigatório de retomada ausente: " + path.name
                )
        records = self.inspect_resources()
        if {name: row["identity"] for name, row in records.items()} != record[
            "resources"
        ] or any(row["running"] for row in records.values()):
            raise ValueError(
                "Recursos da sessão foram alterados ou continuam em execução"
            )
        (state / "parked").unlink(missing_ok=pilot_recovery)
        self.attached = True
        self.docker("start", self.container, self.neo_name)
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
                raise RuntimeError("PostgreSQL não reabriu no prazo")
            time.sleep(0.2)
        self.wait_neo()
        self.config["provider"] = self.start_provider()
        self.start_embeddings()
        self.authority()
        self.start_native()
        self.start_business()
        if not self.call("board", "retained_status")["current"]:
            raise ValueError("Autoridade e estado local divergiram")
        for doc in record["sources"]:
            certificate = self.native("verify", id=doc["projection"])
            if certificate["payload"]["content_sha"] != doc["sha256"]:
                raise ValueError("Projeção recuperada difere da fonte")
            self.projections[doc["source"]] = doc["projection"]
        return record["sources"]

    def park(self):
        for process in reversed(self.children):
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
        for log in self.logs:
            log.close()
        records = self.inspect_resources()
        running = [name for name, row in records.items() if row["running"]]
        if running:
            self.docker("stop", *running)
        atomic_write(state / "parked", b"1\n")

    def start_business(self):
        if not any(p["id"] == "reviewer2" for p in self.config["principals"]):
            self.config["principals"].append(
                {
                    "id": "reviewer2",
                    "role": "board",
                    "installation": self.id,
                    "sources": ["politica-remoto", "aquisicao"],
                    "token": self.tokens["reviewer2"],
                }
            )
        super().start_business()

    def authority(self):
        self.authority_config["caps"]["model"] = CAP
        super().authority()

    def start_native(self):
        super().start_native()
        # Preserve the endpoint already given to business services and workers.
        self.native_options["port"] = int(self.native_url.rsplit(":", 1)[1])

    def stage(self, d):
        payload = {
            "installation": self.id,
            "source": d["source"],
            "version": d["version"],
            "content_sha": hashlib.sha256(d["content"].encode()).hexdigest(),
            "raw_sha": hashlib.sha256(
                ("fictional-original:" + d["content"]).encode()
            ).hexdigest(),
            "domain": d["area"],
            "draft": uuid.uuid4().hex,
            "reviewer": "aurora-fixture-reviewer",
            "valid_at": "2026-11-01T00:00:00Z",
            "known_at": "2026-11-05T19:45:00Z",
        }
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        result = self.native(
            "stage",
            release={
                "payload": payload,
                "payload_json": raw,
                "signature": hmac.new(
                    bytes.fromhex(self.config["editorialKey"]),
                    raw.encode(),
                    hashlib.sha256,
                ).hexdigest(),
                "content": d["content"],
            },
        )
        self.projections[d["source"]] = result["id"]
        return {**d, "sha256": payload["content_sha"], "projection": result["id"]}


def request(url, data):
    with urlopen(
        Request(
            url,
            json.dumps(data).encode(),
            {"content-type": "application/json", "x-demo-token": token},
        ),
        timeout=30,
    ) as res:
        return json.load(res)


def usage():
    path = state / "engines/model/model-calls.jsonl"
    rows = (
        [
            json.loads(x)
            for x in path.read_text(encoding="utf-8").splitlines()
            if x.strip()
        ]
        if path.exists()
        else []
    )
    return {
        "calls": len(rows),
        "max_calls": CAP,
        "input_tokens": sum(u.get("input_tokens", 0) for r in rows for u in r["usage"]),
        "cached_input_tokens": sum(
            u.get("cached_input_tokens", 0) for r in rows for u in r["usage"]
        ),
        "output_tokens": sum(
            u.get("output_tokens", 0) for r in rows for u in r["usage"]
        ),
        "money": "Uso Codex de bancada; valor monetário não medido.",
    }


def require_selected(job, agent):
    if (
        agent not in AGENTS
        or not job["plan"]
        or agent not in job["plan"]["capabilities"]
    ):
        raise ValueError("Agente não selecionado pelo Chief of Staff")


def retrieve(p):
    job = worker_snapshot(p)
    agent = p["agent"]
    require_selected(job, agent)
    rows = []
    for source in AGENTS[agent]["sources"]:
        with retrieval_lock:
            if source not in cache:
                d = DOCS[source]
                query = (
                    "Grupo Aurora "
                    + d["title"]
                    + ". Recupere os fatos, números, condições, prazos e referências deste documento vigente."
                )
                result = lab.native(
                    "query",
                    id=lab.projections[source],
                    query=query,
                    mode="mix",
                    only_need_context=True,
                    hl_keywords=[d["area"], "Grupo Aurora"],
                    ll_keywords=[
                        source,
                        "SKU-AURA"
                        if d["area"] not in ["technology", "people"]
                        and source != "aurora-response"
                        else "INC-47",
                    ],
                )
                context = result["answer"]
                if not isinstance(context, str) or "[no-context]" in context:
                    raise ValueError("Contexto obrigatório não recuperado: " + source)
                cache[source] = {
                    "source": source,
                    "title": d["title"],
                    "version": d["version"],
                    "sha256": hashlib.sha256(d["content"].encode()).hexdigest(),
                    "projection_id": lab.projections[source],
                    "context": context,
                    "retrieval_mode": "LightRAG mix; graph + vectors",
                }
            rows.append(cache[source])
    return rows


def worker_snapshot(p):
    return request(
        api + "/internal/model_snapshot",
        {"job": p["job"], "model_lease": p.get("model_lease")},
    )


def team_slot_authorized(role, job):
    action, _, agent = role.partition(":")
    events = [
        event["detail"]
        for event in job["events"]
        if event["node"] == "engineering_delegation"
    ]
    if action == "chief_subdelegation_review":
        return any(
            event["status"] == "requested" and event["requester"] == agent
            for event in events
        )
    if action == "specialist_subtask":
        return any(
            event["status"] == "reviewed"
            and any(event["assignees"][task] == agent for task in event["approved"])
            for event in events
        )
    if action == "specialist_consolidate":
        completed = {
            event["task"]
            for event in events
            if event["status"] == "completed" and event["requester"] == agent
        }
        return any(
            event["status"] == "reviewed"
            and event["requester"] == agent
            and event["approved"]
            and set(event["approved"]) <= completed
            for event in events
        )
    return True


def is_directive_job(job):
    return bool(
        directive
        and job["goal"]
        == "Analisar a diretiva executiva vinculada a esta tarefa. SHA-256 "
        + directive[0]
    )


def pilot_requirements(job, slot):
    if not is_directive_job(job):
        return []
    return list(
        dict.fromkeys(
            query.strip()
            for team in job["plan"]["teams"]
            if slot == "synthesis" or slot[6:] in [team["lead"], *team["specialists"]]
            for query in team["queries"]
        )
    )


def pilot_passages(job, slot):
    queries = pilot_requirements(job, slot)
    if not queries:
        return pilot.retrieve(job["goal"])
    # Reserve a place per requirement before filling with lower ranked hits.
    ranked = [
        [*directive_source.retrieve(query), *pilot.retrieve(query)][:6]
        for query in queries
    ]
    passages = {}
    for index in range(6):
        for results in ranked:
            if index < len(results):
                passage = results[index]
                passages.setdefault(passage["id"], passage)
                if len(passages) == 24:
                    return list(passages.values())
    return list(passages.values())


def pilot_review_question(job):
    queries = pilot_requirements(job, "synthesis")
    return "\n".join(queries) if queries else job["goal"]


def pilot_selection_report(job, selection, *, gaps=None):
    return pilot.report(
        job["goal"],
        selection,
        unanswered=gaps,
        passages=pilot_passages(job, "synthesis"),
        **({"citation_limit": 24} if is_directive_job(job) else {}),
    )


def pilot_verification_passages(job, selection):
    citations = pilot_selection_report(job, selection)["citations"]
    if is_directive_job(job):
        # Recommendations lead the list, but the verifier can recover any offered candidate.
        return list(
            {
                row["id"]: row
                for row in [*citations, *pilot_passages(job, "synthesis")]
            }.values()
        )
    return citations


def pilot_prompt(job, slot):
    goal = job["goal"]
    if slot == "plan":
        catalog = [
            {key: agent[key] for key in ("id", "kind", "parent", "focus")}
            for agent in AGENTS.values()
        ]
        envelope = {
            "kind": "plan",
            "question": goal,
            "catalog": catalog,
            "contract": (
                "Retorne JSON com strategy (A2 se uma equipe, A3 se mais), reason, "
                "teams:[{lead,specialists,reason}], not_selected:[{id,reason}]. "
                "Use somente IDs do catálogo. De uma a quatro diretorias, com um ou dois "
                "especialistas próprios cada, no máximo oito agentes ao todo. "
                "Justifique a exclusão de todos os demais em uma frase curta por agente. Use português."
            ),
        }
        if is_directive_job(job):
            envelope["directive"] = {"sha256": directive[0], "text": directive[1]}
            envelope["contract"] += (
                " Use o texto integral da diretiva vinculada para planejar a análise. "
                "Em cada objeto de teams inclua queries, de duas a quatro perguntas "
                "documentais concretas e distintas para os requisitos dessa frente. "
                "Cada consulta deve verificar um único fato ou decisão. Separe contratos, "
                "estados e garantias de execução em perguntas diferentes. Use até 120 caracteres por consulta."
            )
        return envelope
    passages = pilot_passages(job, slot)
    recommendations = {}
    if passages:
        offered = {row["id"] for row in passages}
        team = next(
            (team for team in job["plan"]["teams"] if "agent:" + team["lead"] == slot),
            None,
        )
        contributors = (
            [team["lead"] for team in job["plan"]["teams"]]
            if slot == "synthesis"
            else team["specialists"]
            if team
            else []
        )
        for id in contributors:
            contributor_slot = "agent:" + id
            contributor_prompt = pilot_prompt(job, contributor_slot)
            if not contributor_prompt["passages"]:
                continue
            receipt = lab.native(
                "model_slot_lookup",
                job=job["id"],
                slot=contributor_slot,
                prompt=json.dumps(contributor_prompt, ensure_ascii=False),
            )
            recommendations[id] = [
                item
                for item in json.loads(receipt["text"])["evidence_ids"]
                if item in offered
            ]
    envelope = {
        "kind": "select",
        "question": goal,
        "role": AGENTS[slot[6:]]["focus"]
        if slot.startswith("agent:")
        else "Síntese do Chief",
        "passages": [{"id": item["id"], "text": item["quote"]} for item in passages],
        "recommendations": recommendations,
        "contract": "Retorne apenas JSON {evidence_ids: [...]}, no máximo quatro IDs dos trechos que respondem diretamente à pergunta. Use [] se insuficiente.",
    }
    questions = getattr(pilot.hybrid, "questions", None)
    if requirements := pilot_requirements(job, slot):
        envelope["subquestions"] = requirements
        envelope["contract"] += (
            " Selecione citações diretas para as subquestões da frente de trabalho. "
            "Distribua até quatro IDs entre requisitos distintos."
        )
    if slot == "synthesis" and questions and (facts := questions(goal)):
        envelope["subquestions"] = facts
        envelope["contract"] += (
            " Avalie as subquestões separadamente. Priorize uma citação direta por "
            "subquestão antes de selecionar contexto adicional. Um trecho pode comprovar "
            "um fato documental mesmo quando a garantia de execução fica em aberto. "
            "Mantenha o limite de quatro IDs e o campo único evidence_ids."
        )
    return envelope


def confirmed_synthesis(job):
    envelope = pilot_prompt(job, "synthesis")
    if not envelope["passages"]:
        return {"evidence_ids": []}
    receipt = lab.native(
        "model_slot_lookup",
        job=job["id"],
        slot="synthesis",
        prompt=json.dumps(envelope, ensure_ascii=False),
    )
    return json.loads(receipt["text"])


def citation_labels(citations):
    return {f"E{index}": passage["id"] for index, passage in enumerate(citations, 1)}


def verification_prompt(job, citations):
    goal = pilot_review_question(job)
    requirements = pilot_requirements(job, "synthesis")
    titles = (
        {row["source"]: row["title"] for row in pilot.metadata} if requirements else {}
    )
    if requirements:
        titles[SOURCE] = TITLE
    labels = citation_labels(citations) if requirements else {}
    return json.dumps(
        {
            "kind": "verify_citations",
            "question": goal,
            **({"requirements": requirements} if requirements else {}),
            "passages": [
                {
                    "id": label,
                    "text": p["quote"],
                    **({"source": titles[p["source"]]} if requirements else {}),
                    **(
                        {"section": p["section"], "line": p["line"]}
                        if p["source"] == SOURCE
                        else {}
                    ),
                }
                for label, p in zip(
                    labels if requirements else (p["id"] for p in citations),
                    citations,
                    strict=True,
                )
            ],
        },
        ensure_ascii=False,
    )


def pilot_report_for_review(job, selection, gaps, assessments=None):
    goal = job["goal"]
    report = pilot_selection_report(job, selection, gaps=gaps)
    if is_directive_job(job):
        report["directive_sha256"] = directive[0]
        report["requirements"] = pilot_requirements(job, "synthesis")
        report["requirement_assessments"] = (
            assessments
            if assessments is not None
            else [
                {
                    "requirement": query,
                    "status": "unanswered",
                    "note": "Nenhuma citação foi selecionada para verificação.",
                    "evidence_ids": [],
                }
                for query in report["requirements"]
            ]
        )
    if refund_public_key is not None:
        return require_refund_reference(
            pilot, goal, report, args.pilot_refund_reference, refund_public_key
        )
    return report


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        def send(value, status=200):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(value, ensure_ascii=False).encode())

        if not hmac.compare_digest(self.headers.get("x-demo-token", ""), token):
            return send({"error": "forbidden"}, 403)
        p = None
        try:
            length = int(self.headers.get("content-length", 0))
            if length > 65536:
                raise ValueError("Payload excedido")
            p = json.loads(self.rfile.read(length))
            action = p["action"]
            if action == "status":
                if pilot:
                    return send(
                        {
                            **progress,
                            "pilot": True,
                            "usage": usage(),
                            "installation": getattr(lab, "id", None),
                            "catalog": CATALOG["agents"],
                            "sources": [
                                item for item in pilot.metadata if item["current"]
                            ],
                            "history": [
                                item for item in pilot.metadata if not item["current"]
                            ],
                        }
                    )
                return send(
                    {
                        **progress,
                        "usage": usage(),
                        "installation": getattr(lab, "id", None),
                        "run_profile": args.run_profile,
                        "company": CORPUS["company"],
                        "catalog": CATALOG["agents"],
                        "scenarios": [
                            s
                            for s in CATALOG["scenarios"]
                            if s["id"] != "engineering_que_run"
                            or os.environ.get("AURORA_QUE_VOLUME")
                        ],
                        "history": [d for d in CORPUS["documents"] if not d["current"]],
                        "scope": "Simulação de domínio empresarial; não é ensaio de carga de empresa grande.",
                    }
                )
            if action == "stop":
                if pilot:
                    # Leave time for the public API to confirm the shutdown request.
                    timer = threading.Timer(0.5, stop.set)
                    timer.daemon = True
                    timer.start()
                else:
                    stop.set()
                return send({"stopping": True})
            if action == "recovery_bridge":
                if not hmac.compare_digest(
                    self.headers.get("x-recovery-bridge-token", ""), recovery_key
                ):
                    return send({"error": "forbidden"}, 403)
                if not lab or not getattr(lab, "api", None):
                    return send(
                        {"ok": False, "status": 503, "code": "protocol_unavailable"}
                    )
                return send(
                    RecoveryBridge(lab, model_slots=progress["phase"] == "ready").call(
                        p
                    )
                )
            if progress["phase"] != "ready":
                raise ValueError("Cérebro ainda em preparação")
            if action == "worker_config":
                return send(
                    {
                        "dsn": lab.dsn,
                        "backend": backend,
                        "que_volume": os.environ.get("AURORA_QUE_VOLUME")
                        if not pilot
                        else None,
                    }
                )
            if action == "model_job_status":
                return send(lab.native("model_slot_status", job=p["job"]))
            if action == "retrieve":
                if pilot:
                    job = worker_snapshot(p)
                    require_selected(job, p["agent"])
                    return send(
                        [
                            {
                                "source": item["source"],
                                "version": item["version"],
                                "sha256": item["sha256"],
                                "passage_id": item["id"],
                            }
                            for item in pilot_passages(job, "agent:" + p["agent"])
                        ]
                    )
                return send(retrieve(p))
            if action == "llm":
                job = worker_snapshot(p)
                if not pilot and p["slot"].startswith(
                    ("engineering:", TEAM_MODEL_PREFIX)
                ):
                    from apps.aurora.runtime.engineering import (
                        MAX_CALLS,
                        SCENARIO,
                        SLOTS,
                        TEAM_SCENARIO,
                        TEAM_SLOTS,
                    )

                    team_run = p["slot"].startswith(TEAM_MODEL_PREFIX)
                    goals = {
                        s["goal"]
                        for s in CATALOG["scenarios"]
                        if s["id"] == SCENARIO
                        or (
                            s["id"] == "engineering_que_run"
                            and os.environ.get("AURORA_QUE_VOLUME")
                        )
                    }
                    if team_run:
                        goals = {
                            s["goal"]
                            for s in CATALOG["scenarios"]
                            if s["id"] == TEAM_SCENARIO
                        }
                    prefix = TEAM_MODEL_PREFIX if team_run else "engineering:"
                    role = p["slot"].removeprefix(prefix)
                    allowed = {
                        name
                        for name in SLOTS
                        if name in ("chief", "director_assign", "tech_lead_design")
                    }
                    allowed.update(
                        f"{name}:{attempt}"
                        for name in SLOTS - allowed
                        for attempt in (1, 2)
                    )
                    if team_run:
                        allowed.update(TEAM_SLOTS)
                    if (
                        job["goal"] not in goals
                        or job["status"] != "running"
                        or role not in allowed
                        or (team_run and not team_slot_authorized(role, job))
                    ):
                        raise ValueError("Slot fora do fluxo de engenharia")
                    return send(
                        lab.native(
                            "model_slot_run",
                            job=job["id"],
                            slot=p["slot"],
                            prompt=p["prompt"],
                            limit=TEAM_MODEL_LIMIT
                            if team_run
                            else MAX_CALLS - (role != "director_review:2"),
                        )
                    )
                if pilot:
                    if set(p) != {"action", "job", "model_lease", "slot"}:
                        raise ValueError(
                            "O gateway do piloto constrói a entrada de inferência"
                        )
                    slot = p["slot"]
                    if slot not in (
                        "plan",
                        "synthesis",
                        "citation_verification",
                    ) and not slot.startswith("agent:"):
                        raise ValueError("Slot fora do piloto")
                    if slot != "plan" and not job["plan"]:
                        raise ValueError("Plano do piloto ausente")
                    if slot.startswith("agent:"):
                        require_selected(job, slot[6:])
                    if slot == "citation_verification":
                        selection = confirmed_synthesis(job)
                        citations = pilot_verification_passages(job, selection)
                        if not citations and not is_directive_job(job):
                            raise ValueError(
                                "A síntese não propôs citações para verificar"
                            )
                        prompt = verification_prompt(job, citations)
                        return send(
                            call_model(lab, job, slot, prompt, AGENTS, pilot=True)
                        )
                    envelope = pilot_prompt(job, slot)
                    if slot == "plan" and "directive" in envelope:
                        print(
                            json.dumps(
                                {
                                    "pilot_directive": envelope["directive"]["sha256"],
                                    "job": job["id"],
                                    "characters": len(envelope["directive"]["text"]),
                                }
                            ),
                            flush=True,
                        )
                    if slot != "plan" and not envelope["passages"]:
                        return send({"text": '{"evidence_ids":[]}'})
                    prompt = json.dumps(envelope, ensure_ascii=False)
                    return send(call_model(lab, job, slot, prompt, AGENTS, pilot=True))
                return send(call_model(lab, job, p["slot"], p["prompt"], AGENTS))
            if (
                action == "pilot_recheck_reference"
                and pilot
                and refund_public_key is not None
            ):
                report = p["report"]
                try:
                    current = require_refund_reference(
                        pilot,
                        p["goal"],
                        report,
                        args.pilot_refund_reference,
                        refund_public_key,
                    )
                    if current["reference_check"] != report.get("reference_check"):
                        raise RefundReferenceBlocked("unavailable", "reference_changed")
                except RefundReferenceBlocked as error:
                    return send({"ok": False, "reason": str(error)})
                return send({"ok": True})
            if action == "pilot_report" and pilot:
                job = worker_snapshot(p)
                goal = pilot_review_question(job)
                selection = confirmed_synthesis(job)
                if selection != p["selection"]:
                    raise ValueError(
                        "A seleção diverge do recibo confirmado da síntese"
                    )
                citations = pilot_verification_passages(job, selection)
                if not citations and not is_directive_job(job):
                    return send(pilot_report_for_review(job, selection, [goal]))
                receipt = lab.native(
                    "model_slot_lookup",
                    job=job["id"],
                    slot="citation_verification",
                    prompt=verification_prompt(job, citations),
                )
                value = json.loads(receipt["text"])
                allowed = {p["id"] for p in citations}
                if is_directive_job(job):
                    labels = citation_labels(citations)
                    ids, gaps, assessments = requirement_assessments(
                        value,
                        pilot_requirements(job, "synthesis"),
                        labels,
                        canonical_ids=labels,
                    )
                else:
                    ids, gaps = citation_verification(value, goal, allowed)
                    assessments = None
                return send(
                    pilot_report_for_review(
                        job, {"evidence_ids": ids}, gaps, assessments
                    )
                )
            raise ValueError("Operação desconhecida")
        except RefundReferenceBlocked as error:
            return send({"error": str(error)}, 409)
        except Exception as error:
            with (state / "backend-errors.log").open("a", encoding="utf-8") as f:
                f.write(
                    json.dumps(diagnostic(error, "launcher", p)) + "\n"
                    if pilot
                    else lab.redact(repr(error)) + "\n"
                    if lab
                    else repr(error) + "\n"
                )
            send(
                {
                    "error": "Operação recusada ou incompleta; consulte o log local da simulação."
                },
                409,
            )


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
backend = "http://127.0.0.1:" + str(server.server_port)
threading.Thread(target=server.serve_forever, daemon=True).start()


def start_api(config):
    with (state / "node.log").open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            ["node", str(ROOT / "packages/aurora-api/server.ts")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log,
            text=True,
            encoding="utf-8",
            cwd=ROOT,
        )
    try:
        process.stdin.write(json.dumps(config))
        process.stdin.close()
        ready = json.loads(process.stdout.readline())
        return process, ready["url"], ready["port"]
    except Exception:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        raise


saved = False
try:
    lab = EnterpriseLab()
    subprocess.run(
        ["node", str(HERE / "build.cjs")], cwd=ROOT, check=True, capture_output=True
    )
    if resume:
        progress.update(message="Reabrindo a instalação local.")
        progress["sources"] = lab.attach(resume)
    api_config = {
        "state": str(state),
        "root": str(ROOT),
        "backend": backend,
        "token": token,
        "python": sys.executable,
        "policyModule": (
            ROOT / "apps/aurora/domain" / ("pilot-policy.ts" if pilot else "policy.ts")
        ).as_uri(),
        "worker": str(HERE / "worker.py"),
        "uiDir": str(HERE),
        "monitorPerformance": True,
        "installation": lab.id,
        "evidenceContract": args.run_profile == "observability-v1",
        "governedModelSlots": True,
        "queueCapacity": 32,
        "resumeReserve": 8,
        "maxWorkers": args.workers,
        "recoveryBridgeKey": recovery_key,
        "recoveryReviewers": reviewers(state / "recovery-reviewers.json", lab.id),
        "pilotAccounts": pilot_accounts,
        "pilotDirective": directive[0] if directive else None,
        "pilotExpiresAt": int(pilot_expires * 1000) if pilot else None,
        "pilotRefundReference": refund_public_key is not None,
        "engineeringRepository": bool(
            not pilot and os.environ.get("AURORA_QUE_VOLUME")
        ),
    }
    node, api, api_config["port"] = start_api(api_config)
    if not pilot:
        atomic_write(
            active_path,
            json.dumps(
                {
                    "url": api,
                    "backend": backend,
                    "token": token,
                    "state": str(state),
                    "launcher_pid": os.getpid(),
                },
                indent=2,
            ).encode(),
        )
    print(
        json.dumps({"url": api} if pilot else {"url": api, "state": str(state)}),
        flush=True,
    )
    if pilot and not resume:
        progress.update(message="Preparando a sessão consultiva do piloto.")
        lab.start()
        if args.pilot_retrieval == "hybrid":
            progress.update(
                message="Indexando trechos autorizados com embeddings locais."
            )
            factory = globals().get("pilot_retriever_factory")
            if factory is None:
                pilot.hybrid = HybridRetriever(
                    pilot.passages, lab.embed_passages, pilot_facets
                )
            else:
                pilot.hybrid = factory(pilot, lab.embed_passages, pilot_facets)
        if pilot_recovery:
            lab.save_local_session([])
            saved = True
            atomic_write(active_path, json.dumps({"state": str(state)}).encode())
    elif not resume:
        progress.update(message="Iniciando bancos, embeddings e LightRAG.")
        lab.start()
        for i, d in enumerate(DOCS.values()):
            if stop.is_set():
                break
            progress.update(
                phase="indexing",
                message=f"Indexando documento vigente {i + 1}/{len(DOCS)}: "
                + d["title"],
            )
            progress["sources"].append(lab.stage(d))
        if stop.is_set():
            raise InterruptedError("Preparação interrompida pelo operador")
        (state / "environment.json").write_text(
            json.dumps(
                {
                    "installation": lab.id,
                    "versions": lab.evidence["versions"],
                    "langgraph_sha": lab.evidence["source_sha"],
                    "sources": progress["sources"],
                    "catalog": CATALOG,
                    "global_model_cap": CAP,
                    "run_profile": args.run_profile,
                    "budget_scope": "new observability qualification session; original 55 reservations remain historical"
                    if args.run_profile == "observability-v1"
                    else "original",
                    "production_approved": False,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        lab.save_local_session(progress["sources"])
        saved = True
    progress.update(
        phase="ready",
        message="Piloto pronto. Envie uma tarefa consultiva."
        if pilot
        else "Cérebro pronto. Escolha um cenário para o Chief compor a equipe.",
    )
    native_restarts = api_restarts = 0
    while not stop.wait(1):
        if pilot and time.time() >= pilot_expires:
            break
        if node.poll() is not None:
            if api_restarts >= 3:
                raise RuntimeError("Limite de reinícios da API atingido")
            api_restarts += 1
            node, api, _ = start_api(api_config)
        if lab.native_process.poll() is None:
            continue
        if native_restarts >= 3:
            raise RuntimeError("Limite de reinícios do serviço nativo atingido")
        native_restarts += 1
        progress.update(
            phase="recovering_native",
            message="Reconectando o serviço de inferência e verificando os recibos existentes.",
        )
        lab.start_native()
        progress.update(
            phase="ready",
            message="Serviço reconectado. Consulte a central para inferências sem recibo.",
        )
except Exception as error:
    progress.update(
        phase="failed", message="Falha na preparação; logs locais preservados."
    )
    (state / "startup-error.log").write_text(
        lab.redact(repr(error)) if lab else repr(error), encoding="utf-8"
    )
    print(json.dumps({"failed": True, "type": type(error).__name__}), flush=True)
    if pilot:
        raise SystemExit(1) from None
    while not pilot and node and node.poll() is None and not stop.wait(1):
        pass
finally:
    progress.update(phase="stopping")
    try:
        if node and node.poll() is None:
            node.terminate()
            node.wait(timeout=10)
        if lab:
            if saved or lab.attached:
                lab.park()
            elif not resume:
                lab.cleanup()
    finally:
        server.shutdown()
        server.server_close()
        owner.close()
        if pilot_temp:
            pilot_temp.cleanup()
