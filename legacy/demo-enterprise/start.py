"""Compatibility entry point. Implementation: apps.aurora.ops.launcher."""

from pathlib import Path
import runpy
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    runpy.run_module("apps.aurora.ops.launcher", run_name="__main__")
