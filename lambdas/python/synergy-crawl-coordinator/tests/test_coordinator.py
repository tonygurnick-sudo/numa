"""Unit tests for the coordinator's pure helpers — PAT extraction, job
identity, and the grant/revocation set algebra of the scheduled pass."""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with mock.patch.dict(
    "os.environ", {"CLIENT_NAME": "testclient", "STATE_TABLE_NAME": "t"}
):
    import lambda_function  # noqa: E402


class TestExtractPat(unittest.TestCase):
    def test_connector_synergy(self):
        vault = {
            "secrets": {"connector-synergy": {"fields": {"access_token": " tok "}}}
        }
        self.assertEqual(lambda_function._extract_pat(vault), "tok")

    def test_oauth_synergy_fallback(self):
        vault = {"secrets": {"oauth-synergy": {"fields": {"access_token": "tok2"}}}}
        self.assertEqual(lambda_function._extract_pat(vault), "tok2")

    def test_missing(self):
        self.assertEqual(lambda_function._extract_pat(None), "")
        self.assertEqual(lambda_function._extract_pat({}), "")
        self.assertEqual(lambda_function._extract_pat({"secrets": {}}), "")
        self.assertEqual(
            lambda_function._extract_pat(
                {"secrets": {"connector-synergy": {"fields": {}}}}
            ),
            "",
        )


class TestJobIdentity(unittest.TestCase):
    def test_nested_id(self):
        self.assertEqual(lambda_function._job_id({"ID": {"IDString": "8_1"}}), "8_1")

    def test_flat_id(self):
        self.assertEqual(lambda_function._job_id({"IDString": "9_1"}), "9_1")

    def test_missing(self):
        self.assertIsNone(lambda_function._job_id({}))


class TestVaultPath(unittest.TestCase):
    def test_path(self):
        self.assertEqual(
            lambda_function._vault_path("abc-123"), "testclient/vault/users/abc-123"
        )


class TestGrantRevokeAlgebra(unittest.TestCase):
    """The scheduled pass's allowed_users rebuild, as set algebra.

    new = (old - verified) | {u in verified : job in S_u}

    i.e. users whose enumeration succeeded are fully re-derived (grant AND
    revoke); users we could not verify keep their existing grants.
    """

    @staticmethod
    def _rebuild(old, verified, jid):
        kept = {u for u in old if u not in verified}
        return kept | {u for u, seen in verified.items() if jid in seen}

    def test_grant_new_user(self):
        new = self._rebuild(set(), {"alice": {"j1"}}, "j1")
        self.assertEqual(new, {"alice"})

    def test_revoke_verified_user_who_lost_job(self):
        new = self._rebuild({"alice"}, {"alice": set()}, "j1")
        self.assertEqual(new, set())

    def test_unverified_user_keeps_grant(self):
        # bob's PAT expired — his enumeration is absent from `verified`, so his
        # existing grant must survive (fail-safe, derived from his own past PAT).
        new = self._rebuild({"bob"}, {"alice": {"j1"}}, "j1")
        self.assertEqual(new, {"alice", "bob"})

    def test_mixed(self):
        old = {"alice", "bob", "carol"}
        verified = {"alice": {"j1"}, "carol": set()}  # bob unverifiable
        new = self._rebuild(old, verified, "j1")
        self.assertEqual(new, {"alice", "bob"})  # carol revoked, bob kept


if __name__ == "__main__":
    unittest.main()
