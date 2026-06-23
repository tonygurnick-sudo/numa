"""Tests for _preprocess_file_paths and _resolve_workdir_path."""

import os
import unittest
from unittest.mock import MagicMock, patch

from tools.pipedream_integration import (
    _preprocess_file_paths,
    _record_connector_usage,
    handle_run_action,
)


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


class TestRecordConnectorUsage(unittest.TestCase):
    """FEAT-129: lastUsedAt usage stamping on successful connector actions."""

    @patch.dict(os.environ, {"CONNECTOR_USAGE_TABLE": "usage-table"}, clear=False)
    @patch("tools.pipedream_integration.prm_client")
    def test_writes_usage_row(self, mock_prm):
        """A usage row is written with the agreed PK/SK/lastUsedAt shape."""
        dynamodb = MagicMock()
        mock_prm.return_value = dynamodb

        _record_connector_usage("user-123", "gmail")

        dynamodb.put_item.assert_called_once()
        kwargs = dynamodb.put_item.call_args.kwargs
        self.assertEqual(kwargs["TableName"], "usage-table")
        item = kwargs["Item"]
        self.assertEqual(item["PK"], {"S": "USER#user-123"})
        self.assertEqual(item["SK"], {"S": "CONN#pipedream#gmail"})
        # lastUsedAt is an ISO8601 UTC string (…Z); just assert shape.
        last_used = item["lastUsedAt"]["S"]
        self.assertTrue(last_used.endswith("Z"))
        self.assertIn("T", last_used)

    @patch.dict(os.environ, {}, clear=True)
    @patch("tools.pipedream_integration.prm_client")
    def test_missing_table_env_is_silent_noop(self, mock_prm):
        """No CONNECTOR_USAGE_TABLE env → no DynamoDB client, no write, no raise."""
        _record_connector_usage("user-123", "gmail")
        mock_prm.assert_not_called()

    @patch.dict(os.environ, {"CONNECTOR_USAGE_TABLE": "usage-table"}, clear=False)
    @patch("tools.pipedream_integration.prm_client")
    def test_write_failure_is_swallowed(self, mock_prm):
        """A DynamoDB error must never propagate — usage is best-effort."""
        dynamodb = MagicMock()
        dynamodb.put_item.side_effect = RuntimeError("throttled")
        mock_prm.return_value = dynamodb

        # Must not raise.
        _record_connector_usage("user-123", "gmail")

    @patch.dict(os.environ, {"CONNECTOR_USAGE_TABLE": "usage-table"}, clear=False)
    @patch("tools.pipedream_integration.prm_client")
    def test_empty_connector_is_noop(self, mock_prm):
        """Missing connector slug → no write."""
        _record_connector_usage("user-123", "")
        mock_prm.assert_not_called()


class TestRunActionRecordsUsage(unittest.TestCase):
    """handle_run_action stamps usage only on real success (auto-approved path)."""

    def _run(self, relay_result):
        """Drive handle_run_action through the auto-approved success path with
        the relay and idempotency guard stubbed out, returning the captured
        _record_connector_usage call args (or None)."""
        with patch(
            "tools.pipedream_integration._invoke_relay",
            return_value=relay_result,
        ), patch(
            "tools.pipedream_integration._execute_with_idempotency",
            side_effect=lambda _approval_id, fn: fn(),
        ), patch(
            "tools.pipedream_integration._audit_pipedream_action"
        ), patch(
            "tools.pipedream_integration._record_connector_usage"
        ) as mock_usage:
            result = handle_run_action(
                {
                    "action_key": "gmail-send-email",
                    "configured_props": {},
                    "external_user_id": "ext-1",
                    "__user_sub": "user-123",
                    "auto_approved": True,
                }
            )
        return result, mock_usage

    def test_usage_recorded_on_success(self):
        result, mock_usage = self._run({"ok": True})
        self.assertEqual(result["status"], "success")
        mock_usage.assert_called_once_with("user-123", "gmail")

    def test_usage_not_recorded_on_upstream_error(self):
        """A Pipedream 200 carrying an os[] error is action_error, not usage."""
        result, mock_usage = self._run(
            {"os": [{"k": "error", "err": {"message": "boom"}}]}
        )
        self.assertEqual(result["status"], "action_error")
        mock_usage.assert_not_called()
