"""Allowlisted connection to the existing business recovery protocol; never runs inference."""

import json
import pathlib
import secrets
import urllib.error
import urllib.request


def reviewers(path, installation):
    accounts = [
        {"id": "board", "label": "Revisor local 1", "credential": secrets.token_hex(32)},
        {"id": "reviewer2", "label": "Revisor local 2", "credential": secrets.token_hex(32)},
    ]
    pathlib.Path(path).write_text(
        json.dumps(
            {
                "installation": installation,
                "scope": "development-only; separate identities, not enterprise SSO",
                "accounts": accounts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return accounts


class RecoveryBridge:
    def __init__(self, lab, model_slots=False):
        self.lab = lab
        self.model_slots = model_slots

    def call(self, payload):
        actor = payload.get("reviewer")
        command = payload.get("command", {})
        if actor not in ["board", "reviewer2"] or actor not in self.lab.tokens:
            return {"ok": False, "status": 403, "code": "forbidden"}
        if command.get("action") not in [
            "recovery_queue",
            "recovery_inspect",
            "recovery_propose",
            "recovery_confirm",
        ]:
            return {"ok": False, "status": 400, "code": "unsupported_command"}
        model_case = str(command.get("case_id", "")).startswith(self.lab.id + ":model:")
        request = urllib.request.Request(
            self.lab.api + "/rpc",
            json.dumps(command).encode(),
            {
                "content-type": "application/json",
                "authorization": "Bearer " + self.lab.tokens[actor],
            },
        )
        try:
            if self.model_slots and model_case:
                return self.lab.native("model_slot_recovery", reviewer=actor, command=command)
            with urllib.request.urlopen(request, timeout=12) as response:
                result = json.load(response)
            if (
                self.model_slots
                and command["action"] == "recovery_queue"
                and not result.get("blocked")
            ):
                slots = self.lab.native("model_slot_recovery", reviewer=actor, command=command)
                if not slots["ok"]:
                    return slots
                for field in ("cases", "history"):
                    result[field].extend(slots["result"][field])
            return {"ok": True, "result": result}
        except urllib.error.HTTPError as error:
            if (
                self.model_slots
                and (model_case or command["action"] == "recovery_queue")
                and error.code >= 500
            ):
                return {"ok": False, "status": 503, "code": "protocol_unavailable"}
            return {
                "ok": False,
                "status": error.code,
                "code": "forbidden" if error.code == 403 else "protocol_rejected",
            }
        except (OSError, TimeoutError):
            return {"ok": False, "status": 503, "code": "protocol_unavailable"}
