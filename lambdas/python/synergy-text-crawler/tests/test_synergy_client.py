"""Unit tests for the worker's 12d client helpers."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from synergy_client import Synergy  # noqa: E402


class TestBuildLimitId(unittest.TestCase):
    def test_valid_idstring(self):
        # /files/search 500s without _server_id — the LimitID must carry it.
        obj = Synergy._build_limit_id("8_1")
        self.assertEqual(obj, {"IDString": "8_1", "_id": 8, "_server_id": 1})

    def test_malformed_idstring(self):
        self.assertIsNone(Synergy._build_limit_id("not-an-id"))
        self.assertIsNone(Synergy._build_limit_id("8"))
        self.assertIsNone(Synergy._build_limit_id(""))


class TestTokenNormalization(unittest.TestCase):
    def test_bearer_prefix_stripped_once(self):
        s = Synergy("https://example.com", "Bearer abc123")
        self.assertEqual(s.h["Authorization"], "Bearer abc123")

    def test_bare_token_gets_prefix(self):
        s = Synergy("https://example.com", "abc123")
        self.assertEqual(s.h["Authorization"], "Bearer abc123")


if __name__ == "__main__":
    unittest.main()
