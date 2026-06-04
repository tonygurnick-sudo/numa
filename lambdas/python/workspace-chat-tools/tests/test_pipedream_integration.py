"""Tests for _preprocess_file_paths and _resolve_workdir_path."""

import unittest
from unittest.mock import MagicMock, patch

from tools.pipedream_integration import _preprocess_file_paths


class TestPreprocessFilePaths(unittest.TestCase):
    """Test workspace path → presigned URL conversion for integration props."""

    def setUp(self):
        # Ensure tests don't depend on import ordering across test modules.
        self.module_patcher = patch.multiple(
            "tools.pipedream_integration",
            OUTPUTS_BUCKET_NAME="test-bucket",
            FILE_REDIRECT_SECRET="",
            FILE_REDIRECT_BASE_URL="",
        )
        self.module_patcher.start()

    def tearDown(self):
        self.module_patcher.stop()

    def _make_s3_client(self, existing_keys=None):
        """Create a mock S3 client that recognises specific keys."""
        existing_keys = existing_keys or set()
        client = MagicMock()

        def head_object(Bucket, Key):  # pylint: disable=unused-argument
            if Key not in existing_keys:
                raise FileNotFoundError(f"Not found: {Key}")

        client.head_object.side_effect = head_object
        client.generate_presigned_url.return_value = (
            "https://presigned.example.com/file"
        )
        return client

    @patch("tools.pipedream_integration.prm_client")
    def test_string_prop_converted(self, mock_prm):
        """Single string /workdir/ prop gets converted."""
        s3 = self._make_s3_client(
            {"numa-chat/workspace/user1/conversations/conv1/outputs/file.txt"}
        )
        mock_prm.return_value = s3

        result = _preprocess_file_paths(
            {"filePath": "/workdir/outputs/file.txt"},
            user_sub="user1",
            conversation_id="conv1",
        )

        self.assertEqual(result["filePath"], "https://presigned.example.com/file")

    @patch("tools.pipedream_integration.prm_client")
    def test_list_prop_converted(self, mock_prm):
        """String array with /workdir/ paths gets each element converted."""
        s3 = self._make_s3_client(
            {
                "numa-chat/workspace/user1/conversations/conv1/outputs/a.pdf",
                "numa-chat/workspace/user1/conversations/conv1/outputs/b.pdf",
            }
        )
        mock_prm.return_value = s3

        result = _preprocess_file_paths(
            {
                "attachmentUrlsOrPaths": [
                    "/workdir/outputs/a.pdf",
                    "/workdir/outputs/b.pdf",
                ]
            },
            user_sub="user1",
            conversation_id="conv1",
        )

        self.assertEqual(len(result["attachmentUrlsOrPaths"]), 2)
        for url in result["attachmentUrlsOrPaths"]:
            self.assertEqual(url, "https://presigned.example.com/file")

    @patch("tools.pipedream_integration.prm_client")
    def test_mixed_list_only_workdir_converted(self, mock_prm):
        """In a mixed list, only /workdir/ strings are converted; URLs stay."""
        s3 = self._make_s3_client(
            {"numa-chat/workspace/user1/conversations/conv1/outputs/local.pdf"}
        )
        mock_prm.return_value = s3

        result = _preprocess_file_paths(
            {
                "attachmentUrlsOrPaths": [
                    "https://example.com/remote.pdf",
                    "/workdir/outputs/local.pdf",
                ]
            },
            user_sub="user1",
            conversation_id="conv1",
        )

        self.assertEqual(
            result["attachmentUrlsOrPaths"][0], "https://example.com/remote.pdf"
        )
        self.assertEqual(
            result["attachmentUrlsOrPaths"][1], "https://presigned.example.com/file"
        )

    @patch("tools.pipedream_integration.prm_client")
    def test_non_workdir_props_unchanged(self, mock_prm):
        """Props without /workdir/ paths are left alone."""
        mock_prm.return_value = self._make_s3_client()

        props = {"to": "user@example.com", "subject": "Hello", "body": "Hi there"}
        result = _preprocess_file_paths(
            props, user_sub="user1", conversation_id="conv1"
        )

        self.assertEqual(result, props)

    def test_empty_props_returns_empty(self):
        result = _preprocess_file_paths({}, user_sub="user1", conversation_id="conv1")
        self.assertEqual(result, {})

    def test_missing_user_sub_returns_unchanged(self):
        props = {"filePath": "/workdir/outputs/file.txt"}
        result = _preprocess_file_paths(props, user_sub="", conversation_id="conv1")
        self.assertEqual(result, props)

    @patch("tools.pipedream_integration.prm_client")
    def test_path_traversal_fails_closed(self, mock_prm):
        """A /workdir path with .. fails closed (raises) rather than being
        forwarded verbatim — a raw path must never reach the upstream."""
        mock_prm.return_value = self._make_s3_client()

        with self.assertRaises(ValueError):
            _preprocess_file_paths(
                {"filePath": "/workdir/../etc/passwd"},
                user_sub="user1",
                conversation_id="conv1",
            )

    @patch("tools.pipedream_integration.prm_client")
    def test_path_traversal_in_list_fails_closed(self, mock_prm):
        """Path traversal in an array element fails closed (raises)."""
        s3 = self._make_s3_client(
            {"numa-chat/workspace/user1/conversations/conv1/outputs/good.txt"}
        )
        mock_prm.return_value = s3

        with self.assertRaises(ValueError):
            _preprocess_file_paths(
                {
                    "files": [
                        "/workdir/../etc/passwd",
                        "/workdir/outputs/good.txt",
                    ]
                },
                user_sub="user1",
                conversation_id="conv1",
            )

    @patch("tools.pipedream_integration.prm_client")
    def test_missing_file_fails_closed(self, mock_prm):
        """A /workdir path with no matching S3 object raises instead of being
        forwarded as a literal string — this is the corruption class that
        overwrote a customer .docx with a JSON-ish reference."""
        mock_prm.return_value = self._make_s3_client()  # no existing keys

        with self.assertRaises(ValueError):
            _preprocess_file_paths(
                {"filePath": "/workdir/outputs/missing.docx"},
                user_sub="user1",
                conversation_id="conv1",
            )
