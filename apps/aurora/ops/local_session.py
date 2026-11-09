"""Private resume metadata for the current Windows user on this host."""

import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path
from uuid import uuid4


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(value, protect):
    if os.name != "nt":
        raise RuntimeError("A retomada local requer Windows DPAPI")
    buffer = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    source = Blob(len(value), buffer)
    target = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    transform = crypt.CryptProtectData if protect else crypt.CryptUnprotectData
    transform.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    transform.restype = wintypes.BOOL
    if not transform(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        free = ctypes.WinDLL("kernel32").LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(target.data)


def atomic_write(path: Path, data: bytes):
    staging = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with staging.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        staging.replace(path)
    finally:
        staging.unlink(missing_ok=True)


def save_resume(state: Path, record):
    atomic_write(
        state / "resume.dpapi", dpapi(json.dumps(record, ensure_ascii=False).encode(), True)
    )


def load_resume(state: Path):
    record = json.loads(dpapi((state / "resume.dpapi").read_bytes(), False))
    if record.get("version") != 1 or Path(record["state"]).resolve() != state.resolve():
        raise ValueError("Metadados de retomada pertencem a outra sessão")
    return record


def inspect_resources(docker, installation, resources):
    result = {}
    for kind, name in resources:
        command = (
            ("inspect", "--type", "container", name)
            if kind == "container"
            else ("volume", "inspect", name)
        )
        row = json.loads(docker(*command).stdout)[0]
        labels = row["Config"]["Labels"] if kind == "container" else row["Labels"]
        if labels.get("qualification") != installation:
            raise ValueError("Recurso Docker pertence a outra instalação")
        result[name] = {
            "identity": row["Id"] if kind == "container" else row["CreatedAt"],
            "running": row["State"]["Running"] if kind == "container" else False,
        }
    return result
