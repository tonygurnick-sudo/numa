"""Security-critical coverage for the Synergy per-user ACL / fail-closed paths
in `_query_bedrock`.

The Synergy corpus is a single Bedrock KB shared across a tenant's users; the
`listContains(allowed_users, user_sub)` clause is the ONLY isolation. These tests
pin that:

- the listContains ACL + doc_type equals clauses are present for a normal query,
- the query fails CLOSED (retrieve() never called) when caller identity is
  missing, and — the #13 fix — when CLIENT_NAME is missing,
- structured rollup filters only attach in job_rollup mode.

We patch `tools.knowledge_base.prm_client` so `retrieve()` captures its kwargs,
and monkeypatch the module-level CLIENT_NAME / BEDROCK_KNOWLEDGE_BASE_ID
constants (read at import time).
"""

import unittest
from typing import Any, Dict, List, cast
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function
import tools.kb_permissions as kb_permissions
import tools.knowledge_base as kb
from tools.knowledge_base import _query_bedrock


def _and_all(retrieval_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pull the andAll clause list out of a captured retrievalConfiguration."""
    return retrieval_config["vectorSearchConfiguration"]["filter"]["andAll"]


class TestSynergyAcl(unittest.TestCase):
    def setUp(self) -> None:
        # Module-level constants are read at import; override them per-test so
        # _query_bedrock takes the configured Bedrock path.
        self._orig_client_name = kb.CLIENT_NAME
        self._orig_kb_id = kb.BEDROCK_KNOWLEDGE_BASE_ID
        kb.CLIENT_NAME = "acme"
        kb.BEDROCK_KNOWLEDGE_BASE_ID = "BEDROCKKB123"

    def tearDown(self) -> None:
        kb.CLIENT_NAME = self._orig_client_name
        kb.BEDROCK_KNOWLEDGE_BASE_ID = self._orig_kb_id

    def _retrieve_mock(self, mock_prm: MagicMock) -> MagicMock:
        """Wire prm_client → a client whose retrieve() returns no hits and
        records its kwargs. Returns the retrieve MagicMock for assertions."""
        client = MagicMock()
        client.retrieve.return_value = {"retrievalResults": []}
        mock_prm.return_value = client
        return client.retrieve

    # (a) synergy + user_sub present → andAll has the listContains ACL and the
    #     doc_type equals clause (plus tenant_id / kb_id).
    @patch("tools.knowledge_base.prm_client")
    def test_synergy_with_user_sub_applies_acl(self, mock_prm: MagicMock) -> None:
        retrieve = self._retrieve_mock(mock_prm)

        _query_bedrock("similar jobs", 6, "synergy", user_sub="user-123")

        retrieve.assert_called_once()
        and_all = _and_all(retrieve.call_args.kwargs["retrievalConfiguration"])
        self.assertIn(
            {"listContains": {"key": "allowed_users", "value": "user-123"}}, and_all
        )
        self.assertIn({"equals": {"key": "tenant_id", "value": "acme"}}, and_all)
        self.assertIn({"equals": {"key": "kb_id", "value": "synergy"}}, and_all)
        # Default mode searches the per-document corpus.
        self.assertIn({"equals": {"key": "doc_type", "value": "document"}}, and_all)

    # (b) synergy + empty user_sub → fail-closed: retrieve() NOT called.
    @patch("tools.knowledge_base.prm_client")
    def test_synergy_missing_user_sub_fails_closed(self, mock_prm: MagicMock) -> None:
        retrieve = self._retrieve_mock(mock_prm)

        result = _query_bedrock("similar jobs", 6, "synergy", user_sub="")

        retrieve.assert_not_called()
        self.assertEqual(
            result,
            {"content_pieces": [], "references": [], "provider": "bedrock"},
        )

    # (c) synergy + empty CLIENT_NAME → fail-closed (#13): without it the filter
    #     block is skipped entirely, so we must deny BEFORE calling retrieve().
    @patch("tools.knowledge_base.prm_client")
    def test_synergy_missing_client_name_fails_closed(
        self, mock_prm: MagicMock
    ) -> None:
        kb.CLIENT_NAME = ""
        retrieve = self._retrieve_mock(mock_prm)

        result = _query_bedrock("similar jobs", 6, "synergy", user_sub="user-123")

        retrieve.assert_not_called()
        self.assertEqual(
            result,
            {"content_pieces": [], "references": [], "provider": "bedrock"},
        )

    # (d) job_rollup mode + structured_filters → structured clauses present.
    @patch("tools.knowledge_base.prm_client")
    def test_rollup_mode_attaches_structured_filters(self, mock_prm: MagicMock) -> None:
        retrieve = self._retrieve_mock(mock_prm)

        _query_bedrock(
            "council jobs",
            6,
            "synergy",
            user_sub="user-123",
            doc_type="job_rollup",
            structured_filters={
                "created_after": "2023-01-01",
                "attr_job_type": "Council",
            },
        )

        retrieve.assert_called_once()
        and_all = _and_all(retrieve.call_args.kwargs["retrievalConfiguration"])
        self.assertIn({"equals": {"key": "doc_type", "value": "job_rollup"}}, and_all)
        self.assertIn(
            {"greaterThanOrEquals": {"key": "created_date", "value": "2023-01-01"}},
            and_all,
        )
        self.assertIn({"equals": {"key": "attr_job_type", "value": "Council"}}, and_all)

    # (e) default/document mode → structured clauses absent even if supplied
    #     (those fields live only on rollups; attaching them would match nothing).
    @patch("tools.knowledge_base.prm_client")
    def test_document_mode_omits_structured_filters(self, mock_prm: MagicMock) -> None:
        retrieve = self._retrieve_mock(mock_prm)

        _query_bedrock(
            "find the spec",
            6,
            "synergy",
            user_sub="user-123",
            doc_type="",  # → document mode
            structured_filters={"created_after": "2023-01-01"},
        )

        retrieve.assert_called_once()
        and_all = _and_all(retrieve.call_args.kwargs["retrievalConfiguration"])
        self.assertIn({"equals": {"key": "doc_type", "value": "document"}}, and_all)
        # No structured (rollup-only) clause leaked into a document search.
        self.assertNotIn(
            {"greaterThanOrEquals": {"key": "created_date", "value": "2023-01-01"}},
            and_all,
        )
        self.assertFalse(
            any("created_date" in str(clause) for clause in and_all),
            f"document-mode search should carry no created_date clause: {and_all}",
        )


class TestSynergyDispatchGate(unittest.TestCase):
    """Dispatch-level coverage pinning R1: the verify_kb_access gate in
    lambda_function.handler must NOT deny a single-KB synergy query while
    'synergy' is in SYSTEM_KB_IDS, and MUST deny it when it isn't.

    The earlier _query_bedrock tests bypass this gate entirely — but the gate is
    exactly what blocked every synergy query before R1. These tests exercise the
    real dispatch path with the Bedrock retrieve mocked out so nothing hits AWS.
    """

    def setUp(self) -> None:
        # Configure the Bedrock read path so the handler reaches a retrieve().
        self._orig_client_name = kb.CLIENT_NAME
        self._orig_kb_id = kb.BEDROCK_KNOWLEDGE_BASE_ID
        self._orig_bucket = kb.DATA_BUCKET_NAME
        self._orig_perm_client_name = kb_permissions.CLIENT_NAME
        kb.CLIENT_NAME = "acme"
        kb.BEDROCK_KNOWLEDGE_BASE_ID = "BEDROCKKB123"
        kb.DATA_BUCKET_NAME = "acme-data-bucket"
        kb_permissions.CLIENT_NAME = "acme"

    def tearDown(self) -> None:
        kb.CLIENT_NAME = self._orig_client_name
        kb.BEDROCK_KNOWLEDGE_BASE_ID = self._orig_kb_id
        kb.DATA_BUCKET_NAME = self._orig_bucket
        kb_permissions.CLIENT_NAME = self._orig_perm_client_name

    def _dispatch_synergy_query(self) -> Dict[str, Any]:
        """Run a single-KB synergy query through the real handler with the
        Bedrock/S3 clients stubbed out, and return the handler envelope."""
        with patch("tools.knowledge_base.prm_client") as mock_prm:
            client = MagicMock()
            client.retrieve.return_value = {"retrievalResults": []}
            mock_prm.return_value = client
            return lambda_function.handler(
                {
                    "tool": "query_knowledgebase",
                    "allowed_kbs": ["company", "synergy"],
                    "allowed_kbs_with_names": [
                        {"id": "company", "name": "Company"},
                        {"id": "synergy", "name": "Synergy"},
                    ],
                    "user_sub": "user-123",
                    "params": {
                        "query": "similar jobs",
                        "user_intent": "find related work",
                        "kb_id": "synergy",
                    },
                },
                cast(LambdaContext, object()),
            )

    @staticmethod
    def _is_access_denied(result: Dict[str, Any]) -> bool:
        return result.get("status") == "error" and "Access denied to folder" in (
            result.get("error") or ""
        )

    def test_synergy_single_kb_not_denied_when_system_kb(self) -> None:
        # 'synergy' IS in SYSTEM_KB_IDS → the gate short-circuits (no DynamoDB)
        # and the query proceeds to a (mocked) retrieve. Pins R1.
        self.assertIn("synergy", kb_permissions.SYSTEM_KB_IDS)

        result = self._dispatch_synergy_query()

        self.assertFalse(
            self._is_access_denied(result),
            f"synergy query was denied at the dispatch gate: {result}",
        )
        self.assertEqual(result["status"], "success")

    def test_synergy_single_kb_denied_when_not_system_kb(self) -> None:
        # Remove 'synergy' from SYSTEM_KB_IDS → verify_kb_access falls through to
        # a DynamoDB get_item for KB#synergy, which has no record (mocked to
        # return no Item) → access denied. This reproduces the pre-R1 bug, so a
        # green test (a) proves the gate is what blocked synergy and (b) guards
        # the fix from being silently reverted.
        patched = set(kb_permissions.SYSTEM_KB_IDS) - {"synergy"}
        ddb = MagicMock()
        ddb.get_item.return_value = {}  # no Item → KB not found → deny

        with patch.object(kb_permissions, "SYSTEM_KB_IDS", patched), patch.object(
            kb_permissions, "_get_dynamodb_client", return_value=ddb
        ):
            result = self._dispatch_synergy_query()

        self.assertTrue(
            self._is_access_denied(result),
            f"synergy query should be denied when it is not a system KB: {result}",
        )
        ddb.get_item.assert_called_once()


class TestSynergyFileOpsDenied(unittest.TestCase):
    """Synergy is queryable (ACL-filtered in _query_bedrock) but must NOT be
    browsable/downloadable via the raw S3 file-ops paths, which have no per-document
    allowed_users ACL. Both _get_s3_prefix chokepoints must hard-deny synergy even
    though verify_kb_access permits it as a system KB."""

    def test_knowledge_base_get_s3_prefix_denies_synergy(self) -> None:
        with self.assertRaises(ValueError):
            kb._get_s3_prefix("synergy")
        # Non-synergy KBs still resolve normally.
        self.assertEqual(kb._get_s3_prefix("company"), "documents/company/")

    def test_list_kb_files_get_s3_prefix_denies_synergy(self) -> None:
        import tools.list_kb_files as lkf

        with self.assertRaises(ValueError):
            lkf._get_s3_prefix("synergy")
        self.assertEqual(lkf._get_s3_prefix("company"), "documents/company/")

    def test_handle_list_kb_files_does_not_leak_synergy(self) -> None:
        import tools.list_kb_files as lkf

        params: Dict[str, Any] = {
            "kb_ids": ["synergy"],
            "__user_sub": "user-123",
            "__allowed_kbs": ["company", "synergy"],
        }
        # verify_kb_access permits synergy (system KB) — the _get_s3_prefix guard is
        # the load-bearing block. The synergy kb_id must surface as an error, never a
        # listing.
        with patch.object(lkf, "verify_kb_access", return_value=True), patch.object(
            lkf, "DATA_BUCKET_NAME", "test-bucket"
        ):
            result = lkf.handle_list_kb_files(params)
        self.assertNotIn("synergy", result.get("listings", {}))
        errors = {e.get("kb_id") for e in result.get("errors", [])}
        self.assertIn("synergy", errors)


class TestSystemKbIdsInSync(unittest.TestCase):
    """SYSTEM_KB_IDS is duplicated in kb_permissions.py and knowledge_base.py (with a
    hand-maintained "keep in sync" note). Both gate the synergy KB — the dispatch
    gate and the per-document ACL query — so a drift would silently open or close
    access. Enforce equality so the two copies can never diverge unnoticed."""

    def test_copies_match(self) -> None:
        self.assertEqual(kb_permissions.SYSTEM_KB_IDS, kb.SYSTEM_KB_IDS)

    def test_synergy_is_a_system_kb_in_both(self) -> None:
        self.assertIn("synergy", kb_permissions.SYSTEM_KB_IDS)
        self.assertIn("synergy", kb.SYSTEM_KB_IDS)


if __name__ == "__main__":
    unittest.main()
