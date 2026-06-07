"""Lossless presigned-spillover guards for KB tool handlers.

The workspace agent invokes the KB tools synchronously via Lambda
``RequestResponse``, which caps the response payload at 6 MB. A larger result
would be silently truncated mid-JSON, surfacing to the agent as an opaque
JSONDecodeError.

The fix is **lossless presigned spillover**, never truncation. These tests
assert:

  * A result that fits the budget is returned inline, unchanged (fast path).
  * An oversized result is spilled: the handler returns the fixed oversized
    envelope (``oversized: True`` + ``result_url`` + ``result_sha256`` +
    ``result_size``), the FULL result JSON is written to S3, the presigned URL
    points at it, ``result_sha256`` matches the exact stored bytes, and
    round-tripping the stored JSON reproduces the original result EXACTLY —
    i.e. NOTHING is dropped.
"""

import hashlib
import json
import unittest
from unittest.mock import MagicMock, patch

from tools.extract_content import _spill_extract_response
from tools.knowledge_base import _spill_query_response, _spill_structured_result
from tools.list_kb_files import _spill_listings_response
from tools.response_size import (
    MAX_RESPONSE_BYTES,
    exceeds_budget,
    inline_or_spill,
    response_byte_size,
    sha256_hex,
    spill_result_to_s3,
)


class _FakeS3:
    """In-memory S3 stand-in that records the exact bytes written and hands
    back a deterministic presigned URL keyed to the stored object.

    ``store`` maps S3 key -> raw bytes (the EXACT body), so a test can fetch the
    bytes behind a returned ``result_url`` and verify them against the envelope's
    ``result_sha256``/``result_size``.
    """

    def __init__(self):
        self.store: dict[str, bytes] = {}
        self._url_to_key: dict[str, str] = {}

    def put_object(self, *, Bucket, Key, Body, ContentType=None):  # noqa: N803
        # boto3 accepts str or bytes; normalise to bytes like the real service.
        self.store[Key] = Body if isinstance(Body, bytes) else Body.encode("utf-8")
        return {}

    def generate_presigned_url(self, _op, *, Params, ExpiresIn):  # noqa: N803
        key = Params["Key"]
        url = f"https://s3.example.com/{Params['Bucket']}/{key}"
        self._url_to_key[url] = key
        return url

    def bytes_behind(self, url: str) -> bytes:
        """Return the exact stored bytes a presigned URL points at."""
        return self.store[self._url_to_key[url]]

    def json_behind(self, url: str):
        """Round-trip the JSON stored behind a presigned URL."""
        return json.loads(self.bytes_behind(url).decode("utf-8"))


def _assert_lossless_spill(test, *, envelope, fake_s3, original):
    """Assert ``envelope`` is the contract oversized envelope AND that the bytes
    it points at are the FULL ``original`` result with a matching sha256.
    """
    # Exact envelope shape from the wire contract.
    test.assertEqual(envelope["status"], "success")
    test.assertIs(envelope["oversized"], True)
    test.assertIn("result_url", envelope)
    test.assertIn("result_sha256", envelope)
    test.assertIn("result_size", envelope)
    test.assertIn("note", envelope)
    test.assertEqual(
        set(envelope.keys()),
        {"status", "oversized", "result_url", "result_sha256", "result_size", "note"},
    )

    # The envelope itself is tiny — it must comfortably fit the inline budget.
    test.assertFalse(exceeds_budget(envelope))

    # The presigned URL points at the FULL result, byte-for-byte.
    stored_bytes = fake_s3.bytes_behind(envelope["result_url"])
    test.assertEqual(envelope["result_size"], len(stored_bytes))
    test.assertEqual(
        envelope["result_sha256"],
        hashlib.sha256(stored_bytes).hexdigest(),
        "result_sha256 must be over the EXACT bytes stored in S3",
    )

    # LOSSLESS: round-tripping the stored JSON reproduces the original exactly.
    test.assertEqual(
        fake_s3.json_behind(envelope["result_url"]),
        original,
        "spilled result must equal the full original — nothing dropped",
    )


class TestSpillPrimitive(unittest.TestCase):
    def test_spill_result_to_s3_is_lossless_and_hashes_stored_bytes(self):
        fake = _FakeS3()
        original = {
            "raw_content": ["A" * (4 * 1024 * 1024), "B" * (4 * 1024 * 1024)],
            "references": ["a", "b"],
            "nested": {"deep": [1, 2, 3], "unicode": "café — ☕"},
        }
        envelope = spill_result_to_s3(
            original,
            s3_client=fake,
            bucket="data-bucket",
            note="hint",
        )
        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=original)
        self.assertEqual(envelope["note"], "hint")

    def test_inline_or_spill_returns_small_result_inline(self):
        fake = _FakeS3()
        original = {"raw_content": ["short"], "references": ["a"]}
        result = inline_or_spill(
            original, s3_client=fake, bucket="data-bucket", note="hint"
        )
        # Returned unchanged, nothing written to S3.
        self.assertIs(result, original)
        self.assertEqual(fake.store, {})

    def test_sha256_hex_matches_hashlib(self):
        data = b"the exact bytes"
        self.assertEqual(sha256_hex(data), hashlib.sha256(data).hexdigest())


class TestListKbFilesSpill(unittest.TestCase):
    @patch("tools.list_kb_files.prm_client")
    def test_oversized_listing_spills_losslessly(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake

        # Many files with long names -> well over the 5 MiB budget.
        big_files = [
            {
                "name": f"file_{i:05d}_" + "x" * 1000 + ".pdf",
                "size": 1234,
                "size_formatted": "1.2 KB",
            }
            for i in range(6000)
        ]
        original = {
            "listings": {
                "company": {
                    "files": big_files,
                    "folders": ["HR", "Engineering"],
                    "total_count": 6002,
                    "truncated": False,
                }
            },
            "kb_count": 1,
            "errors": [],
        }
        self.assertTrue(exceeds_budget(original), "fixture should start over budget")

        # Snapshot a deep copy because the handler must not mutate the original.
        expected = json.loads(json.dumps(original))

        envelope = _spill_listings_response(original)

        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=expected)
        # Every one of the 6000 files survived in S3 — no item-dropping.
        spilled = fake.json_behind(envelope["result_url"])
        self.assertEqual(len(spilled["listings"]["company"]["files"]), 6000)
        self.assertNotIn("truncation_note", spilled["listings"]["company"])

    @patch("tools.list_kb_files.prm_client")
    def test_small_listing_returned_inline(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake
        original = {
            "listings": {
                "company": {
                    "files": [{"name": "a.pdf", "size": 1, "size_formatted": "1 B"}],
                    "folders": ["HR"],
                    "total_count": 2,
                    "truncated": False,
                }
            },
            "kb_count": 1,
            "errors": [],
        }
        result = _spill_listings_response(original)
        self.assertIs(result, original)
        self.assertNotIn("oversized", result)
        self.assertEqual(fake.store, {})


class TestQueryKnowledgebaseSpill(unittest.TestCase):
    @patch("tools.knowledge_base.prm_client")
    def test_oversized_raw_content_spills_losslessly(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake

        # 12 chunks * ~1 MiB each = ~12 MiB of raw_content.
        chunks = [f"Source: doc{i}\n" + ("z" * (1024 * 1024)) for i in range(12)]
        original = {
            "raw_content": chunks,
            "references": [f"doc{i}" for i in range(12)],
            "provider": "bedrock",
            "query": "find everything",
            "results_count": 12,
        }
        self.assertTrue(exceeds_budget(original))
        expected = json.loads(json.dumps(original))

        envelope = _spill_query_response(original)

        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=expected)
        # All 12 chunks present in the spilled result — none dropped/trimmed.
        spilled = fake.json_behind(envelope["result_url"])
        self.assertEqual(len(spilled["raw_content"]), 12)
        self.assertEqual(spilled["raw_content"], chunks)
        self.assertNotIn("truncated", spilled)

    @patch("tools.knowledge_base.prm_client")
    def test_single_giant_chunk_spills_intact(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake
        giant = "Source: huge\n" + ("q" * (8 * 1024 * 1024))
        original = {
            "raw_content": [giant],
            "references": ["huge"],
            "provider": "bedrock",
            "query": "q",
            "results_count": 1,
        }
        self.assertTrue(exceeds_budget(original))
        expected = json.loads(json.dumps(original))

        envelope = _spill_query_response(original)

        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=expected)
        # The whole 8 MiB chunk is preserved verbatim — not hard-truncated.
        spilled = fake.json_behind(envelope["result_url"])
        self.assertEqual(spilled["raw_content"][0], giant)

    @patch("tools.knowledge_base.prm_client")
    def test_oversized_summary_spills_intact(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake
        summary = "y" * (8 * 1024 * 1024)
        original = {
            "summarised_content": summary,
            "references": ["a", "b"],
            "provider": "bedrock",
            "query": "q",
            "results_count": 2,
        }
        self.assertTrue(exceeds_budget(original))
        expected = json.loads(json.dumps(original))

        envelope = _spill_query_response(original)

        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=expected)
        spilled = fake.json_behind(envelope["result_url"])
        self.assertEqual(spilled["summarised_content"], summary)
        self.assertNotIn("truncated", spilled)

    @patch("tools.knowledge_base.prm_client")
    def test_small_query_response_inline(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake
        original = {
            "raw_content": ["Source: a\nshort content"],
            "references": ["a"],
            "provider": "bedrock",
            "query": "q",
            "results_count": 1,
        }
        result = _spill_query_response(original)
        self.assertIs(result, original)
        self.assertNotIn("oversized", result)
        self.assertEqual(fake.store, {})

    @patch("tools.knowledge_base.prm_client")
    def test_oversized_file_listing_spills_losslessly(self, mock_prm):
        """List-mode structured results spill the same lossless way."""
        fake = _FakeS3()
        mock_prm.return_value = fake
        files = [
            {
                "name": f"f_{i}.txt",
                "key": f"documents/company/f_{i}.txt",
                "size": 100,
                "last_modified": "2026-01-01T00:00:00",
                "s3_uri": f"s3://b/documents/company/{'p' * 500}_{i}.txt",
            }
            for i in range(12000)
        ]
        original = {
            "files": files,
            "kb_id": "company",
            "folder": "",
            "count": len(files),
            "pattern": None,
            "recursive": True,
        }
        self.assertTrue(exceeds_budget(original))
        expected = json.loads(json.dumps(original))

        envelope = _spill_structured_result(original, note="listing too big")

        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=expected)
        spilled = fake.json_behind(envelope["result_url"])
        self.assertEqual(len(spilled["files"]), 12000)


class TestExtractContentSpill(unittest.TestCase):
    @patch("tools.extract_content.prm_client")
    def test_oversized_inline_text_spills_losslessly(self, mock_prm):
        fake = _FakeS3()
        mock_prm.return_value = fake
        original_len = 8 * 1024 * 1024
        text = "a" * original_len
        original = {
            "message": "Content extracted",
            "output_path": "/workdir/tmp/extracted_x.txt",
            "s3_key": "k",
            "original_file": "/workdir/uploads/x.pdf",
            "text": text,
        }
        self.assertTrue(exceeds_budget(original))
        expected = json.loads(json.dumps(original))

        envelope = _spill_extract_response(original)

        _assert_lossless_spill(self, envelope=envelope, fake_s3=fake, original=expected)
        # Full text preserved — no "[... truncated ...]" marker, no char loss.
        spilled = fake.json_behind(envelope["result_url"])
        self.assertEqual(len(spilled["text"]), original_len)
        self.assertNotIn("truncated", spilled["text"])

    @patch("tools.extract_content.prm_client")
    def test_metadata_only_response_inline(self, mock_prm):
        # The real handler's normal return: small metadata, text lives in S3.
        fake = _FakeS3()
        mock_prm.return_value = fake
        original = {
            "message": "Content extracted successfully to /workdir/tmp/extracted_x.txt",
            "output_path": "/workdir/tmp/extracted_x.txt",
            "s3_key": "numa-chat/workspace/u/conversations/c/tmp/extracted_x.txt",
            "original_file": "/workdir/uploads/x.pdf",
            "text_length": 9_000_000,
        }
        result = _spill_extract_response(original)
        self.assertIs(result, original)
        self.assertNotIn("oversized", result)
        self.assertEqual(fake.store, {})


class TestSizeAccounting(unittest.TestCase):
    def test_response_byte_size_matches_utf8_json(self):
        obj = {"k": "café ☕", "n": 12345}
        self.assertEqual(
            response_byte_size(obj),
            len(json.dumps(obj, default=str).encode("utf-8")),
        )

    def test_budget_boundary(self):
        # Just under and just over MAX_RESPONSE_BYTES.
        small = {"x": "a" * (MAX_RESPONSE_BYTES // 2)}
        self.assertFalse(exceeds_budget(small))
        big = {"x": "a" * (MAX_RESPONSE_BYTES + 10)}
        self.assertTrue(exceeds_budget(big))


if __name__ == "__main__":
    unittest.main()
