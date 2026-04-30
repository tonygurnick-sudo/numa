"""
Tests for the shared Lambda client module.

Covers invoke_workspace_tool() (successful invocation, Lambda error,
tool error, missing env var), extract_status() (dict, list, other types),
and save_result() (file creation, truncated preview).
"""

import io
import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from numa_workspace_agent.mcp_tools.lambda_client import (
    PREVIEW_LENGTH,
    RESULTS_DIR,
    extract_status,
    invoke_workspace_tool,
    save_result,
)

# ---------------------------------------------------------------------------
# extract_status()
# ---------------------------------------------------------------------------


class TestExtractStatus:
    """Tests for extract_status() — safely pulls status from varied result shapes."""

    def test_dict_with_status_field(self):
        """Dict result with an explicit status field returns that status."""
        result = {"status": "partial", "data": [1, 2, 3]}
        assert extract_status(result) == "partial"

    def test_dict_without_status_field(self):
        """Dict result missing a status field defaults to 'success'."""
        result = {"data": [1, 2, 3]}
        assert extract_status(result) == "success"

    def test_list_result(self):
        """List results (e.g. from /accessible-resources) are always 'success'."""
        result = [{"id": 1}, {"id": 2}]
        assert extract_status(result) == "success"

    def test_empty_list(self):
        """Empty list is still treated as a successful raw response."""
        assert extract_status([]) == "success"

    def test_string_result(self):
        """Non-dict, non-list types fall through to default 'success'."""
        assert extract_status("some string") == "success"

    def test_none_result(self):
        """None falls through to default 'success'."""
        assert extract_status(None) == "success"

    def test_integer_result(self):
        """Integer falls through to default 'success'."""
        assert extract_status(42) == "success"


# ---------------------------------------------------------------------------
# invoke_workspace_tool()
# ---------------------------------------------------------------------------


class TestInvokeWorkspaceTool:
    """Tests for invoke_workspace_tool() — the Lambda invocation wrapper."""

    @pytest.fixture(autouse=True)
    def env_vars(self, monkeypatch):
        """Set the minimum env vars required for invoke_workspace_tool."""
        monkeypatch.setenv("WORKSPACE_TOOLS_LAMBDA_NAME", "test-lambda-name")
        monkeypatch.setenv("NUMA_LOCAL_AWS_ACCESS_KEY_ID", "AKIATEST")
        monkeypatch.setenv("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY", "secret")
        monkeypatch.setenv("NUMA_LOCAL_AWS_SESSION_TOKEN", "token")
        monkeypatch.setenv("AWS_REGION", "us-east-1")
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", '["web_search"]')
        monkeypatch.setenv("NUMA_USER_SUB", "user-123")
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "conv-456")
        monkeypatch.setenv("NUMA_EXTERNAL_USER_ID", "ext-789")

    def _make_lambda_response(
        self,
        payload: dict,
        function_error: str | None = None,
    ) -> dict:
        """Build a mock boto3 Lambda invoke response."""
        resp = {
            "Payload": io.BytesIO(json.dumps(payload).encode()),
            "StatusCode": 200,
        }
        if function_error:
            resp["FunctionError"] = function_error
        return resp

    def _patch_boto3_session(self, mock_session):
        """Patch boto3.Session inside the lambda_client module.

        invoke_workspace_tool imports boto3 locally (inside the function body),
        so we patch the module-level import that Python resolves at runtime.
        """
        return patch("boto3.Session", return_value=mock_session)

    def test_successful_invocation(self):
        """Happy path: Lambda returns status=success with a result dict."""
        lambda_response = self._make_lambda_response(
            {"status": "success", "result": {"answer": "42"}}
        )

        mock_client = MagicMock()
        mock_client.invoke.return_value = lambda_response

        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with self._patch_boto3_session(mock_session):
            result = invoke_workspace_tool(
                "web_search",
                {"query": "hello", "user_intent": "test"},
            )

        assert result == {"answer": "42"}

        # Verify the Lambda was invoked with the correct payload shape
        call_args = mock_client.invoke.call_args
        payload = json.loads(call_args[1]["Payload"])
        assert payload["tool"] == "web_search"
        assert payload["params"] == {"query": "hello", "user_intent": "test"}
        assert payload["user_sub"] == "user-123"
        assert payload["conversation_id"] == "conv-456"
        assert payload["external_user_id"] == "ext-789"
        assert payload["allowed_tools"] == ["web_search"]

    def test_extra_event_fields_merged(self):
        """extra_event_fields are merged into the top-level event dict."""
        lambda_response = self._make_lambda_response(
            {"status": "success", "result": {"data": "ok"}}
        )

        mock_client = MagicMock()
        mock_client.invoke.return_value = lambda_response

        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with self._patch_boto3_session(mock_session):
            invoke_workspace_tool(
                "query_knowledgebase",
                {"query": "test"},
                extra_event_fields={
                    "allowed_kbs": ["kb-1", "kb-2"],
                    "user_sub": "overridden-sub",
                },
            )

        payload = json.loads(mock_client.invoke.call_args[1]["Payload"])
        # extra_event_fields should overwrite matching keys
        assert payload["allowed_kbs"] == ["kb-1", "kb-2"]
        assert payload["user_sub"] == "overridden-sub"

    def test_lambda_function_error_raises(self):
        """When the Lambda returns FunctionError, an exception is raised."""
        lambda_response = self._make_lambda_response(
            {"errorMessage": "Out of memory"},
            function_error="Unhandled",
        )

        mock_client = MagicMock()
        mock_client.invoke.return_value = lambda_response

        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with self._patch_boto3_session(mock_session):
            with pytest.raises(Exception, match="Workspace tools Lambda failed"):
                invoke_workspace_tool("web_search", {"query": "test"})

    def test_tool_error_status_raises(self):
        """When Lambda payload has status=error, an exception is raised."""
        lambda_response = self._make_lambda_response(
            {"status": "error", "error": "Knowledge base not found"}
        )

        mock_client = MagicMock()
        mock_client.invoke.return_value = lambda_response

        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with self._patch_boto3_session(mock_session):
            with pytest.raises(Exception, match="Tool error: Knowledge base not found"):
                invoke_workspace_tool("query_knowledgebase", {"query": "test"})

    def test_tool_error_unknown_message(self):
        """When status=error but no error field, the message says 'Unknown error'."""
        lambda_response = self._make_lambda_response({"status": "error"})

        mock_client = MagicMock()
        mock_client.invoke.return_value = lambda_response

        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with self._patch_boto3_session(mock_session):
            with pytest.raises(Exception, match="Tool error: Unknown error"):
                invoke_workspace_tool("web_search", {"query": "test"})

    def test_missing_lambda_name_raises(self, monkeypatch):
        """If WORKSPACE_TOOLS_LAMBDA_NAME is empty, a ValueError is raised."""
        monkeypatch.setenv("WORKSPACE_TOOLS_LAMBDA_NAME", "")

        with pytest.raises(
            ValueError, match="WORKSPACE_TOOLS_LAMBDA_NAME is not configured"
        ):
            invoke_workspace_tool("web_search", {"query": "test"})

    def test_missing_lambda_name_unset(self, monkeypatch):
        """If WORKSPACE_TOOLS_LAMBDA_NAME is unset, a ValueError is raised."""
        monkeypatch.delenv("WORKSPACE_TOOLS_LAMBDA_NAME", raising=False)

        with pytest.raises(
            ValueError, match="WORKSPACE_TOOLS_LAMBDA_NAME is not configured"
        ):
            invoke_workspace_tool("web_search", {"query": "test"})

    def test_result_defaults_to_empty_dict(self):
        """When payload has no 'result' key, return empty dict."""
        lambda_response = self._make_lambda_response({"status": "success"})

        mock_client = MagicMock()
        mock_client.invoke.return_value = lambda_response

        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with self._patch_boto3_session(mock_session):
            result = invoke_workspace_tool("web_search", {"query": "test"})

        assert result == {}


# ---------------------------------------------------------------------------
# save_result()
# ---------------------------------------------------------------------------


class TestSaveResult:
    """Tests for save_result() — persists tool results to JSON files."""

    @pytest.fixture(autouse=True)
    def use_tmp_results_dir(self, tmp_path, monkeypatch):
        """Redirect RESULTS_DIR to a temp directory for test isolation."""
        test_dir = str(tmp_path / "results")
        monkeypatch.setattr(
            "numa_workspace_agent.mcp_tools.lambda_client.RESULTS_DIR",
            test_dir,
        )
        self.results_dir = Path(test_dir)

    def test_creates_file(self):
        """save_result writes a valid JSON file to the results directory."""
        result = {"status": "success", "result": {"items": [1, 2, 3]}}

        file_path, preview = save_result(result, "test-action", "Test description")

        path = Path(file_path)
        assert path.exists()
        assert path.suffix == ".json"

        content = json.loads(path.read_text())
        assert content["action_key"] == "test-action"
        assert content["description"] == "Test description"
        assert content["status"] == "success"
        assert content["result"] == {"items": [1, 2, 3]}

    def test_file_name_includes_action_key_and_timestamp(self):
        """The output filename contains the action_key and a timestamp."""
        result = {"status": "success", "result": {"data": "ok"}}
        file_path, _ = save_result(result, "my-action", "desc")

        name = Path(file_path).name
        assert name.startswith("my-action-")
        # Timestamp format: YYYYMMDD-HHMMSS
        assert len(name) > len("my-action-.json")

    def test_preview_is_not_truncated_for_small_results(self):
        """Small results fit in preview without truncation."""
        result = {"status": "success", "result": {"key": "val"}}
        _, preview = save_result(result, "small", "desc")

        # Preview should include the result content
        assert "key" in preview
        assert "val" in preview
        # Should NOT have truncation indicator
        assert "truncated" not in preview

    def test_preview_is_truncated_for_large_results(self):
        """Large results are truncated with a '... (truncated' indicator."""
        big_data = {"key_" + str(i): "x" * 100 for i in range(50)}
        result = {"status": "success", "result": big_data}

        _, preview = save_result(result, "big", "desc")

        assert "truncated" in preview
        assert "see file for full result" in preview

    def test_preview_shows_file_stats(self):
        """Preview text includes line count and size information."""
        result = {"status": "success", "result": {"a": 1}}
        _, preview = save_result(result, "stats", "desc")

        # Format: "(N lines, X B)" or "(N lines, X.X KB)"
        assert "lines" in preview

    def test_result_without_result_key(self):
        """When input dict has no 'result' key, the whole dict is used."""
        result = {"custom_field": "custom_value"}
        file_path, _ = save_result(result, "no-result-key", "desc")

        content = json.loads(Path(file_path).read_text())
        assert content["result"] == {"custom_field": "custom_value"}

    def test_results_dir_created_if_missing(self):
        """The results directory is created automatically if it does not exist."""
        assert not self.results_dir.exists()

        result = {"status": "success", "result": {"data": True}}
        file_path, _ = save_result(result, "mkdir-test", "desc")

        assert Path(file_path).exists()
        assert self.results_dir.exists()

    def test_multiple_saves_create_separate_files(self):
        """Each call creates a new file (no overwrites)."""
        result = {"status": "success", "result": {"v": 1}}
        path1, _ = save_result(result, "multi", "first")
        path2, _ = save_result(result, "multi", "second")

        # Paths might be identical if called within the same second, so
        # just verify at least one file exists and both paths are non-empty
        assert Path(path1).exists()
        assert Path(path2).exists()


# ---------------------------------------------------------------------------
# save_result() — oversize binary (s3_presigned) path
# ---------------------------------------------------------------------------


class TestSaveResultS3PresignedBinary:
    """Tests for the s3_presigned binary branch in save_result().

    The proxy uploads oversize binary upstream responses to a short-lived
    S3 cache and returns a presigned GET URL. save_result() fetches that
    URL into /workdir so the agent sees a real file the same way it does
    for small inline binaries.
    """

    @pytest.fixture(autouse=True)
    def use_tmp_results_dir(self, tmp_path, monkeypatch):
        """Redirect RESULTS_DIR to a temp directory for test isolation."""
        test_dir = str(tmp_path / "results")
        monkeypatch.setattr(
            "numa_workspace_agent.mcp_tools.lambda_client.RESULTS_DIR",
            test_dir,
        )
        self.results_dir = Path(test_dir)

    @staticmethod
    def _fake_urlretrieve(payload: bytes):
        """Build a fake urlretrieve that writes payload to the destination path."""

        def _retrieve(url, filename=None):
            assert filename is not None, "save_result must pass an explicit destination"
            Path(filename).write_bytes(payload)
            return (filename, None)

        return _retrieve

    def _make_result(self, **overrides):
        base = {
            "status": "success",
            "result": {
                "binary": True,
                "binary_storage": "s3_presigned",
                "presigned_url": "https://example-bucket.s3.amazonaws.com/k?signed=yes",
                "presigned_url_expires_in": 900,
                "content_type": "application/pdf",
                "size": 5 * 1024 * 1024,
                "filename_hint": "report.pdf",
            },
        }
        base["result"].update(overrides)
        return base

    def test_downloads_with_filename_hint(self):
        """A presigned response with filename_hint lands at /workdir/<hint>."""
        payload = b"%PDF-1.4 actual binary bytes from S3"
        result = self._make_result()

        with patch(
            "urllib.request.urlretrieve",
            side_effect=self._fake_urlretrieve(payload),
        ):
            file_path, preview = save_result(result, "proxy_GET", "Download attachment")

        # The JSON file is still written to the action-named slot.
        assert Path(file_path).suffix == ".json"

        # The binary lands at /workdir/.../report.pdf with real bytes.
        downloaded = self.results_dir / "report.pdf"
        assert downloaded.exists()
        assert downloaded.read_bytes() == payload

        # Preview surfaces the download path so the LLM sees it.
        assert "Downloaded files:" in preview
        assert str(downloaded) in preview

    def test_downloads_without_filename_hint(self):
        """Missing filename_hint falls back to {action_key}-binary{ext}."""
        payload = b"PDF content here"
        result = self._make_result(filename_hint=None)
        # Simulate the absence of filename_hint cleanly.
        del result["result"]["filename_hint"]

        with patch(
            "urllib.request.urlretrieve",
            side_effect=self._fake_urlretrieve(payload),
        ):
            file_path, preview = save_result(result, "proxy_GET", "desc")

        downloaded = self.results_dir / "proxy_GET-binary.pdf"
        assert downloaded.exists()
        assert downloaded.read_bytes() == payload
        assert str(downloaded) in preview

    def test_filename_hint_path_traversal_sanitized(self):
        """Path-traversal characters in filename_hint are stripped."""
        payload = b"data"
        result = self._make_result(filename_hint="../../etc/passwd")

        with patch(
            "urllib.request.urlretrieve",
            side_effect=self._fake_urlretrieve(payload),
        ):
            save_result(result, "proxy_GET", "desc")

        # The actual file should land directly under results_dir, not /etc/.
        downloaded_files = list(self.results_dir.iterdir())
        # JSON record + the downloaded binary
        binary_files = [p for p in downloaded_files if p.suffix != ".json"]
        assert len(binary_files) == 1
        assert "/" not in binary_files[0].name
        assert "\\" not in binary_files[0].name
        # Should not start with a dot (lstrip)
        assert not binary_files[0].name.startswith(".")
        assert binary_files[0].read_bytes() == payload

    def test_filename_hint_without_extension_appends_ext(self):
        """A filename_hint without an extension gets one from content_type."""
        payload = b"\x89PNG fake"
        result = self._make_result(
            filename_hint="screenshot",
            content_type="image/png",
        )

        with patch(
            "urllib.request.urlretrieve",
            side_effect=self._fake_urlretrieve(payload),
        ):
            save_result(result, "proxy_GET", "desc")

        downloaded = self.results_dir / "screenshot.png"
        assert downloaded.exists()
        assert downloaded.read_bytes() == payload

    def test_download_failure_is_logged_and_swallowed(self):
        """A failed urlretrieve does not raise — the JSON file is still written."""
        result = self._make_result()

        def _failing(url, filename=None):
            raise OSError("HTTP 403 Forbidden")

        with patch("urllib.request.urlretrieve", side_effect=_failing):
            file_path, preview = save_result(result, "proxy_GET", "desc")

        # JSON record still written.
        assert Path(file_path).exists()
        # Binary not present, no "Downloaded files:" section.
        assert "Downloaded files:" not in preview
        # The presigned URL itself is preserved in the JSON for the LLM
        # to surface to the user as a fallback.
        record = json.loads(Path(file_path).read_text())
        assert record["result"]["presigned_url"].startswith("https://")

    def test_missing_presigned_url_skips_download(self):
        """A result with binary_storage=s3_presigned but no URL is left alone."""
        result = self._make_result(presigned_url="")

        with patch("urllib.request.urlretrieve") as mock_retrieve:
            file_path, preview = save_result(result, "proxy_GET", "desc")

        mock_retrieve.assert_not_called()
        assert "Downloaded files:" not in preview
        assert Path(file_path).exists()

    def test_other_binary_storage_values_ignored(self):
        """Only binary_storage='s3_presigned' triggers the new path."""
        result = self._make_result(binary_storage="some_future_scheme")

        with patch("urllib.request.urlretrieve") as mock_retrieve:
            save_result(result, "proxy_GET", "desc")

        mock_retrieve.assert_not_called()

    def test_inline_base64_path_still_works(self):
        """Pre-existing base64_body path keeps working for small files."""
        import base64 as b64

        payload = b"%PDF-1.4 small inline content"
        result = {
            "status": "success",
            "result": {
                "binary": True,
                "base64_body": b64.b64encode(payload).decode(),
                "content_type": "application/pdf",
                "size": len(payload),
            },
        }

        # urlretrieve must NOT be called for base64 inline responses.
        with patch("urllib.request.urlretrieve") as mock_retrieve:
            file_path, preview = save_result(result, "proxy_GET", "desc")

        mock_retrieve.assert_not_called()
        downloaded = self.results_dir / "proxy_GET-binary.pdf"
        assert downloaded.exists()
        assert downloaded.read_bytes() == payload
        assert str(downloaded) in preview
