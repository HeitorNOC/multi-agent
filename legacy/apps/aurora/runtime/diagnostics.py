"""Local diagnostics that exclude exception messages, payloads and frame locals."""

import json
import re
import traceback
from pathlib import Path
from subprocess import TimeoutExpired
from urllib.error import HTTPError
from uuid import UUID


class DiagnosticError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class ProviderError(RuntimeError):
    def __init__(self, code):
        super().__init__("model invocation failed; see evidence")
        self.code = code


def _cause(error):
    record = {"type": type(error).__name__}
    if isinstance(error, (DiagnosticError, ProviderError)):
        record["code"] = error.code
    elif isinstance(error, json.JSONDecodeError):
        record.update(code="invalid_json", line=error.lineno, column=error.colno)
    elif isinstance(error, HTTPError):
        record.update(code="upstream_http_error", status=error.code)
    elif isinstance(error, (TimeoutError, TimeoutExpired)):
        record["code"] = "timeout"
    elif isinstance(error, OSError):
        record.update(code="os_error", errno=error.errno)
    else:
        record["code"] = "unexpected_exception"
    record["frames"] = [
        {
            "file": Path(frame.f_code.co_filename).name,
            "function": frame.f_code.co_name,
            "line": line,
        }
        for frame, line in traceback.walk_tb(error.__traceback__)
    ][-8:]
    return record


def diagnostic(error, service, context=None):
    context = context if isinstance(context, dict) else {}
    record = {"service": service, "causes": []}
    job = context.get("job")
    if isinstance(job, str) and len(job) == 36:
        try:
            record["job"] = str(UUID(job))
        except ValueError:
            pass
    for field in ("action", "slot"):
        value = context.get(field)
        if isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_:]{0,63}", value):
            record[field] = value
    seen = set()
    while error is not None and id(error) not in seen and len(seen) < 5:
        seen.add(id(error))
        record["causes"].append(_cause(error))
        error = error.__cause__ or (
            None if error.__suppress_context__ else error.__context__
        )
    return record
