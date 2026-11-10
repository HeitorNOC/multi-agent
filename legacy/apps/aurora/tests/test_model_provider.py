"""Testes do contrato de provedor. Não chamam nenhuma conta real: subprocess é simulado."""

import asyncio
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from apps.aurora.runtime.diagnostics import ProviderError
from apps.aurora.runtime.services import model_provider as mp


def completed(stdout="", code=0):
    return subprocess.CompletedProcess(args=[], returncode=code, stdout=stdout, stderr="")


class ParseTests(unittest.TestCase):
    def test_structured_output(self):
        out = json.dumps({"structured_output": {"text": "oi"}, "usage": {"output_tokens": 3}})
        self.assertEqual(mp.parse_claude_output(out), ("oi", {"output_tokens": 3}))

    def test_result_string_with_json(self):
        out = json.dumps({"result": json.dumps({"text": "oi"})})
        self.assertEqual(mp.parse_claude_output(out)[0], "oi")

    def test_event_list(self):
        out = json.dumps([{"type": "system"}, {"type": "result", "result": '{"text":"x"}'}])
        self.assertEqual(mp.parse_claude_output(out)[0], "x")

    def test_error_and_empty_are_rejected(self):
        for payload in ({"is_error": True}, {"result": "  "}, {"structured_output": {"text": ""}}):
            with self.assertRaises(ProviderError):
                mp.parse_claude_output(json.dumps(payload))
        with self.assertRaises(ProviderError):
            mp.parse_claude_output("not json")


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.evidence = self.tmp / "evidence"
        self.evidence.mkdir()
        (self.tmp / "provider.schema.json").write_text('{"type":"object"}', encoding="utf-8")
        self.config = {"evidence": str(self.evidence), "instance": "t", "model_name": "m"}

    def provider(self):
        return mp.ClaudeCliProvider(self.config, reserve=lambda: {"id": "r1", "number": 1})

    def test_call_returns_text_and_logs_usage(self):
        out = json.dumps({"structured_output": {"text": "resposta"}, "usage": {"input_tokens": 5}})
        with mock.patch.object(mp.shutil, "which", return_value="claude"), \
                mock.patch.object(mp.subprocess, "run", return_value=completed(out)) as run:
            text = asyncio.run(self.provider()("pergunta", "sistema"))
        self.assertEqual(text, "resposta")
        args = run.call_args.args[0]
        self.assertIn("--no-session-persistence", args)
        self.assertEqual(args[args.index("--tools") + 1], "")
        record = json.loads((self.evidence / "model-calls.jsonl").read_text().splitlines()[0])
        self.assertEqual(record["provider"], "claude-cli")
        self.assertEqual(record["usage"], {"input_tokens": 5})

    def test_nonzero_exit_fails_but_is_still_logged(self):
        with mock.patch.object(mp.shutil, "which", return_value="claude"), \
                mock.patch.object(mp.subprocess, "run", return_value=completed("", 1)):
            with self.assertRaises(ProviderError):
                asyncio.run(self.provider()("p"))
        self.assertTrue((self.evidence / "model-calls.jsonl").exists())

    def test_missing_executable(self):
        with mock.patch.object(mp.shutil, "which", return_value=None):
            with self.assertRaises(ProviderError):
                asyncio.run(self.provider()("p"))

    def test_environment_is_filtered(self):
        with mock.patch.dict(mp.os.environ, {"DATABASE_URL": "x", "PATH": "p"}, clear=True):
            env = mp.clean_env()
        self.assertNotIn("DATABASE_URL", env)
        self.assertEqual(env["PATH"], "p")

    def test_factory(self):
        self.assertIs(mp.provider_factory({"provider": "claude"}), mp.ClaudeCliProvider)
        with self.assertRaises(ValueError):
            mp.provider_factory({"provider": "outro"})


if __name__ == "__main__":
    unittest.main()
