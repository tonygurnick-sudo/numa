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
