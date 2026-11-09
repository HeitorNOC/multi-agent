"""Local, bounded publication and extractive evidence for the pilot."""

import hashlib
import json
import re
import unicodedata
from pathlib import Path

from apps.aurora.runtime.diagnostics import DiagnosticError

MAX_PASSAGES = 6
MAX_SELECTION = 4
MAX_QUOTE_CHARS = 480
STOP_WORDS = set(
    "a o as os e em de do da dos das na no nos nas um uma uns umas para por com "
    "que qual quais quanto quando como onde seu sua seus suas sobre pelo pela "
    "informar indique tarefa atual vigente documento documentos regra regras".split()
)


def terms(text):
    normalized = unicodedata.normalize("NFKD", text.casefold())
    normalized = "".join(
        letter for letter in normalized if not unicodedata.combining(letter)
    )
    return {
        word for word in re.findall(r"\w{3,}", normalized) if word not in STOP_WORDS
    }


def digest(data):
    return hashlib.sha256(data).hexdigest()


def evidence_ids(value, allowed, *, limit=MAX_SELECTION):
    if not isinstance(value, dict) or set(value) != {"evidence_ids"}:
        raise DiagnosticError(
            "evidence_contract",
            "A resposta deve conter somente identificadores de evidência",
        )
    ids = value["evidence_ids"]
    if not isinstance(ids, list):
        raise DiagnosticError("evidence_not_list", "A seleção deve ser uma lista")
    if len(ids) > limit:
        raise DiagnosticError("evidence_limit", "A seleção excede o limite de citações")
    if any(not isinstance(item, str) or item not in allowed for item in ids):
        raise DiagnosticError(
            "evidence_not_authorized", "A seleção contém uma referência fora da tarefa"
        )
    if len(set(ids)) != len(ids):
        raise DiagnosticError(
            "evidence_duplicate", "A seleção contém referências repetidas"
        )
    return ids


def citation_verification(value, goal, allowed):
    if not isinstance(value, dict) or set(value) != {"evidence_ids", "unanswered"}:
        raise DiagnosticError(
            "verification_contract", "Contrato de verificação inválido"
        )
    ids = evidence_ids({"evidence_ids": value["evidence_ids"]}, allowed)
    gaps = value["unanswered"]
    if (
        not isinstance(gaps, list)
        or len(gaps) > MAX_SELECTION
        or any(
            not isinstance(gap, str) or not gap or gap != gap.strip() or gap not in goal
            for gap in gaps
        )
        or len(gaps) != len(set(gaps))
        or (not ids and gaps != [goal])
        or (ids and goal in gaps)
    ):
        raise DiagnosticError(
            "verification_invalid_gap",
            "Lacuna fora da pergunta original ou incompatível com as citações",
        )
    return ids, gaps


def requirement_assessments(value, requirements, allowed, *, canonical_ids=None):
    def reject():
        raise DiagnosticError(
            "invalid_requirement_assessment", "Parecer por requisito inválido"
        )

    if not isinstance(value, dict) or set(value) != {"assessments"}:
        reject()
    rows = value["assessments"]
    if not isinstance(rows, list) or len(rows) != len(requirements):
        reject()
    assessments = []
    accepted = {}
    gaps = []
    for query, row in zip(requirements, rows, strict=True):
        if not isinstance(row, dict) or set(row) != {"status", "note", "evidence_ids"}:
            reject()
        status, note = row["status"], row["note"]
        if status not in (
            "documented",
            "partial",
            "proposal",
            "test_pending",
            "unanswered",
        ):
            reject()
        if not isinstance(note, str) or not 1 <= len(note.strip()) <= 500:
            reject()
        ids = evidence_ids({"evidence_ids": row["evidence_ids"]}, allowed)
        if canonical_ids is not None:
            ids = [canonical_ids[label] for label in ids]
        if bool(ids) != (status in ("documented", "partial")):
            reject()
        if status != "documented":
            gaps.append(query)
        accepted.update(dict.fromkeys(ids))
        assessments.append({"requirement": query, **row, "evidence_ids": ids})
    return list(accepted), gaps, assessments


class PilotCorpus:
    def __init__(self, manifest):
        manifest = Path(manifest).resolve(strict=True)
        root = manifest.parent
        raw = manifest.read_bytes()
        if len(raw) > 65_536:
            raise ValueError("Manifesto excede o limite de tamanho")
        config = json.loads(raw)
        documents = config.get("documents")
        if (
            config.get("version") != 1
            or not isinstance(documents, list)
            or not 1 <= len(documents) <= 24
        ):
            raise ValueError(
                "O piloto requer um manifesto v1 com 1 a 24 versões de documentos"
            )
        self.sha256 = digest(raw)
        self.metadata = []
        self.passages = []
        self.contexts = {}
        self.hybrid = None
        versions = set()
        current = {}
        for doc in documents:
            source, version = doc["source"], doc["version"]
            classification = doc["classification"]
            if (
                not isinstance(source, str)
                or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,59}", source)
                or type(version) is not int
                or version < 1
                or (source, version) in versions
                or type(doc["current"]) is not bool
                or classification not in {"model-approved", "local-only"}
                or not all(
                    isinstance(doc[key], str) and 0 < len(doc[key].strip()) <= 120
                    for key in ("title", "area", "origin")
                )
            ):
                raise ValueError("Metadados documentais inválidos ou duplicados")
            versions.add((source, version))
            relative = Path(doc["file"])
            if (
                relative.is_absolute()
                or relative.anchor
                or ".." in relative.parts
                or ":" in doc["file"]
            ):
                raise ValueError("Caminho documental fora da pasta autorizada")
            path = (root / relative).resolve(strict=True)
            if (
                not path.is_relative_to(root)
                or path.suffix.lower() not in {".txt", ".md"}
                or not path.is_file()
            ):
                raise ValueError(
                    "Somente arquivos TXT/MD dentro da pasta autorizada são aceitos"
                )
            with path.open("rb") as stream:
                data = stream.read(65_537)
            if len(data) > 65_536 or digest(data) != doc["sha256"]:
                raise ValueError(
                    "Arquivo excede 64 KiB ou diverge do SHA-256 autorizado"
                )
            text = data.decode("utf-8")
            if not text.strip() or "\x00" in text:
                raise ValueError("Documento vazio ou incompatível com texto UTF-8")
            lines = text.splitlines()
            context_lines = doc.get("context_lines", [])
            if not isinstance(context_lines, list) or any(
                type(number) is not int
                or not 1 <= number <= len(lines)
                or not 12 <= len(lines[number - 1].strip()) <= MAX_QUOTE_CHARS
                for number in context_lines
            ):
                raise ValueError("Linhas de contexto inválidas no manifesto")
            context_lines = set(context_lines)
            if doc["current"]:
                if source in current:
                    raise ValueError("Duas versões vigentes da mesma fonte")
                current[source] = version
            metadata = {
                key: doc[key]
                for key in (
                    "source",
                    "version",
                    "title",
                    "area",
                    "origin",
                    "current",
                    "classification",
                    "sha256",
                )
            }
            self.metadata.append(metadata)
            if doc["current"] and classification == "model-approved":
                for number, line in enumerate(lines, 1):
                    context = line.strip() if number in context_lines else None
                    for match in re.finditer(
                        r"\S(?:[^.!?\r\n]|[.!?](?!\s|$))*[.!?]?", line
                    ):
                        quote = match.group().strip()
                        if not 12 <= len(quote) <= MAX_QUOTE_CHARS:
                            continue
                        reference = f"{source}:{version}:{doc['sha256']}:{number}:{match.start()}"
                        passage = {
                            "id": digest(reference.encode()),
                            "source": source,
                            "version": version,
                            "sha256": doc["sha256"],
                            "line": number,
                            "quote": quote,
                        }
                        self.passages.append((passage, terms(quote)))
                        if context and context != quote:
                            self.contexts[passage["id"]] = {
                                **passage,
                                "id": digest(
                                    f"{source}:{version}:{doc['sha256']}:{number}:context".encode()
                                ),
                                "quote": context,
                            }
        if not current or any(
            version > current[source]
            for source, version in versions
            if source in current
        ):
            raise ValueError(
                "A versão vigente deve ser a última versão publicada de cada fonte"
            )

    def retrieve(self, goal):
        selected = {}
        for passage in self.retrieve_sentences(goal):
            candidate = self.contexts.get(passage["id"], passage)
            selected.setdefault(candidate["id"], candidate)
        return list(selected.values())

    def retrieve_sentences(self, goal):
        if self.hybrid is not None:
            return self.hybrid.retrieve(goal)
        query = terms(goal)
        minimum = min(2, len(query))
        if not minimum:
            return []
        ranked = []
        for passage, words in self.passages:
            overlap = len(query & words)
            if overlap >= minimum:
                ranked.append((overlap, passage))
        ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
        return [passage for _, passage in ranked[:MAX_PASSAGES]]

    def report(
        self,
        goal,
        selection,
        *,
        unanswered=None,
        passages=None,
        citation_limit=MAX_SELECTION,
    ):
        available = {
            p["id"]: p for p in (self.retrieve(goal) if passages is None else passages)
        }
        ids = evidence_ids(selection, available, limit=citation_limit)
        report = {
            "status": "supported_extracts" if ids else "insufficient_evidence",
            "summary": "Trechos localizados para revisão humana."
            if ids
            else "Evidência insuficiente no acervo autorizado para responder à tarefa.",
            "citations": [available[item] for item in ids],
            "manifest_sha256": self.sha256,
            "requires_approval": True,
        }
        if unanswered is not None:
            report["unanswered"] = unanswered
            if ids and unanswered:
                report["status"] = "partial_evidence"
                report["summary"] = (
                    "Parte da pergunta tem evidência para revisão humana."
                )
        return report
