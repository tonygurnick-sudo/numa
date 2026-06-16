"""Unit tests for the Bedrock metadata sidecar — the retrievability contract.

A document is retrievable in chat ONLY if its sidecar carries tenant_id +
kb_id (the fail-closed filter) and the caller is in allowed_users (the
per-document ACL). These tests pin that contract.
"""

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


class TestSafeName(unittest.TestCase):
    def test_safe_strips_path_chars(self):
        self.assertNotIn("/", lambda_function._safe("a/b\\c:d.pdf"))

    def test_safe_empty_fallback(self):
        self.assertEqual(lambda_function._safe(""), "file")


if __name__ == "__main__":
    unittest.main()
