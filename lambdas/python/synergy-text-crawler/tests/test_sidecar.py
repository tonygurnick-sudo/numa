"""Unit tests for the Bedrock metadata sidecar — the retrievability contract.

A document is retrievable in chat ONLY if its sidecar carries tenant_id +
kb_id (the fail-closed filter) and the caller is in allowed_users (the
per-document ACL). These tests pin that contract.
"""

import json
import sys
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with mock.patch.dict(
    "os.environ",
    {"CLIENT_NAME": "testclient", "DATA_BUCKET_NAME": "b", "STATE_TABLE_NAME": "t"},
):
    import lambda_function  # noqa: E402


FILE_OBJ = {
    "ID": {"IDString": "12_1"},
    "FileName": "spec.pdf",
    "Path": "Jobs/Alpha/Docs",
    "LatestVersion": 3,
    "Attributes": [
        {"name": "revision", "display_name": "Revision", "value": {"_value": "C"}},
        {
            "name": "document_status",
            "display_name": "Document Status",
            "value": {"_value": "Issued"},
        },
        {
            "name": "internal_blob",
            "display_name": "Internal Blob",
            "value": {"_value": "x" * 500},
        },
    ],
}


class TestSidecar(unittest.TestCase):
    def _sidecar(self, **overrides: Any):
        kwargs: Dict[str, Any] = dict(
            allowed_users=["sub-a", "sub-b"],
            job_id="8_1",
            job_name="Alpha Subdivision",
            job_path="Jobs/Alpha",
            file_obj=FILE_OBJ,
            file_id="12_1",
            file_name="spec.pdf",
            version="3",
            weblink="https://synergy.example.com/link/12_1",
        )
        kwargs.update(overrides)
        return lambda_function._build_sidecar(**kwargs)

    def test_retrievability_keys_present(self):
        attrs = self._sidecar()["metadataAttributes"]
        self.assertEqual(attrs["tenant_id"], "testclient")
        self.assertEqual(attrs["kb_id"], "synergy")
        self.assertEqual(attrs["allowed_users"], ["sub-a", "sub-b"])

    def test_attribution_fields(self):
        attrs = self._sidecar()["metadataAttributes"]
        self.assertEqual(attrs["job_id"], "8_1")
        self.assertEqual(attrs["job_name"], "Alpha Subdivision")
        self.assertEqual(attrs["file_name"], "spec.pdf")
        self.assertEqual(attrs["version"], "3")
        self.assertEqual(attrs["revision"], "C")
        self.assertEqual(attrs["document_status"], "Issued")
        self.assertEqual(
            attrs["source_weblink"], "https://synergy.example.com/link/12_1"
        )
        self.assertEqual(attrs["source"], "synergy-crawler")

    def test_no_unbounded_attr_spread(self):
        # Bedrock caps metadata attribute count/size — the sidecar must NOT
        # spread arbitrary 12d custom attributes (attr_*).
        attrs = self._sidecar()["metadataAttributes"]
        self.assertFalse(any(k.startswith("attr_") for k in attrs))
        self.assertNotIn("Internal Blob", str(attrs.keys()))

    def test_missing_optional_attrs_default_empty(self):
        bare = dict(FILE_OBJ)
        bare["Attributes"] = None
        attrs = self._sidecar(file_obj=bare, weblink="")["metadataAttributes"]
        self.assertEqual(attrs["revision"], "")
        self.assertEqual(attrs["document_status"], "")
        self.assertEqual(attrs["source_weblink"], "")


class TestSidecarSizeBudget(unittest.TestCase):
    """An oversized .metadata.json is rejected by Bedrock ingestion, which strips
    tenant_id/kb_id and makes the doc invisible to EVERYONE. allowed_users is
    byte-budgeted so the sidecar always ingests; truncation is logged, not silent.
    """

    @staticmethod
    def _subs(n: int):
        # 36-char UUID-shaped subs, like real Cognito subs.
        return [f"{i:08d}-0000-4000-8000-000000000000" for i in range(n)]

    def _build(self, users):
        return lambda_function._build_sidecar(
            allowed_users=users,
            job_id="8_1",
            job_name="Alpha",
            job_path="Jobs/Alpha",
            file_obj=FILE_OBJ,
            file_id="12_1",
            file_name="spec.pdf",
            version="3",
        )

    def test_small_acl_not_truncated(self):
        users = self._subs(5)
        attrs = self._build(users)["metadataAttributes"]
        self.assertEqual(attrs["allowed_users"], users)

    def test_huge_acl_fits_under_cap_and_keeps_keys(self):
        sidecar = self._build(self._subs(5000))
        attrs = sidecar["metadataAttributes"]
        # Budget is the FILTERABLE metadata map (S3 Vectors 2 KB/vector cap), not the
        # whole .metadata.json file. Every attrs key is filterable.
        size = len(json.dumps(attrs, ensure_ascii=False).encode("utf-8"))
        self.assertLessEqual(size, lambda_function.SIDECAR_FILTERABLE_MAX_BYTES)
        # The doc must stay retrievable: identity keys survive, some users kept.
        self.assertEqual(attrs["tenant_id"], "testclient")
        self.assertEqual(attrs["kb_id"], "synergy")
        self.assertGreater(len(attrs["allowed_users"]), 0)
        self.assertLess(len(attrs["allowed_users"]), 5000)

    def test_truncation_keeps_a_prefix(self):
        users = self._subs(5000)
        attrs = self._build(users)["metadataAttributes"]
        kept = attrs["allowed_users"]
        self.assertEqual(kept, users[: len(kept)])

    def test_filterable_cap_is_the_binding_limit(self):
        # ~40 users: the whole sidecar is well under the old 9.5 KB whole-file budget,
        # but the FILTERABLE map exceeds the S3 Vectors cap — so allowed_users IS
        # truncated now, where the old whole-file guard would have let it ingest and
        # then Bedrock would have silently dropped the doc.
        users = self._subs(40)
        sidecar = self._build(users)
        attrs = sidecar["metadataAttributes"]
        whole = len(json.dumps(sidecar, ensure_ascii=False).encode("utf-8"))
        self.assertLess(whole, 9500)  # would NOT have truncated under the old guard
        self.assertLess(len(attrs["allowed_users"]), 40)  # filterable cap truncated it
        size = len(json.dumps(attrs, ensure_ascii=False).encode("utf-8"))
        self.assertLessEqual(size, lambda_function.SIDECAR_FILTERABLE_MAX_BYTES)

    def test_long_display_fields_clamped_before_acl_dropped(self):
        # A deep folder path / long weblink is display-only (not a query filter), so
        # it must be CLAMPED to free budget before any authorized user is dropped from
        # the ACL — the doc fits AND the small ACL is preserved intact.
        users = self._subs(5)
        long_path = "Jobs/" + "VeryDeepFolderName/" * 60  # ~1140 chars
        sidecar = lambda_function._build_sidecar(
            allowed_users=users,
            job_id="8_1",
            job_name="Alpha",
            job_path=long_path,
            file_obj={"Path": long_path, "Attributes": []},
            file_id="12_1",
            file_name="spec.pdf",
            version="3",
        )
        attrs = sidecar["metadataAttributes"]
        self.assertEqual(attrs["allowed_users"], users)  # ACL preserved, not dropped
        self.assertLessEqual(
            len(attrs["job_path"]), lambda_function._SIDECAR_FIELD_MAX_CHARS
        )
        self.assertLessEqual(
            len(attrs["file_path"]), lambda_function._SIDECAR_FIELD_MAX_CHARS
        )
        size = len(json.dumps(attrs, ensure_ascii=False).encode("utf-8"))
        self.assertLessEqual(size, lambda_function.SIDECAR_FILTERABLE_MAX_BYTES)

    def test_display_nonfilterable_flag_frees_budget_for_acl(self):
        # The durable fix: with SYNERGY_DISPLAY_NONFILTERABLE ON (a re-embedded index whose
        # nonFilterableMetadataKeys cover the long display keys is live), those keys no
        # longer count against the 2 KB filterable budget — so the freed budget goes to
        # allowed_users, keeping MORE subs than the conservative (flag OFF) path. The flag
        # is gated because turning it on against an OLD index would under-count and let an
        # oversized map through.
        users = self._subs(5000)
        long_path = "Jobs/" + "VeryDeepFolderName/" * 60  # ~1140 chars
        long_link = "https://synergy.example.com/very/long/weblink/" + "x" * 400

        def _build_with_long_display():
            return lambda_function._build_sidecar(
                allowed_users=users,
                job_id="8_1",
                job_name="A" * 300,
                job_path=long_path,
                file_obj={"Path": long_path, "Attributes": []},
                file_id="12_1",
                file_name="spec.pdf",
                version="3",
                weblink=long_link,
            )

        # Flag OFF (default): the whole attrs map (incl. clamped display keys) is measured.
        with mock.patch.object(lambda_function, "SYNERGY_DISPLAY_NONFILTERABLE", False):
            off_attrs = _build_with_long_display()["metadataAttributes"]
        kept_off = len(off_attrs["allowed_users"])

        # Flag ON: the 5 display keys are excluded from the filterable measurement.
        with mock.patch.object(lambda_function, "SYNERGY_DISPLAY_NONFILTERABLE", True):
            on_sidecar = _build_with_long_display()
        on_attrs = on_sidecar["metadataAttributes"]
        kept_on = len(on_attrs["allowed_users"])

        # The freed budget goes to the ACL: ON keeps strictly more authorized users.
        self.assertGreater(kept_on, kept_off)

        # And with the flag on, the FILTERABLE subset (everything EXCEPT the 5 display
        # keys the index now marks non-filterable) stays under the S3 Vectors cap.
        filterable = {
            k: v
            for k, v in on_attrs.items()
            if k not in lambda_function._NONFILTERABLE_DISPLAY_KEYS
        }
        size = len(json.dumps(filterable, ensure_ascii=False).encode("utf-8"))
        self.assertLessEqual(size, lambda_function.SIDECAR_FILTERABLE_MAX_BYTES)

        # Identity keys (filterable) survive either way.
        self.assertEqual(on_attrs["tenant_id"], "testclient")
        self.assertEqual(on_attrs["kb_id"], "synergy")


class TestSafeName(unittest.TestCase):
    def test_safe_strips_path_chars(self):
        self.assertNotIn("/", lambda_function._safe("a/b\\c:d.pdf"))

    def test_safe_empty_fallback(self):
        self.assertEqual(lambda_function._safe(""), "file")


if __name__ == "__main__":
    unittest.main()
