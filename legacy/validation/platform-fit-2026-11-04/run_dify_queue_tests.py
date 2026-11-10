"""Run unchanged Dify tests with real Graphon, mocking only its Redis stop I/O.

This is a unit boundary test, not a running Dify API/worker integration.
"""
from pathlib import Path
import sys
import types

import pytest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'research/platform-fit-2026-11-04/sources'
sys.path.insert(0, str(SOURCE / 'graphon/src'))
sys.path.insert(0, str(SOURCE / 'dify/api'))
coordinator = types.ModuleType('core.app.apps.execution_coordinator')
coordinator.is_app_task_stop_flag_set = lambda task_id: False
sys.modules[coordinator.__name__] = coordinator
raise SystemExit(pytest.main([
    '-o', 'addopts=', '-q',
    str(SOURCE / 'dify/api/tests/unit_tests/core/app/apps/workflow/test_stop_aware_ready_queue.py'),
    '--junitxml=' + str(Path(__file__).parent / 'dify-queue.xml'),
]))
