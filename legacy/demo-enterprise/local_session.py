"""Compatibility imports for existing validation scripts."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.aurora.ops.local_session import atomic_write, dpapi, inspect_resources, load_resume, save_resume
