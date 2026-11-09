"""Compatibility imports for existing validation scripts."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.aurora.runtime.model_gateway import call_model
