"""Tests for reference-file S3 metadata refresh on agent update (BUG-197).

The generic ``referenceFiles`` update path previously trusted caller-supplied
``fileSize`` / ``extractedContentS3Key`` verbatim, so re-attaching a file with a
new s3Key kept a stale size and a dangling extracted-content key. These tests
cover the helpers that bring that path up to parity with the ``attachFiles``
path: HeadObject for true size, and resolve-or-null the extracted-content key.

S3 is mocked via unittest.mock — no real AWS clients are exercised.
"""

import unittest
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from tools.agents import (
    _refresh_changed_reference_files,
    _validate_reference_file_metadata,
)

BUCKET = "test-outputs"


def _not_found_error() -> ClientError:
    return ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")


class TestValidateReferenceFileMetadata(unittest.TestCase):
    def test_refreshes_size_and_keeps_existing_extracted_key(self):
        s3 = MagicMock()
        # First HeadObject = main file (size), second = extracted content (exists).
        s3.head_object.side_effect = [{"ContentLength": 4096}, {"ContentLength": 10}]

        ref = {
            "fileName": "doc.pdf",
            "fileSize": 1,  # stale
            "s3Key": "numa-chat/agents/u/new_doc.pdf",
            "s3Bucket": BUCKET,
            "extractedContentS3Key": "numa-chat/agents/u/new_extracted_doc.txt",
        }

        with (
            patch("tools.agents.OUTPUTS_BUCKET_NAME", BUCKET),
            patch("tools.agents._get_s3_client", return_value=s3),
        ):
            out = _validate_reference_file_metadata(ref)

        self.assertEqual(out["fileSize"], 4096)
        self.assertEqual(
            out["extractedContentS3Key"], "numa-chat/agents/u/new_extracted_doc.txt"
        )
        # Input must not be mutated.
        self.assertEqual(ref["fileSize"], 1)

    def test_nulls_extracted_key_when_object_missing(self):
        s3 = MagicMock()
        # Main file HeadObject succeeds, extracted-content HeadObject 404s.
        s3.head_object.side_effect = [{"ContentLength": 2048}, _not_found_error()]

        ref = {
            "fileName": "doc.pdf",
            "fileSize": 99,
            "s3Key": "numa-chat/agents/u/new_doc.pdf",
            "s3Bucket": BUCKET,
            "extractedContentS3Key": "numa-chat/agents/u/stale_extracted.txt",
        }

        with (
            patch("tools.agents.OUTPUTS_BUCKET_NAME", BUCKET),
            patch("tools.agents._get_s3_client", return_value=s3),
        ):
            out = _validate_reference_file_metadata(ref)

        self.assertEqual(out["fileSize"], 2048)
        self.assertIsNone(out["extractedContentS3Key"])

    def test_main_head_failure_preserves_existing_size(self):
        s3 = MagicMock()
        # Main file HeadObject fails -> keep caller size; no extracted key set.
        s3.head_object.side_effect = [_not_found_error()]

        ref = {
            "fileName": "doc.pdf",
            "fileSize": 1234,
            "s3Key": "numa-chat/agents/u/new_doc.pdf",
            "s3Bucket": BUCKET,
            "extractedContentS3Key": None,
        }

        with (
            patch("tools.agents.OUTPUTS_BUCKET_NAME", BUCKET),
            patch("tools.agents._get_s3_client", return_value=s3),
        ):
            out = _validate_reference_file_metadata(ref)

        self.assertEqual(out["fileSize"], 1234)
        self.assertIsNone(out["extractedContentS3Key"])


class TestRefreshChangedReferenceFiles(unittest.TestCase):
    def test_unchanged_key_passes_through_without_s3_call(self):
        s3 = MagicMock()
        existing = [{"s3Key": "numa-chat/agents/u/old.pdf", "fileSize": 500}]
        incoming = [
            {
                "fileName": "old.pdf",
                "fileSize": 500,
                "s3Key": "numa-chat/agents/u/old.pdf",
                "s3Bucket": BUCKET,
            }
        ]

        with (
            patch("tools.agents.OUTPUTS_BUCKET_NAME", BUCKET),
            patch("tools.agents._get_s3_client", return_value=s3),
        ):
            out = _refresh_changed_reference_files(incoming, existing)

        # s3Key unchanged -> no HeadObject, size preserved.
        s3.head_object.assert_not_called()
        self.assertEqual(out[0]["fileSize"], 500)

    def test_changed_key_is_validated_against_s3(self):
        s3 = MagicMock()
        # New file: main HeadObject (size), then extracted-content 404 -> null.
        s3.head_object.side_effect = [{"ContentLength": 8192}, _not_found_error()]

        existing = [{"s3Key": "numa-chat/agents/u/old.pdf"}]
        incoming = [
            {
                "fileName": "doc.pdf",
                "fileSize": 1,  # stale, must be refreshed
                "s3Key": "numa-chat/agents/u/new.pdf",  # changed key
                "s3Bucket": BUCKET,
                "extractedContentS3Key": "numa-chat/agents/u/old_extracted.txt",
            }
        ]

        with (
            patch("tools.agents.OUTPUTS_BUCKET_NAME", BUCKET),
            patch("tools.agents._get_s3_client", return_value=s3),
        ):
            out = _refresh_changed_reference_files(incoming, existing)

        self.assertEqual(out[0]["fileSize"], 8192)
        self.assertIsNone(out[0]["extractedContentS3Key"])

    def test_empty_input_returns_empty(self):
        self.assertEqual(_refresh_changed_reference_files(None, None), [])
        self.assertEqual(_refresh_changed_reference_files([], []), [])


if __name__ == "__main__":
    unittest.main()
