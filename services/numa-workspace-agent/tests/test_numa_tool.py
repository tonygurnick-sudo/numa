"""
Tests for the unified numa_tool MCP tool.

Covers the main dispatcher (valid tool routing, unknown tool error),
the knowledge_base dispatcher (routing to sub-handlers by operation),
and each per-tool handler: query_knowledge_base (query), web_search,
extract_content, convert_document, kb_upload, kb_download, kb_list,
kb_download_folder, agents, and memories.

All handlers are async, so tests use pytest-asyncio (asyncio_mode="auto"
in pyproject.toml).
"""

import base64
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from numa_workspace_agent.mcp_tools.numa_tool import (
    _OPERATION_TO_ENABLED_TOOL_KEYS,
    PRESIGNED_URL_THRESHOLD,
    TOOL_HANDLERS,
    TOOL_NAMES,
    _atomic_download_url,
    _atomic_write_bytes,
    _check_operation_allowed,
    _err,
    _get_allowed_operations,
    _get_enabled_tools,
    _handle_agents,
    _handle_convert_document,
    _handle_extract_content,
    _handle_kb_download,
    _handle_kb_download_folder,
    _handle_kb_list,
    _handle_kb_upload,
    _handle_knowledge_base,
    _handle_memories,
    _handle_query_kb,
    _handle_render,
    _handle_web_search,
    _ok,
    numa_tool,
)

# ---------------------------------------------------------------------------
# Helper response builders
# ---------------------------------------------------------------------------


class TestResponseHelpers:
    """Tests for _ok() and _err() helper functions."""

    def test_ok_structure(self):
        result = _ok("hello")
        assert result == {"content": [{"type": "text", "text": "hello"}]}

    def test_err_structure(self):
        # Dual-write `is_error` (snake_case — claude-agent-sdk's in-process
        # MCP handler) AND `isError` (camelCase — MCP spec proper). Missing
        # `is_error` was the root cause of fleet-wide `is_error: null` on
        # tool failures.
        result = _err("bad thing happened")
        assert result == {
            "content": [{"type": "text", "text": "bad thing happened"}],
            "is_error": True,
            "isError": True,
        }

    def test_ok_does_not_have_error_flag(self):
        result = _ok("fine")
        assert "isError" not in result
        assert "is_error" not in result


# ---------------------------------------------------------------------------
# Main dispatcher: numa_tool()
# ---------------------------------------------------------------------------


class TestNumaToolDispatcher:
    """Tests for the top-level numa_tool() dispatcher function."""

    @pytest.fixture(autouse=True)
    def enable_all_tools(self, monkeypatch):
        """Enable all frontend toggles so dispatcher routing tests focus on routing."""
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(
                [
                    "query_knowledge_base",
                    "web_search",
                    "create_agent_tool",
                    "memories_tool",
                ]
            ),
        )
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)

    async def test_valid_tool_routes_to_handler(self):
        """A known tool name should invoke its handler and return the result."""
        from unittest.mock import AsyncMock

        mock_result = _ok("mock KB result")
        mock_handler = AsyncMock(return_value=mock_result)

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool.TOOL_HANDLERS",
            {"knowledge_base": mock_handler},
        ):
            result = await numa_tool.handler(
                {
                    "name": "knowledge_base",
                    "params": {
                        "operation": "query",
                        "query": "test",
                        "user_intent": "test",
                    },
                    "description": "Test query",
                }
            )

        assert result == mock_result
        mock_handler.assert_called_once_with(
            {"operation": "query", "query": "test", "user_intent": "test"}
        )

    async def test_unknown_tool_returns_error(self):
        """An unrecognised tool name should return an error response."""
        result = await numa_tool.handler(
            {
                "name": "nonexistent_tool",
                "params": {},
                "description": "This should fail",
            }
        )

        assert result["isError"] is True
        text = result["content"][0]["text"]
        assert "Unknown Numa tool" in text
        assert "nonexistent_tool" in text

    async def test_empty_name_returns_error(self):
        """An empty name field should return an error response."""
        result = await numa_tool.handler(
            {
                "name": "",
                "params": {},
                "description": "empty",
            }
        )

        assert result["isError"] is True

    async def test_missing_name_returns_error(self):
        """When 'name' key is absent, fall through to unknown tool error."""
        result = await numa_tool.handler(
            {
                "params": {},
                "description": "no name",
            }
        )

        assert result["isError"] is True

    async def test_handler_exception_caught(self):
        """If a handler raises, the dispatcher catches it and returns error."""
        from unittest.mock import AsyncMock

        failing_handler = AsyncMock(side_effect=RuntimeError("boom"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool.TOOL_HANDLERS",
            {"web_search": failing_handler},
        ):
            result = await numa_tool.handler(
                {
                    "name": "web_search",
                    "params": {"query": "test", "user_intent": "test"},
                    "description": "should fail",
                }
            )

        assert result["isError"] is True
        assert "boom" in result["content"][0]["text"]

    async def test_stringified_params_recovered(self):
        """If Claude inlines params as a JSON string, the dispatcher recovers it."""
        from unittest.mock import AsyncMock

        mock_result = _ok("ok")
        mock_handler = AsyncMock(return_value=mock_result)

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool.TOOL_HANDLERS",
            {"knowledge_base": mock_handler},
        ):
            result = await numa_tool.handler(
                {
                    "name": "knowledge_base",
                    "params": '{"operation": "query", "query": "test", "user_intent": "test"}',
                    "description": "Stringified params",
                }
            )

        assert result == mock_result
        mock_handler.assert_called_once_with(
            {"operation": "query", "query": "test", "user_intent": "test"}
        )

    async def test_unparseable_string_params_returns_error(self):
        """A non-JSON string in params returns a clear error, not a crash."""
        result = await numa_tool.handler(
            {
                "name": "knowledge_base",
                "params": "this is not json",
                "description": "Bad params",
            }
        )

        assert result["isError"] is True
        text = result["content"][0]["text"]
        assert "Invalid params" in text
        assert "knowledge_base" in text

    async def test_non_dict_non_str_params_returns_error(self):
        """Params that are neither dict nor str return a clear error."""
        result = await numa_tool.handler(
            {
                "name": "knowledge_base",
                "params": 42,
                "description": "Bad params type",
            }
        )

        assert result["isError"] is True
        assert "expected object" in result["content"][0]["text"]

    def test_tool_names_match_handler_keys(self):
        """TOOL_NAMES should exactly match the keys in TOOL_HANDLERS."""
        assert set(TOOL_NAMES) == set(TOOL_HANDLERS.keys())

    def test_all_handlers_are_coroutines(self):
        """Every handler in TOOL_HANDLERS should be an async function."""
        import asyncio

        for name, handler in TOOL_HANDLERS.items():
            assert asyncio.iscoroutinefunction(
                handler
            ), f"Handler for '{name}' is not async"


# ---------------------------------------------------------------------------
# Operation filtering: _get_allowed_operations, _check_operation_allowed
# ---------------------------------------------------------------------------


class TestGetAllowedOperations:
    """Tests for _get_allowed_operations() env var parsing."""

    def test_not_set_returns_none(self, monkeypatch):
        """No env var means no restriction (None)."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        assert _get_allowed_operations() is None

    def test_valid_list(self, monkeypatch):
        """Parses a valid JSON list of operation names."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_OPERATIONS",
            json.dumps(["knowledge_base", "web_search"]),
        )
        assert _get_allowed_operations() == ["knowledge_base", "web_search"]

    def test_empty_list(self, monkeypatch):
        """An empty list means all operations blocked."""
        monkeypatch.setenv("NUMA_ALLOWED_OPERATIONS", "[]")
        assert _get_allowed_operations() == []

    def test_malformed_json_returns_empty(self, monkeypatch):
        """Malformed JSON fails closed (returns empty list, all blocked)."""
        monkeypatch.setenv("NUMA_ALLOWED_OPERATIONS", "not-json!!!")
        assert _get_allowed_operations() == []


class TestCheckOperationAllowed:
    """Tests for the two-layer _check_operation_allowed() function."""

    def test_no_restrictions_allows_all(self, monkeypatch):
        """When neither layer restricts, all operations are allowed."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(
                [
                    "web_search",
                    "query_knowledge_base",
                    "create_agent_tool",
                    "memories_tool",
                ]
            ),
        )
        for op in TOOL_NAMES:
            assert _check_operation_allowed(op) is None, f"{op} should be allowed"

    def test_agent_type_blocks_operation(self, monkeypatch):
        """Layer 1 (agent type config) blocks operations not in the allowed list."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_OPERATIONS",
            json.dumps(["knowledge_base"]),
        )
        # web_search is not in the allowed list
        result = _check_operation_allowed("web_search")
        assert result is not None
        assert "not available for this agent type" in result

    def test_agent_type_allows_listed_operation(self, monkeypatch):
        """Layer 1 allows operations in the list (Layer 2 doesn't apply for unmapped ops)."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_OPERATIONS",
            json.dumps(["extract_content"]),
        )
        monkeypatch.delenv("NUMA_ENABLED_TOOLS", raising=False)
        # extract_content has no frontend toggle — should be allowed
        assert _check_operation_allowed("extract_content") is None

    def test_frontend_toggle_blocks_web_search(self, monkeypatch):
        """Layer 2 (frontend toggles) blocks web_search when not in enabledTools."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        result = _check_operation_allowed("web_search")
        assert result is not None
        assert "Web search" in result

    def test_frontend_toggle_blocks_kb_search(self, monkeypatch):
        """Layer 2 blocks the Numa Files operations when not in enabledTools.

        The error message uses the user-facing "folder" wording (post-rebrand).
        Both `numa_files` (preferred) and `knowledge_base` (legacy) operation
        names produce the same gating message so chat history replay still
        surfaces a coherent error.
        """
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        for op in ("numa_files", "knowledge_base"):
            result = _check_operation_allowed(op)
            assert result is not None
            assert "folder" in result.lower()

    def test_unmapped_ops_bypass_frontend_toggle(self, monkeypatch):
        """Operations not in _OPERATION_TO_ENABLED_TOOL_KEYS bypass frontend checks."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        # Only extract_content and convert_document have no frontend toggle
        for op in ["extract_content", "convert_document"]:
            assert (
                _check_operation_allowed(op) is None
            ), f"{op} should bypass frontend toggle"

    def test_layer2_blocks_kb_operations_when_toggle_off(self, monkeypatch):
        """knowledge_base is blocked when no Numa Files toggle is enabled."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        result = _check_operation_allowed("knowledge_base")
        assert (
            result is not None
        ), "knowledge_base should be blocked when no folder is enabled"
        assert "folder" in result.lower()

    def test_layer2_passes_kb_operations_when_toggle_on(self, monkeypatch):
        """knowledge_base passes when query_knowledge_base is in enabledTools."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps(["query_knowledge_base"]))

        assert (
            _check_operation_allowed("knowledge_base") is None
        ), "knowledge_base should be allowed when KB enabled"

    def test_agent_type_blocks_even_if_frontend_enables(self, monkeypatch):
        """Layer 1 hard limit takes precedence over frontend toggles."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_OPERATIONS",
            json.dumps(["knowledge_base"]),  # Only KB allowed
        )
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(["web_search", "query_knowledge_base"]),  # Frontend enables both
        )

        # web_search blocked by agent type config despite frontend enabling it
        result = _check_operation_allowed("web_search")
        assert result is not None
        assert "not available for this agent type" in result

        # KB allowed by both layers
        assert _check_operation_allowed("knowledge_base") is None

    def test_empty_allowed_operations_blocks_everything(self, monkeypatch):
        """allowed_numa_operations=[] means no operations allowed."""
        monkeypatch.setenv("NUMA_ALLOWED_OPERATIONS", json.dumps([]))
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(["web_search", "create_agent_tool"]),
        )

        for op in TOOL_NAMES:
            result = _check_operation_allowed(op)
            assert result is not None, f"{op} should be blocked"
            assert "none" in result  # "Available operations: none."


class TestDispatcherOperationFiltering:
    """Tests that the dispatcher enforces operation filtering end-to-end."""

    async def test_blocked_operation_never_reaches_handler(self, monkeypatch):
        """When agent type config blocks an operation, the handler is never called."""
        from unittest.mock import AsyncMock

        monkeypatch.setenv(
            "NUMA_ALLOWED_OPERATIONS",
            json.dumps(["knowledge_base"]),  # Only KB allowed
        )

        mock_handler = AsyncMock(return_value=_ok("should not run"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool.TOOL_HANDLERS",
            {"web_search": mock_handler},
        ):
            result = await numa_tool.handler(
                {
                    "name": "web_search",
                    "params": {"query": "test", "user_intent": "test"},
                    "description": "Should be blocked",
                }
            )

        assert result["isError"] is True
        assert "not available for this agent type" in result["content"][0]["text"]
        mock_handler.assert_not_called()

    async def test_allowed_operation_reaches_handler(self, monkeypatch):
        """When both layers allow, the handler is called normally."""
        from unittest.mock import AsyncMock

        monkeypatch.setenv(
            "NUMA_ALLOWED_OPERATIONS",
            json.dumps(["web_search"]),
        )
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(["web_search"]),
        )

        mock_result = _ok("search results")
        mock_handler = AsyncMock(return_value=mock_result)

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool.TOOL_HANDLERS",
            {"web_search": mock_handler},
        ):
            result = await numa_tool.handler(
                {
                    "name": "web_search",
                    "params": {"query": "test", "user_intent": "test"},
                    "description": "Should work",
                }
            )

        assert result == mock_result
        mock_handler.assert_called_once()

    async def test_frontend_toggle_blocks_at_dispatcher(self, monkeypatch):
        """Frontend toggle block happens at dispatcher level, not in handler."""
        from unittest.mock import AsyncMock

        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        mock_handler = AsyncMock(return_value=_ok("should not run"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool.TOOL_HANDLERS",
            {"agents": mock_handler},
        ):
            result = await numa_tool.handler(
                {
                    "name": "agents",
                    "params": {"operation": "list"},
                    "description": "Should be blocked",
                }
            )

        assert result["isError"] is True
        mock_handler.assert_not_called()


class TestOperationToEnabledToolKeysMapping:
    """Tests for the _OPERATION_TO_ENABLED_TOOL_KEYS mapping."""

    def test_mapped_operations_have_correct_keys(self):
        """Verify the mapping matches what the frontend sends."""
        assert (
            "query_knowledge_base" in _OPERATION_TO_ENABLED_TOOL_KEYS["knowledge_base"]
        )
        assert "knowledge_base" in _OPERATION_TO_ENABLED_TOOL_KEYS["knowledge_base"]
        assert "web_search" in _OPERATION_TO_ENABLED_TOOL_KEYS["web_search"]
        assert "create_agent_tool" in _OPERATION_TO_ENABLED_TOOL_KEYS["agents"]
        assert "memories_tool" in _OPERATION_TO_ENABLED_TOOL_KEYS["memories"]

    def test_kb_toggle_accepts_legacy_keys(self):
        """The numa_files operation accepts both canonical and legacy toggle keys."""
        kb_keys = _OPERATION_TO_ENABLED_TOOL_KEYS["knowledge_base"]
        assert "numa_files" in kb_keys
        assert "knowledge_base" in kb_keys
        assert "query_knowledge_base" in kb_keys
        assert "knowledge_search" in kb_keys

    def test_numa_files_and_knowledge_base_share_toggle_keys(self):
        """Both operation names accept the same set of toggle keys."""
        assert (
            _OPERATION_TO_ENABLED_TOOL_KEYS["numa_files"]
            == _OPERATION_TO_ENABLED_TOOL_KEYS["knowledge_base"]
        )

    def test_utility_operations_are_not_mapped(self):
        """Pure utility operations should not have frontend toggles."""
        for op in ["extract_content", "convert_document"]:
            assert (
                op not in _OPERATION_TO_ENABLED_TOOL_KEYS
            ), f"{op} should not be in the mapping (no frontend toggle)"

    def test_tool_handlers_dispatch_both_numa_files_and_knowledge_base(self):
        """Both name='numa_files' (preferred) and name='knowledge_base' (legacy)
        must dispatch to the same handler so old chat history still replays."""
        assert "numa_files" in TOOL_HANDLERS
        assert "knowledge_base" in TOOL_HANDLERS
        assert TOOL_HANDLERS["numa_files"] is TOOL_HANDLERS["knowledge_base"]
        assert TOOL_HANDLERS["numa_files"] is _handle_knowledge_base
        assert "numa_files" in TOOL_NAMES
        assert "knowledge_base" in TOOL_NAMES


# ---------------------------------------------------------------------------
# _handle_knowledge_base dispatcher
# ---------------------------------------------------------------------------


class TestHandleKnowledgeBase:
    """Tests for the _handle_knowledge_base dispatcher that routes to sub-handlers."""

    @pytest.fixture(autouse=True)
    def kb_env(self, monkeypatch):
        """Set up KB-related environment variables."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_KBS",
            json.dumps([{"id": "kb-1", "name": "Company KB"}]),
        )
        monkeypatch.setenv("NUMA_USER_SUB", "user-sub-1")

    async def test_query_routes_to_handle_query_kb(self):
        """operation='query' should route to _handle_query_kb."""
        from unittest.mock import AsyncMock

        mock_handler = AsyncMock(return_value=_ok("query result"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool._KB_OPERATIONS",
            {"query": mock_handler},
        ):
            result = await _handle_knowledge_base(
                {"operation": "query", "query": "test", "user_intent": "test"}
            )

        assert result == _ok("query result")
        mock_handler.assert_called_once_with({"query": "test", "user_intent": "test"})

    async def test_upload_routes_to_handle_kb_upload(self):
        """operation='upload' should route to _handle_kb_upload."""
        from unittest.mock import AsyncMock

        mock_handler = AsyncMock(return_value=_ok("upload result"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool._KB_OPERATIONS",
            {"upload": mock_handler},
        ):
            result = await _handle_knowledge_base(
                {"operation": "upload", "file": "/workdir/uploads/doc.txt"}
            )

        assert result == _ok("upload result")
        mock_handler.assert_called_once_with({"file": "/workdir/uploads/doc.txt"})

    async def test_download_routes_to_handle_kb_download(self):
        """operation='download' should route to _handle_kb_download."""
        from unittest.mock import AsyncMock

        mock_handler = AsyncMock(return_value=_ok("download result"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool._KB_OPERATIONS",
            {"download": mock_handler},
        ):
            result = await _handle_knowledge_base(
                {"operation": "download", "uri": "s3://bucket/key"}
            )

        assert result == _ok("download result")
        mock_handler.assert_called_once_with({"uri": "s3://bucket/key"})

    async def test_list_routes_to_handle_kb_list(self):
        """operation='list' should route to _handle_kb_list."""
        from unittest.mock import AsyncMock

        mock_handler = AsyncMock(return_value=_ok("list result"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool._KB_OPERATIONS",
            {"list": mock_handler},
        ):
            result = await _handle_knowledge_base(
                {"operation": "list", "kb_id": "my-kb"}
            )

        assert result == _ok("list result")
        mock_handler.assert_called_once_with({"kb_id": "my-kb"})

    async def test_download_folder_routes_to_handle_kb_download_folder(self):
        """operation='download_folder' should route to _handle_kb_download_folder."""
        from unittest.mock import AsyncMock

        mock_handler = AsyncMock(return_value=_ok("folder result"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool._KB_OPERATIONS",
            {"download_folder": mock_handler},
        ):
            result = await _handle_knowledge_base(
                {"operation": "download_folder", "folder_path": "reports/2024"}
            )

        assert result == _ok("folder result")
        mock_handler.assert_called_once_with({"folder_path": "reports/2024"})

    async def test_invalid_operation_returns_error(self):
        """An unrecognised operation should return an error listing valid operations.

        Note: 'delete' is a *valid* operation (see _KB_OPERATIONS), so this uses
        a genuinely unknown name. The error wording is "Invalid numa_files
        operation" post the My Files -> Numa Files rebrand.
        """
        result = await _handle_knowledge_base({"operation": "frobnicate"})

        assert result["isError"] is True
        text = result["content"][0]["text"]
        assert "Invalid numa_files operation" in text
        assert "query" in text

    async def test_missing_operation_returns_error(self):
        """Missing operation should return an error."""
        result = await _handle_knowledge_base({})

        assert result["isError"] is True
        assert "Invalid numa_files operation" in result["content"][0]["text"]

    async def test_operation_param_stripped_from_sub_handler_params(self):
        """The 'operation' key should not be passed to the sub-handler."""
        from unittest.mock import AsyncMock

        mock_handler = AsyncMock(return_value=_ok("result"))

        with patch.dict(
            "numa_workspace_agent.mcp_tools.numa_tool._KB_OPERATIONS",
            {"query": mock_handler},
        ):
            await _handle_knowledge_base(
                {"operation": "query", "query": "test", "user_intent": "test"}
            )

        # The sub-handler should receive params WITHOUT the 'operation' key
        call_params = mock_handler.call_args[0][0]
        assert "operation" not in call_params
        assert call_params == {"query": "test", "user_intent": "test"}


# ---------------------------------------------------------------------------
# _handle_query_kb
# ---------------------------------------------------------------------------


class TestHandleQueryKb:
    """Tests for _handle_query_kb handler."""

    @pytest.fixture(autouse=True)
    def kb_env(self, monkeypatch):
        """Set up KB-related environment variables."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_KBS",
            json.dumps([{"id": "kb-1", "name": "Company KB"}]),
        )
        monkeypatch.setenv("NUMA_USER_SUB", "user-sub-1")

    async def test_successful_query(self):
        """Happy path: returns Lambda result as JSON text."""
        mock_result = {
            "results_count": 3,
            "results": [{"text": "doc1"}, {"text": "doc2"}, {"text": "doc3"}],
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_query_kb(
                {
                    "query": "What is the policy?",
                    "user_intent": "Find policy docs",
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["results_count"] == 3

        # Verify correct Lambda tool name and params
        call_args = mock_invoke.call_args
        assert call_args[0][0] == "query_knowledgebase"
        assert call_args[0][1]["query"] == "What is the policy?"
        assert call_args[0][1]["kb_id"] == "company"  # default

    async def test_missing_query_returns_error(self):
        """Missing 'query' parameter should return an error."""
        result = await _handle_query_kb({"user_intent": "test"})

        assert result["isError"] is True
        assert "query" in result["content"][0]["text"].lower()

    async def test_missing_user_intent_returns_error(self):
        """Missing 'user_intent' parameter should return an error."""
        result = await _handle_query_kb({"query": "test"})

        assert result["isError"] is True
        assert "user_intent" in result["content"][0]["text"].lower()

    async def test_output_file_handling(self, tmp_path):
        """When output_file is provided, results are written to disk."""
        mock_result = {
            "results_count": 1,
            "results": [{"text": "result"}],
        }
        output_file = str(tmp_path / "subdir" / "results.json")

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_query_kb(
                {
                    "query": "test",
                    "user_intent": "test",
                    "output_file": output_file,
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"
        assert parsed["file_path"] == output_file
        assert parsed["results_count"] == 1

        # Verify file was actually written
        written = json.loads(Path(output_file).read_text())
        assert written["results_count"] == 1

    async def test_max_results_clamped_high(self):
        """max_results above 15 should be clamped to 15."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_query_kb(
                {
                    "query": "test",
                    "user_intent": "test",
                    "max_results": 99,
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["max_results"] == 15

    async def test_max_results_clamped_low(self):
        """max_results below 1 should be clamped to 1."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_query_kb(
                {
                    "query": "test",
                    "user_intent": "test",
                    "max_results": 0,
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["max_results"] == 1

    async def test_custom_kb_id(self):
        """A custom kb_id should be forwarded to the Lambda."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_query_kb(
                {
                    "query": "test",
                    "user_intent": "test",
                    "kb_id": "custom-kb",
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["kb_id"] == "custom-kb"

    async def test_summarise_results_defaults_to_false(self):
        """Default behaviour is raw chunks; Lambda must see summarise_results=False."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_query_kb({"query": "test", "user_intent": "test"})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["summarise_results"] is False

    async def test_summarise_results_opt_in(self):
        """Callers can opt into summarisation by passing summarise_results=True."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_query_kb(
                {
                    "query": "test",
                    "user_intent": "test",
                    "summarise_results": True,
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["summarise_results"] is True


# ---------------------------------------------------------------------------
# _handle_web_search
# ---------------------------------------------------------------------------


class TestHandleWebSearch:
    """Tests for _handle_web_search handler."""

    async def test_successful_search(self):
        """Happy path: returns Lambda result as JSON text."""
        mock_result = {
            "results": [{"title": "Page", "url": "https://example.com"}],
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_web_search(
                {
                    "query": "latest news",
                    "user_intent": "Find news",
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert len(parsed["results"]) == 1

        call_args = mock_invoke.call_args
        assert call_args[0][0] == "web_search"

    async def test_missing_query_returns_error(self):
        """Missing 'query' returns an error."""
        result = await _handle_web_search({"user_intent": "test"})
        assert result["isError"] is True

    async def test_missing_user_intent_is_optional(self):
        """user_intent is optional for web_search (two-step search upgrade,
        d611ae2e): missing it is fine — the search still runs and only `query`
        is forwarded. It is only passed through to the Lambda when supplied."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            result = await _handle_web_search({"query": "test"})

        assert "isError" not in result
        sent_params = mock_invoke.call_args[0][1]
        assert "user_intent" not in sent_params

    async def test_max_results_clamped_to_10(self):
        """max_results above 10 should be clamped to 10."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_web_search(
                {
                    "query": "test",
                    "user_intent": "test",
                    "max_results": 50,
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["max_results"] == 10

    async def test_max_results_clamped_to_1(self):
        """max_results below 1 should be clamped to 1."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_web_search(
                {
                    "query": "test",
                    "user_intent": "test",
                    "max_results": -5,
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["max_results"] == 1

    async def test_default_max_results_is_5(self):
        """When max_results is not provided, default should be 5.

        Raised from 3 to 5 in the two-step Playwright web search upgrade
        (d611ae2e) — more candidate results to fetch/expand from.
        """
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"results": []},
        ) as mock_invoke:
            await _handle_web_search(
                {
                    "query": "test",
                    "user_intent": "test",
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["max_results"] == 5


# ---------------------------------------------------------------------------
# _handle_extract_content
# ---------------------------------------------------------------------------


class TestHandleExtractContent:
    """Tests for _handle_extract_content handler."""

    @pytest.fixture(autouse=True)
    def extract_env(self, monkeypatch):
        """Set environment variables for extract_content."""
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "conv-1")
        monkeypatch.setenv("OUTPUTS_BUCKET_NAME", "test-outputs-bucket")

    async def test_successful_extraction(self):
        """Happy path: file is synced, Lambda runs, result is downloaded."""
        mock_lambda_result = {
            "output_path": "/workdir/outputs/doc.txt",
            "s3_key": "prefix/doc.txt",
            "message": "Extracted 500 chars",
            "original_file": "/workdir/uploads/doc.pdf",
            "text_length": 500,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_lambda_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3",
            ) as mock_s3_sync,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_s3",
            ) as mock_download,
        ):
            result = await _handle_extract_content(
                {
                    "file_path": "/workdir/uploads/doc.pdf",
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"
        assert parsed["text_length"] == 500
        assert parsed["output_path"] == "/workdir/outputs/doc.txt"

        # Verify S3 sync was called with correct args
        mock_s3_sync.assert_called_once_with(
            "/workdir/uploads/doc.pdf", "user-1", "conv-1"
        )
        # Verify download was called
        mock_download.assert_called_once_with(
            "test-outputs-bucket", "prefix/doc.txt", "/workdir/outputs/doc.txt"
        )

    async def test_missing_file_path_returns_error(self):
        """Missing 'file_path' should return an error."""
        result = await _handle_extract_content({})
        assert result["isError"] is True
        assert "file_path" in result["content"][0]["text"].lower()

    async def test_missing_user_context_returns_error(self, monkeypatch):
        """Missing NUMA_USER_SUB should return an error."""
        monkeypatch.setenv("NUMA_USER_SUB", "")
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "")

        result = await _handle_extract_content(
            {"file_path": "/workdir/uploads/doc.pdf"}
        )
        assert result["isError"] is True
        assert "User context" in result["content"][0]["text"]

    async def test_missing_outputs_bucket_returns_error(self, monkeypatch):
        """Missing OUTPUTS_BUCKET_NAME should return error after Lambda call."""
        monkeypatch.setenv("OUTPUTS_BUCKET_NAME", "")

        mock_lambda_result = {
            "output_path": "/workdir/outputs/doc.txt",
            "s3_key": "prefix/doc.txt",
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_lambda_result,
            ),
            patch("numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3"),
        ):
            result = await _handle_extract_content(
                {"file_path": "/workdir/uploads/doc.pdf"}
            )

        assert result["isError"] is True
        assert "OUTPUTS_BUCKET_NAME" in result["content"][0]["text"]

    async def test_lambda_no_output_path_returns_error(self):
        """If Lambda returns no output_path, an error is returned."""
        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value={"message": "done but no path"},
            ),
            patch("numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3"),
        ):
            result = await _handle_extract_content(
                {"file_path": "/workdir/uploads/doc.pdf"}
            )

        assert result["isError"] is True
        assert "No output path" in result["content"][0]["text"]


# ---------------------------------------------------------------------------
# _handle_convert_document
# ---------------------------------------------------------------------------


class TestHandleConvertDocument:
    """Tests for _handle_convert_document handler."""

    @pytest.fixture(autouse=True)
    def convert_env(self, monkeypatch):
        """Set environment variables for convert_document."""
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "conv-1")
        monkeypatch.setenv("OUTPUTS_BUCKET_NAME", "test-bucket")

    async def test_successful_conversion(self):
        """Happy path: markdown mode converts and downloads."""
        mock_lambda_result = {
            "output_path": "/workdir/outputs/report.pdf",
            "s3_key": "prefix/report.pdf",
            "message": "Converted to PDF",
            "original_file": "/workdir/uploads/report.md",
            "size": 12345,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_lambda_result,
            ),
            patch("numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3"),
            patch("numa_workspace_agent.mcp_tools.numa_tool.download_from_s3"),
        ):
            result = await _handle_convert_document(
                {
                    "file_path": "/workdir/uploads/report.md",
                    "format": "pdf",
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"
        assert parsed["format"] == "pdf"
        assert parsed["mode"] == "markdown"  # default

    async def test_missing_file_path_returns_error(self):
        """Missing 'file_path' returns an error."""
        result = await _handle_convert_document({"format": "pdf"})
        assert result["isError"] is True

    async def test_missing_format_returns_error(self):
        """Missing 'format' returns an error."""
        result = await _handle_convert_document({"file_path": "/workdir/test.md"})
        assert result["isError"] is True

    async def test_invalid_format_returns_error(self):
        """Invalid format (not pdf or docx) returns an error."""
        result = await _handle_convert_document(
            {
                "file_path": "/workdir/test.md",
                "format": "html",
            }
        )

        assert result["isError"] is True
        assert "Invalid format" in result["content"][0]["text"]
        assert "'html'" in result["content"][0]["text"]

    async def test_invalid_mode_returns_error(self):
        """Invalid mode (not markdown or file) returns an error."""
        result = await _handle_convert_document(
            {
                "file_path": "/workdir/test.md",
                "format": "pdf",
                "mode": "raw",
            }
        )

        assert result["isError"] is True
        assert "Invalid mode" in result["content"][0]["text"]

    async def test_file_mode_rejects_same_format(self):
        """File mode with same input and output format returns an error."""
        result = await _handle_convert_document(
            {
                "file_path": "/workdir/test.pdf",
                "format": "pdf",
                "mode": "file",
            }
        )

        assert result["isError"] is True
        assert "same" in result["content"][0]["text"].lower()

    async def test_file_mode_rejects_non_pdf_docx_input(self):
        """File mode with non-pdf/docx input returns an error."""
        result = await _handle_convert_document(
            {
                "file_path": "/workdir/test.txt",
                "format": "pdf",
                "mode": "file",
            }
        )

        assert result["isError"] is True
        assert ".txt" in result["content"][0]["text"]

    async def test_file_mode_pdf_to_docx_succeeds(self):
        """File mode converting PDF to DOCX should succeed."""
        mock_lambda_result = {
            "output_path": "/workdir/outputs/doc.docx",
            "s3_key": "prefix/doc.docx",
            "size": 5000,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_lambda_result,
            ),
            patch("numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3"),
            patch("numa_workspace_agent.mcp_tools.numa_tool.download_from_s3"),
        ):
            result = await _handle_convert_document(
                {
                    "file_path": "/workdir/uploads/doc.pdf",
                    "format": "docx",
                    "mode": "file",
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["mode"] == "file"
        assert parsed["format"] == "docx"

    async def test_title_forwarded_to_lambda(self):
        """Optional 'title' param should be included in Lambda params."""
        mock_lambda_result = {
            "output_path": "/workdir/outputs/report.pdf",
            "s3_key": "prefix/report.pdf",
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_lambda_result,
            ) as mock_invoke,
            patch("numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3"),
            patch("numa_workspace_agent.mcp_tools.numa_tool.download_from_s3"),
        ):
            await _handle_convert_document(
                {
                    "file_path": "/workdir/report.md",
                    "format": "pdf",
                    "title": "My Report",
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["title"] == "My Report"

    async def test_missing_user_context_returns_error(self, monkeypatch):
        """Missing user context returns an error."""
        monkeypatch.setenv("NUMA_USER_SUB", "")
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "")

        result = await _handle_convert_document(
            {
                "file_path": "/workdir/test.md",
                "format": "pdf",
            }
        )

        assert result["isError"] is True
        assert "User context" in result["content"][0]["text"]


# ---------------------------------------------------------------------------
# _handle_kb_upload
# ---------------------------------------------------------------------------


class TestHandleKbUpload:
    """Tests for _handle_kb_upload handler."""

    @pytest.fixture(autouse=True)
    def kb_env(self, monkeypatch):
        """Set KB environment variables."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_KBS",
            json.dumps([{"id": "kb-1", "name": "Company"}]),
        )
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")

    async def test_successful_upload(self, tmp_path):
        """Happy path: small file is read, base64-encoded, and sent to Lambda."""
        test_file = tmp_path / "doc.txt"
        test_file.write_text("Hello, world!")

        mock_result = {"status": "success", "message": "Uploaded"}

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_kb_upload({"file": str(test_file), "path": ""})

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"

        # Verify base64 content was sent
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["filename"] == "doc.txt"
        decoded = base64.b64decode(sent_params["content_base64"])
        assert decoded == b"Hello, world!"
        assert sent_params["size_bytes"] == 13

    async def test_missing_file_param_returns_error(self):
        """Missing 'file' param returns an error."""
        result = await _handle_kb_upload({})
        assert result["isError"] is True
        assert "file" in result["content"][0]["text"].lower()

    async def test_file_not_found_returns_error(self):
        """Non-existent file path returns an error."""
        result = await _handle_kb_upload({"file": "/nonexistent/file.txt"})
        assert result["isError"] is True
        assert "not found" in result["content"][0]["text"].lower()

    async def test_missing_path_param_returns_error(self, tmp_path):
        """BUG-138: omitting path entirely must error — prevents silent drift to KB root.

        The model must consciously decide between root (path="") and a sub-path on
        every upload, instead of falling through to root when it loses track of
        the source file's location.
        """
        test_file = tmp_path / "doc.txt"
        test_file.write_text("data")
        result = await _handle_kb_upload({"file": str(test_file)})
        assert result["isError"] is True
        assert "path" in result["content"][0]["text"].lower()

    async def test_explicit_empty_path_uploads_to_root(self, tmp_path):
        """path='' is an explicit 'upload to root' opt-in (BUG-138)."""
        test_file = tmp_path / "doc.txt"
        test_file.write_text("data")

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"status": "success"},
        ) as mock_invoke:
            await _handle_kb_upload({"file": str(test_file), "path": ""})

        assert mock_invoke.call_args[0][1]["kb_path"] == ""

    async def test_explicit_slash_path_normalised_to_root(self, tmp_path):
        """path='/' is treated as root, same as path='' (BUG-138)."""
        test_file = tmp_path / "doc.txt"
        test_file.write_text("data")

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"status": "success"},
        ) as mock_invoke:
            await _handle_kb_upload({"file": str(test_file), "path": "/"})

        assert mock_invoke.call_args[0][1]["kb_path"] == ""

    async def test_kb_path_alias_honoured(self, tmp_path):
        """BUG-126: kb_path (the internal Lambda field name) must be accepted as
        an alias. Previously it was silently dropped because only path,
        destination, folder, folder_path, and target_path were recognised, so
        passing kb_path="Trial Checklists/" uploaded to root with no warning.
        """
        test_file = tmp_path / "doc.txt"
        test_file.write_text("data")

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"status": "success"},
        ) as mock_invoke:
            await _handle_kb_upload(
                {"file": str(test_file), "kb_path": "Trial Checklists/"}
            )

        assert mock_invoke.call_args[0][1]["kb_path"] == "Trial Checklists/"

    async def test_large_file_uses_presigned_url(self, tmp_path):
        """File exceeding PRESIGNED_URL_THRESHOLD uses streaming upload."""
        big_file = tmp_path / "big.bin"
        big_file.write_bytes(b"x" * (PRESIGNED_URL_THRESHOLD + 1))

        mock_result = {
            "status": "success",
            "presigned_url": "https://s3.example.com/upload",
            "message": "Presigned URL generated",
        }
        mock_finalize_result = {"status": "success", "message": "Finalized"}

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                side_effect=[mock_result, mock_finalize_result],
            ) as mock_invoke,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.upload_to_presigned_url",
            ) as mock_upload,
        ):
            result = await _handle_kb_upload({"file": str(big_file), "path": ""})

            assert "isError" not in result

            # Verify upload was called
            mock_upload.assert_called_once_with(
                "https://s3.example.com/upload", str(big_file)
            )

            # Verify invoke_workspace_tool was called twice: once for URL, once for Finalize
            assert mock_invoke.call_count == 2

            first_call_params = mock_invoke.call_args_list[0][0][1]
            assert first_call_params["get_presigned_url"] is True
            assert "content_base64" not in first_call_params

            second_call_params = mock_invoke.call_args_list[1][0][1]
            assert second_call_params.get("finalize_upload") is True

            parsed = json.loads(result["content"][0]["text"])
            assert "successfully via S3 stream" in parsed["message"]

    async def test_custom_kb_id_forwarded(self, tmp_path):
        """Custom kb_id should be forwarded in Lambda params."""
        test_file = tmp_path / "doc.txt"
        test_file.write_text("data")

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"status": "success"},
        ) as mock_invoke:
            await _handle_kb_upload(
                {
                    "file": str(test_file),
                    "kb_id": "custom-kb",
                    "path": "folder/subfolder",
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["kb_id"] == "custom-kb"
        assert sent_params["kb_path"] == "folder/subfolder"


# ---------------------------------------------------------------------------
# _handle_kb_download
# ---------------------------------------------------------------------------


class TestHandleKbDownload:
    """Tests for _handle_kb_download handler."""

    @pytest.fixture(autouse=True)
    def kb_env(self, monkeypatch):
        """Set KB environment variables."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_KBS",
            json.dumps([{"id": "kb-1", "name": "Company"}]),
        )
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")

    async def test_download_via_uri(self, tmp_path):
        """Download by S3 URI uses presigned URL path."""
        mock_result = {
            "filename": "report.pdf",
            "presigned_url": "https://s3.example.com/signed-url",
            "size_bytes": 1024,
            "s3_uri": "s3://bucket/key",
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ) as mock_invoke,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=1024,
            ) as mock_dl,
        ):
            result = await _handle_kb_download(
                {
                    "uri": "s3://bucket/key",
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"
        assert parsed["filename"] == "report.pdf"
        assert parsed["size_bytes"] == 1024

        # Verify Lambda was called with uri mode
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["uri"] == "s3://bucket/key"
        assert sent_params["mode"] == "download"

        # Verify presigned URL download
        mock_dl.assert_called_once()

    async def test_download_via_file_and_kb_id(self, tmp_path):
        """Download by file name + kb_id."""
        mock_result = {
            "filename": "data.csv",
            "presigned_url": "https://s3.example.com/signed",
            "size_bytes": 512,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ) as mock_invoke,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=512,
            ),
        ):
            result = await _handle_kb_download(
                {
                    "file": "data.csv",
                    "kb_id": "my-kb",
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["file"] == "data.csv"
        assert sent_params["kb_id"] == "my-kb"
        assert "uri" not in sent_params

    async def test_download_base64_content(self, tmp_path):
        """Download via base64 content (small files)."""
        file_content = b"Small file content"
        encoded = base64.b64encode(file_content).decode("utf-8")

        mock_result = {
            "filename": "small.txt",
            "content_base64": encoded,
            "s3_uri": "s3://bucket/small.txt",
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download(
                {
                    "file": "small.txt",
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"
        assert parsed["size_bytes"] == len(file_content)

        # Verify the file was written to disk
        output_file = tmp_path / "small.txt"
        assert output_file.exists()
        assert output_file.read_bytes() == file_content

    async def test_missing_uri_and_file_returns_error(self):
        """Neither 'uri' nor 'file' provided should return an error."""
        result = await _handle_kb_download({})
        assert result["isError"] is True
        assert "uri" in result["content"][0]["text"].lower()

    async def test_default_output_dir(self):
        """When no output_dir is specified, it defaults to /workdir/outputs/."""
        mock_result = {
            "filename": "doc.pdf",
            "presigned_url": "https://s3.example.com/signed",
            "size_bytes": 100,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=100,
            ) as mock_dl,
            patch("pathlib.Path.mkdir"),
        ):
            result = await _handle_kb_download({"uri": "s3://bucket/key"})

        # The dest path should be under /workdir/outputs/
        dest = mock_dl.call_args[1]["dest_path"]
        assert dest.startswith("/workdir/outputs/")

    async def test_fallback_when_no_presigned_url_or_base64(self, tmp_path):
        """When Lambda returns neither presigned_url nor content_base64,
        the raw result dict is returned as JSON."""
        mock_result = {
            "filename": "weird.bin",
            "message": "No download available",
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download(
                {
                    "uri": "s3://bucket/key",
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["message"] == "No download available"

    @pytest.mark.parametrize(
        "file_alias", ["file_name", "filename", "path", "file_path"]
    )
    async def test_file_aliases_accepted(self, tmp_path, file_alias):
        """Common LLM-reachable spellings for `file` should be accepted."""
        mock_result = {
            "filename": "doc.pdf",
            "presigned_url": "https://s3.example.com/signed",
            "size_bytes": 100,
        }
        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ) as mock_invoke,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=100,
            ),
        ):
            result = await _handle_kb_download(
                {file_alias: "doc.pdf", "kb_id": "kb-1", "output_dir": str(tmp_path)}
            )
        assert "isError" not in result
        sent = mock_invoke.call_args[0][1]
        assert sent["file"] == "doc.pdf"
        assert sent["kb_id"] == "kb-1"

    @pytest.mark.parametrize("dest_alias", ["destination", "output_path", "dest"])
    async def test_output_dir_aliases_accepted(self, tmp_path, dest_alias):
        """Common spellings for `output_dir` should be accepted."""
        mock_result = {
            "filename": "doc.pdf",
            "presigned_url": "https://s3.example.com/signed",
            "size_bytes": 100,
        }
        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=100,
            ) as mock_dl,
        ):
            await _handle_kb_download(
                {"file": "doc.pdf", "kb_id": "kb-1", dest_alias: str(tmp_path)}
            )
        assert mock_dl.call_args[1]["dest_path"].startswith(str(tmp_path))

    async def test_destination_with_filename_uses_parent_dir(self, tmp_path):
        """A full file-path-style destination should resolve to its parent dir."""
        mock_result = {
            "filename": "doc.pdf",
            "presigned_url": "https://s3.example.com/signed",
            "size_bytes": 100,
        }
        full_path = tmp_path / "doc.pdf"
        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=100,
            ) as mock_dl,
        ):
            await _handle_kb_download(
                {
                    "file": "doc.pdf",
                    "kb_id": "kb-1",
                    "destination": str(full_path),
                }
            )
        assert mock_dl.call_args[1]["dest_path"] == str(full_path)


# ---------------------------------------------------------------------------
# _handle_kb_list
# ---------------------------------------------------------------------------


class TestHandleKbList:
    """Tests for _handle_kb_list handler."""

    @pytest.fixture(autouse=True)
    def kb_env(self, monkeypatch):
        """Set KB environment variables."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_KBS",
            json.dumps([{"id": "kb-1", "name": "Company"}]),
        )
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")

    async def test_successful_list(self):
        """Happy path: returns file list from Lambda."""
        mock_result = {
            "files": ["doc1.pdf", "doc2.txt", "report.docx"],
            "total": 3,
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_kb_list({})

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["total"] == 3

        # Verify correct Lambda tool/params
        call_args = mock_invoke.call_args
        assert call_args[0][0] == "retrieve_kb_file"
        assert call_args[0][1]["mode"] == "list"
        assert call_args[0][1]["kb_id"] == "company"  # default

    async def test_custom_kb_id_and_pattern(self):
        """Custom kb_id and pattern are forwarded."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"kb_id": "my-kb", "pattern": "*.pdf"})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["kb_id"] == "my-kb"
        assert sent_params["pattern"] == "*.pdf"

    async def test_allowed_kbs_forwarded(self):
        """Allowed KB IDs are passed as extra_event_fields.

        _get_kb_config auto-injects the caller's own root KB (NUMA_USER_SUB,
        here 'user-1') so users can always reach their personal/root files
        (ad8e9734). This is the caller's *own* KB — not a scoping leak — so the
        forwarded list is the configured KB plus the personal root KB.
        """
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({})

        extra = mock_invoke.call_args[1].get("extra_event_fields", {})
        assert extra["allowed_kbs"] == ["kb-1", "user-1"]

    async def test_folder_forwarded(self):
        """A folder param is forwarded to the Lambda."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"folder": "Releases/v2.1"})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["folder"] == "Releases/v2.1"

    async def test_folder_path_alias_forwarded_as_folder(self):
        """folder_path is accepted as an alias and sent as `folder` to the Lambda."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"folder_path": "Releases"})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["folder"] == "Releases"

    async def test_path_alias_forwarded_as_folder(self):
        """path is accepted as an alias (kb_upload-style) and normalised to `folder`."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"path": "Releases/v2.1"})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["folder"] == "Releases/v2.1"

    async def test_folder_wins_over_aliases(self):
        """When both folder and path are supplied, folder takes precedence."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list(
                {"folder": "Releases", "folder_path": "Other", "path": "Misc"}
            )

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["folder"] == "Releases"

    async def test_folder_absent_not_sent_as_null(self):
        """When folder is not provided, the key must be absent (not null)."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"kb_id": "company"})

        sent_params = mock_invoke.call_args[0][1]
        assert "folder" not in sent_params

    async def test_recursive_forwarded(self):
        """recursive=true is forwarded as a boolean."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"folder": "Releases", "recursive": True})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["recursive"] is True

    async def test_recursive_absent_not_sent(self):
        """When recursive is omitted, the key must not appear in the payload."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({"folder": "Releases"})

        sent_params = mock_invoke.call_args[0][1]
        assert "recursive" not in sent_params


# ---------------------------------------------------------------------------
# _handle_kb_download_folder
# ---------------------------------------------------------------------------


class TestHandleKbDownloadFolder:
    """Tests for _handle_kb_download_folder handler."""

    @pytest.fixture(autouse=True)
    def kb_env(self, monkeypatch):
        """Set KB environment variables."""
        monkeypatch.setenv(
            "NUMA_ALLOWED_KBS",
            json.dumps([{"id": "kb-1", "name": "Company"}]),
        )
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")

    async def test_successful_download_presigned_url(self, tmp_path):
        """Happy path: folder zip downloaded via presigned URL."""
        mock_result = {
            "filename": "folder.zip",
            "presigned_url": "https://s3.example.com/signed-folder",
            "size_bytes": 4096,
            "file_count": 5,
            "total_files_in_folder": 5,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ) as mock_invoke,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=4096,
            ),
        ):
            result = await _handle_kb_download_folder(
                {
                    "folder_path": "reports/2024",
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["status"] == "success"
        assert parsed["file_count"] == 5
        assert parsed["size_bytes"] == 4096
        assert parsed["filename"] == "folder.zip"

        # Verify Lambda was called with download_folder mode
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["mode"] == "download_folder"
        assert sent_params["folder_path"] == "reports/2024"

    async def test_download_base64_zip(self, tmp_path):
        """Folder zip downloaded via base64 content."""
        zip_content = b"PK\x03\x04fake-zip-content"
        encoded = base64.b64encode(zip_content).decode("utf-8")

        mock_result = {
            "filename": "docs.zip",
            "content_base64": encoded,
            "file_count": 2,
            "total_files_in_folder": 2,
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download_folder(
                {
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["size_bytes"] == len(zip_content)

        # Verify zip was written to disk
        output_file = tmp_path / "docs.zip"
        assert output_file.exists()
        assert output_file.read_bytes() == zip_content

    async def test_default_params(self):
        """Defaults: kb_id='company', folder_path=''."""
        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value={"filename": "download.zip"},
            ) as mock_invoke,
            patch("pathlib.Path.mkdir"),
        ):
            await _handle_kb_download_folder({})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["kb_id"] == "company"
        assert sent_params["folder_path"] == ""

    async def test_fallback_when_no_download_data(self, tmp_path):
        """When neither presigned_url nor content_base64 is present,
        the raw result is returned as JSON."""
        mock_result = {
            "message": "Folder is empty",
            "file_count": 0,
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download_folder(
                {
                    "output_dir": str(tmp_path),
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert parsed["message"] == "Folder is empty"

    async def test_presigned_url_output_path(self, tmp_path):
        """Output path should be output_dir / filename from result."""
        mock_result = {
            "filename": "custom-name.zip",
            "presigned_url": "https://s3.example.com/signed",
            "size_bytes": 100,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                return_value=100,
            ) as mock_dl,
        ):
            result = await _handle_kb_download_folder(
                {
                    "output_dir": str(tmp_path),
                }
            )

        parsed = json.loads(result["content"][0]["text"])
        assert parsed["output_path"] == str(tmp_path / "custom-name.zip")


# ---------------------------------------------------------------------------
# _handle_agents
# ---------------------------------------------------------------------------


class TestHandleAgents:
    """Tests for _handle_agents handler."""

    @pytest.fixture(autouse=True)
    def agents_env(self, monkeypatch):
        """Set environment variables for agent operations."""
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "conv-1")
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(["create_agent_tool", "memories_tool"]),
        )

    async def test_list_agents(self):
        """List operation routes to list_agents Lambda tool."""
        mock_result = {
            "agents": [{"agentId": "agt_1", "title": "My Agent"}],
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_agents(
                {
                    "operation": "list",
                    "scope": "owned",
                }
            )

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert len(parsed["agents"]) == 1

        # Verify correct Lambda tool name
        assert mock_invoke.call_args[0][0] == "list_agents"
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["scope"] == "owned"

    async def test_get_agent(self):
        """Get operation routes to get_agent Lambda tool."""
        mock_result = {
            "agentId": "agt_abc",
            "title": "Test Agent",
            "systemPrompt": "You are helpful.",
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_agents(
                {
                    "operation": "get",
                    "agent_id": "agt_abc",
                }
            )

        assert "isError" not in result
        assert mock_invoke.call_args[0][0] == "get_agent"
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["agent_id"] == "agt_abc"

    async def test_create_agent(self):
        """Create operation routes to create_agent Lambda tool."""
        mock_result = {
            "status": "success",
            "agentId": "agt_new",
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_agents(
                {
                    "operation": "create",
                    "title": "New Agent",
                    "systemPrompt": "Be helpful.",
                    "visibility": "personal",
                }
            )

        assert "isError" not in result
        assert mock_invoke.call_args[0][0] == "create_agent"
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["title"] == "New Agent"
        assert sent_params["systemPrompt"] == "Be helpful."
        assert sent_params["visibility"] == "personal"

    async def test_create_agent_with_file_attachments(self):
        """Create with attach_files triggers S3 sync and forwards attachFiles."""
        mock_result = {"status": "success", "agentId": "agt_new"}

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ) as mock_invoke,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.ensure_file_in_s3",
            ) as mock_s3_sync,
        ):
            result = await _handle_agents(
                {
                    "operation": "create",
                    "title": "Policy Agent",
                    "systemPrompt": "Help with policies.",
                    "attach_files": [
                        "/workdir/uploads/a.pdf",
                        "/workdir/uploads/b.docx",
                    ],
                }
            )

        assert "isError" not in result

        # Verify S3 sync was called for each file
        assert mock_s3_sync.call_count == 2
        mock_s3_sync.assert_any_call("/workdir/uploads/a.pdf", "user-1", "conv-1")
        mock_s3_sync.assert_any_call("/workdir/uploads/b.docx", "user-1", "conv-1")

        # Verify attachFiles forwarded (not attach_files)
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["attachFiles"] == [
            "/workdir/uploads/a.pdf",
            "/workdir/uploads/b.docx",
        ]
        assert "attach_files" not in sent_params

    async def test_update_agent(self):
        """Update operation routes to update_agent Lambda tool."""
        mock_result = {"status": "success"}

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_agents(
                {
                    "operation": "update",
                    "agent_id": "agt_abc",
                    "title": "Updated Title",
                }
            )

        assert "isError" not in result
        assert mock_invoke.call_args[0][0] == "update_agent"
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["agent_id"] == "agt_abc"
        assert sent_params["title"] == "Updated Title"

    async def test_duplicate_agent(self):
        """Duplicate operation routes to duplicate_agent Lambda tool."""
        mock_result = {"status": "success", "agentId": "agt_copy"}

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_agents(
                {
                    "operation": "duplicate",
                    "agent_id": "agt_original",
                }
            )

        assert "isError" not in result
        assert mock_invoke.call_args[0][0] == "duplicate_agent"

    async def test_invalid_operation_returns_error(self):
        """An invalid operation should return an error listing valid ones."""
        result = await _handle_agents({"operation": "delete"})

        assert result["isError"] is True
        text = result["content"][0]["text"]
        assert "Invalid agents operation" in text
        assert "list" in text

    async def test_missing_operation_returns_error(self):
        """Missing operation should return an error."""
        result = await _handle_agents({})

        assert result["isError"] is True
        assert "Invalid agents operation" in result["content"][0]["text"]

    async def test_agent_tools_not_enabled_returns_error(self, monkeypatch):
        """When create_agent_tool is not in NUMA_ENABLED_TOOLS, dispatcher blocks."""
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps(["memories_tool"]))

        # Must go through the dispatcher — handler no longer checks itself
        result = await numa_tool.handler(
            {
                "name": "agents",
                "params": {"operation": "list"},
                "description": "List agents",
            }
        )

        assert result["isError"] is True
        assert "not enabled" in result["content"][0]["text"]

    async def test_missing_user_sub_returns_error(self, monkeypatch):
        """Missing NUMA_USER_SUB should return an error."""
        monkeypatch.setenv("NUMA_USER_SUB", "")

        result = await _handle_agents({"operation": "list"})

        assert result["isError"] is True
        assert "NUMA_USER_SUB" in result["content"][0]["text"]

    async def test_file_attach_without_conversation_id_returns_error(self, monkeypatch):
        """Attaching files without NUMA_CONVERSATION_ID should return error."""
        monkeypatch.setenv("NUMA_CONVERSATION_ID", "")

        result = await _handle_agents(
            {
                "operation": "create",
                "title": "Agent",
                "systemPrompt": "Prompt",
                "attach_files": ["/workdir/uploads/a.pdf"],
            }
        )

        assert result["isError"] is True
        assert "NUMA_CONVERSATION_ID" in result["content"][0]["text"]

    async def test_none_values_excluded_from_lambda_params(self):
        """None values in params should not be forwarded to Lambda."""
        mock_result = {"status": "success"}

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_agents(
                {
                    "operation": "create",
                    "title": "Agent",
                    "systemPrompt": "Prompt",
                    "description": None,
                }
            )

        assert "isError" not in result
        sent_params = mock_invoke.call_args[0][1]
        assert "description" not in sent_params

    async def test_enabled_tools_forwarded_to_lambda(self):
        """NUMA_ENABLED_TOOLS should be passed as extra_event_fields."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"agents": []},
        ) as mock_invoke:
            await _handle_agents({"operation": "list"})

        extra = mock_invoke.call_args[1].get("extra_event_fields", {})
        assert "create_agent_tool" in extra["allowed_tools"]


# ---------------------------------------------------------------------------
# _handle_memories
# ---------------------------------------------------------------------------


class TestHandleMemories:
    """Tests for _handle_memories handler."""

    @pytest.fixture(autouse=True)
    def memories_env(self, monkeypatch):
        """Set environment variables for memory operations."""
        monkeypatch.setenv("NUMA_USER_SUB", "user-1")
        monkeypatch.setenv(
            "NUMA_ENABLED_TOOLS",
            json.dumps(["memories_tool", "create_agent_tool"]),
        )

    async def test_list_memories(self):
        """List operation routes to user_profile_list_memories."""
        mock_result = {
            "memories": [
                {"id": "mem_1", "content": "Prefers dark mode", "scope": "general"},
            ],
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_memories({"operation": "list"})

        assert "isError" not in result
        parsed = json.loads(result["content"][0]["text"])
        assert len(parsed["memories"]) == 1

        assert mock_invoke.call_args[0][0] == "user_profile_list_memories"

    async def test_list_memories_with_scope(self):
        """List with scope filter forwards scope param."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"memories": []},
        ) as mock_invoke:
            await _handle_memories({"operation": "list", "scope": "integration:jira"})

        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["scope"] == "integration:jira"

    async def test_add_memory(self):
        """Add operation routes to user_profile_add_memory."""
        mock_result = {
            "id": "mem_new",
            "content": "Prefers concise responses",
            "scope": "general",
        }

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_memories(
                {
                    "operation": "add",
                    "content": "Prefers concise responses",
                    "scope": "general",
                }
            )

        assert "isError" not in result
        assert mock_invoke.call_args[0][0] == "user_profile_add_memory"
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["content"] == "Prefers concise responses"
        assert sent_params["scope"] == "general"

    async def test_update_memory(self):
        """Update operation routes to user_profile_update_memory."""
        mock_result = {"status": "success"}

        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ) as mock_invoke:
            result = await _handle_memories(
                {
                    "operation": "update",
                    "memory_id": "mem_abc123",
                    "content": "Updated preference",
                }
            )

        assert "isError" not in result
        assert mock_invoke.call_args[0][0] == "user_profile_update_memory"
        sent_params = mock_invoke.call_args[0][1]
        assert sent_params["memory_id"] == "mem_abc123"
        assert sent_params["content"] == "Updated preference"

    async def test_invalid_operation_returns_error(self):
        """Invalid operation returns error with valid operations listed."""
        result = await _handle_memories({"operation": "delete"})

        assert result["isError"] is True
        text = result["content"][0]["text"]
        assert "Invalid memories operation" in text
        assert "list" in text

    async def test_missing_operation_returns_error(self):
        """Missing operation returns error."""
        result = await _handle_memories({})

        assert result["isError"] is True
        assert "Invalid memories operation" in result["content"][0]["text"]

    async def test_memories_not_enabled_returns_error(self, monkeypatch):
        """When memories_tool is not in NUMA_ENABLED_TOOLS, dispatcher blocks."""
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps(["create_agent_tool"]))

        # Must go through the dispatcher — handler no longer checks itself
        result = await numa_tool.handler(
            {
                "name": "memories",
                "params": {"operation": "list"},
                "description": "List memories",
            }
        )

        assert result["isError"] is True
        assert "not enabled" in result["content"][0]["text"]

    async def test_missing_user_sub_returns_error(self, monkeypatch):
        """Missing NUMA_USER_SUB should return error."""
        monkeypatch.setenv("NUMA_USER_SUB", "")

        result = await _handle_memories({"operation": "list"})

        assert result["isError"] is True
        assert "NUMA_USER_SUB" in result["content"][0]["text"]

    async def test_enabled_tools_forwarded_to_lambda(self):
        """NUMA_ENABLED_TOOLS should be passed as extra_event_fields."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"memories": []},
        ) as mock_invoke:
            await _handle_memories({"operation": "list"})

        extra = mock_invoke.call_args[1].get("extra_event_fields", {})
        assert "memories_tool" in extra["allowed_tools"]

    async def test_none_values_excluded_from_lambda_params(self):
        """None values in params should not be forwarded to Lambda."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"memories": []},
        ) as mock_invoke:
            await _handle_memories(
                {
                    "operation": "list",
                    "scope": None,
                }
            )

        sent_params = mock_invoke.call_args[0][1]
        assert "scope" not in sent_params


# ---------------------------------------------------------------------------
# _handle_render
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestHandleRender:
    """Tests for _handle_render handler — focused on type inference fallback."""

    async def test_missing_content_and_file_path_returns_error(self):
        result = await _handle_render({"type": "html"})
        assert result["isError"] is True
        assert "content" in result["content"][0]["text"]

    async def test_invalid_type_with_no_signal_errors(self):
        # No file_path and content that doesn't look like HTML.
        result = await _handle_render({"content": "just some text", "type": None})
        assert result["isError"] is True
        assert "type" in result["content"][0]["text"]

    @pytest.mark.parametrize("ext", [".html", ".htm", ".svg"])
    async def test_type_inferred_from_html_extensions(self, tmp_path, ext):
        f = tmp_path / f"workdir-stub{ext}"
        # _handle_render only reads files under /workdir/, but type inference
        # happens before the realpath check — so an error here means inference
        # succeeded (it accepted the type and tried to read the file).
        result = await _handle_render({"file_path": str(f)})
        text = result["content"][0]["text"]
        assert "must be 'html' or 'image'" not in text

    @pytest.mark.parametrize("ext", [".png", ".jpg", ".jpeg", ".gif", ".webp"])
    async def test_type_inferred_from_image_extensions(self, tmp_path, ext):
        f = tmp_path / f"workdir-stub{ext}"
        result = await _handle_render({"file_path": str(f)})
        text = result["content"][0]["text"]
        assert "must be 'html' or 'image'" not in text

    async def test_type_inferred_from_html_content(self):
        # Content starting with <!DOCTYPE should be detected as html. The render
        # path for inline content under 2MB should succeed.
        result = await _handle_render(
            {"content": "<!DOCTYPE html><html><body>hi</body></html>"}
        )
        assert "isError" not in result or not result["isError"]
        payload = json.loads(result["content"][0]["text"])
        assert payload["render_type"] == "html"

    async def test_explicit_type_still_wins(self, tmp_path):
        # If `type` is provided correctly it should be honoured, not overwritten.
        result = await _handle_render({"type": "html", "content": "<div>ok</div>"})
        payload = json.loads(result["content"][0]["text"])
        assert payload["render_type"] == "html"


# ---------------------------------------------------------------------------
# fetch_url binary_file propagation
# ---------------------------------------------------------------------------


class TestFetchUrlBinary:
    """fetch_url binary (S3-reference) result handling in _handle_web_search."""

    async def test_binary_file_with_download_url_delivered_to_workspace(self):
        """When browser-lambda supplies a presigned download_url, the bytes are
        streamed into the workspace (/workdir/uploads/web/...) and an
        output_path is returned. The real download is mocked so no /workdir
        writes happen; we assert the dest path + URL passed to the downloader."""
        mock_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_type": "",
            "file_size": 4242,
            "download_url": "https://signed.example/get?sig=abc",
        }

        captured: dict[str, str] = {}

        def _fake_download(
            url: str, dest: str, *, expected_sha256: str | None = None
        ) -> int:
            captured["url"] = url
            captured["dest"] = dest
            return 18  # don't touch the real /workdir filesystem

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._save_fetch_url_to_file"
            ) as save_mock,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._atomic_download_url",
                side_effect=_fake_download,
            ),
        ):
            result = await _handle_web_search(
                {"operation": "fetch_url", "url": "https://example.com/report"}
            )

        # Text save path is never used for binaries
        save_mock.assert_not_called()
        assert "isError" not in result
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "success"
        assert payload["result_type"] == "binary_file"
        assert payload["content_type"] == "application/pdf"
        assert payload["s3_key"] == mock_result["s3_key"]
        # Critical: the file is delivered under /workdir/uploads/web/, filename
        # derived from the URL basename.
        assert payload["output_path"] == "/workdir/uploads/web/report"
        assert captured["url"] == "https://signed.example/get?sig=abc"
        assert captured["dest"] == "/workdir/uploads/web/report"
        assert "content" not in payload

    async def test_binary_file_download_filename_falls_back_to_s3_key(self):
        """Extensionless URL with no path basename → filename from s3_key
        basename; the path-guard still keeps it under /workdir/uploads/."""
        mock_result = {
            "url": "https://example.com/",  # no basename in the URL path
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/zip",
            "s3_key": "documents/company/web-crawler/example.com/archive-bundle",
            "file_size": 10,
            "download_url": "https://signed.example/get?sig=zip",
        }

        captured: dict[str, str] = {}

        def _fake_download(
            url: str, dest: str, *, expected_sha256: str | None = None
        ) -> int:
            captured["dest"] = dest
            return 10

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._atomic_download_url",
                side_effect=_fake_download,
            ),
        ):
            result = await _handle_web_search(
                {"operation": "fetch_url", "url": "https://example.com/"}
            )

        payload = json.loads(result["content"][0]["text"])
        assert payload["output_path"] == "/workdir/uploads/web/archive-bundle"
        assert captured["dest"] == "/workdir/uploads/web/archive-bundle"

    async def test_binary_file_without_download_url_falls_back_to_s3_ref(self):
        """Older browser-lambda (no download_url) → surface the S3 reference,
        never decoded/saved as a (corrupt) text file, no workspace download."""
        mock_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_type": "",
            "file_size": 9999,
        }

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._save_fetch_url_to_file"
            ) as save_mock,
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._atomic_download_url"
            ) as dl_mock,
        ):
            result = await _handle_web_search(
                {"operation": "fetch_url", "url": "https://example.com/report"}
            )

        # No download attempted, and no text save-to-file path
        dl_mock.assert_not_called()
        save_mock.assert_not_called()
        assert "isError" not in result
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "success"
        assert payload["result_type"] == "binary_file"
        assert payload["content_type"] == "application/pdf"
        assert payload["s3_key"] == mock_result["s3_key"]
        assert payload["file_size"] == 9999
        assert "output_path" not in payload
        assert "content" not in payload

    async def test_text_fetch_url_still_saves_to_file(self):
        """A normal text page still routes through _save_fetch_url_to_file."""
        mock_result = {
            "url": "https://example.com/page",
            "status": "success",
            "content": "# Title\n\nbody",
            "title": "Title",
            "content_type": "text/markdown",
        }
        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._save_fetch_url_to_file",
                side_effect=lambda r: r,
            ) as save_mock,
        ):
            await _handle_web_search(
                {"operation": "fetch_url", "url": "https://example.com/page"}
            )
        save_mock.assert_called_once()


# ---------------------------------------------------------------------------
# Atomic file write helper
# ---------------------------------------------------------------------------


class TestAtomicWriteBytes:
    def test_writes_file_content(self, tmp_path):
        dest = tmp_path / "out.bin"
        _atomic_write_bytes(dest, b"hello bytes")
        assert dest.read_bytes() == b"hello bytes"

    def test_creates_parent_dirs(self, tmp_path):
        dest = tmp_path / "nested" / "deep" / "out.bin"
        _atomic_write_bytes(dest, b"data")
        assert dest.read_bytes() == b"data"

    def test_overwrites_existing_atomically(self, tmp_path):
        dest = tmp_path / "out.bin"
        dest.write_bytes(b"old content here")
        _atomic_write_bytes(dest, b"new")
        assert dest.read_bytes() == b"new"

    def test_no_temp_files_left_behind(self, tmp_path):
        dest = tmp_path / "out.bin"
        _atomic_write_bytes(dest, b"x")
        # Only the destination file should remain -- no .tmp leftovers
        leftovers = [p.name for p in tmp_path.iterdir() if p.name != "out.bin"]
        assert leftovers == []

    def test_failure_does_not_corrupt_existing_and_cleans_temp(self, tmp_path):
        import os

        dest = tmp_path / "out.bin"
        dest.write_bytes(b"original")

        # Make os.replace fail to simulate a mid-swap error.
        with patch.object(os, "replace", side_effect=OSError("boom")):
            with pytest.raises(OSError):
                _atomic_write_bytes(dest, b"replacement")

        # Original is untouched (atomicity) and no temp file remains.
        assert dest.read_bytes() == b"original"
        leftovers = [p.name for p in tmp_path.iterdir() if p.name != "out.bin"]
        assert leftovers == []


# ---------------------------------------------------------------------------
# Atomic URL download helper (web-fetched binary delivery)
# ---------------------------------------------------------------------------


class _FakeURLResponse:
    """Minimal urlopen() context manager yielding *body* in chunks."""

    def __init__(self, body: bytes):
        self._body = body
        self._pos = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            chunk, self._pos = self._body[self._pos :], len(self._body)
            return chunk
        chunk = self._body[self._pos : self._pos + n]
        self._pos += len(chunk)
        return chunk


class TestAtomicDownloadUrl:
    def test_streams_url_to_dest(self, tmp_path):
        dest = tmp_path / "sub" / "file.pdf"
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(b"%PDF-1.7 body bytes"),
        ):
            written = _atomic_download_url("https://signed/get", str(dest))
        assert written == len(b"%PDF-1.7 body bytes")
        assert dest.read_bytes() == b"%PDF-1.7 body bytes"
        # No leftover .part- temp files
        leftovers = [
            p.name for p in (tmp_path / "sub").iterdir() if p.name != "file.pdf"
        ]
        assert leftovers == []

    def test_failure_cleans_temp_and_raises(self, tmp_path):
        dest = tmp_path / "file.bin"
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            side_effect=OSError("network boom"),
        ):
            with pytest.raises(OSError):
                _atomic_download_url("https://signed/get", str(dest))
        assert not dest.exists()
        leftovers = [p.name for p in tmp_path.iterdir()]
        assert leftovers == []


# ---------------------------------------------------------------------------
# End-to-end sha256 VERIFICATION — the destination half of the 100% bar
# ---------------------------------------------------------------------------

import hashlib  # noqa: E402

from numa_workspace_agent.mcp_tools.lambda_client import (  # noqa: E402
    OversizedResultIntegrityError,
    resolve_oversized_result,
)
from numa_workspace_agent.mcp_tools.numa_tool import (  # noqa: E402
    BinaryDownloadIntegrityError,
)


class TestAtomicDownloadUrlSha256:
    """_atomic_download_url verifies the producer's download_sha256 over the
    EXACT bytes it streams to disk (the browser-binary path)."""

    def test_matching_sha256_keeps_file(self, tmp_path):
        body = b"%PDF-1.7 verified binary content across chunks" * 3
        sha = hashlib.sha256(body).hexdigest()
        dest = tmp_path / "ok.pdf"
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(body),
        ):
            written = _atomic_download_url(
                "https://signed/get", str(dest), expected_sha256=sha
            )
        assert written == len(body)
        # File on disk is exactly the bytes that were hashed — lossless + verified.
        assert dest.read_bytes() == body
        assert hashlib.sha256(dest.read_bytes()).hexdigest() == sha

    def test_mismatched_sha256_deletes_file_and_raises(self, tmp_path):
        body = b"these are the real bytes"
        wrong_sha = hashlib.sha256(b"different bytes entirely").hexdigest()
        dest = tmp_path / "bad.pdf"
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(body),
        ):
            with pytest.raises(BinaryDownloadIntegrityError):
                _atomic_download_url(
                    "https://signed/get", str(dest), expected_sha256=wrong_sha
                )
        # Never leave unverified/corrupt bytes at the destination.
        assert not dest.exists()
        leftovers = [p.name for p in tmp_path.iterdir()]
        assert leftovers == []

    def test_no_expected_sha_skips_verification(self, tmp_path):
        """Backward-compatible: older browser-lambda omits download_sha256."""
        body = b"unverified but accepted"
        dest = tmp_path / "legacy.bin"
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(body),
        ):
            written = _atomic_download_url("https://signed/get", str(dest))
        assert written == len(body)
        assert dest.read_bytes() == body


class TestDeliverBinaryFetchUrlSha256:
    """_deliver_binary_fetch_url forwards download_sha256 to the verifier and
    surfaces the verified flag; a mismatch is reported as an error (S3 ref
    retained), never a silently-corrupt workspace file."""

    async def test_download_sha256_forwarded_and_surfaced(self):
        body = b"binary report bytes"
        sha = hashlib.sha256(body).hexdigest()
        mock_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_size": len(body),
            "download_url": "https://signed.example/get?sig=abc",
            "download_sha256": sha,
        }
        captured: dict[str, object] = {}

        def _fake_download(
            url: str, dest: str, *, expected_sha256: str | None = None
        ) -> int:
            captured["expected_sha256"] = expected_sha256
            captured["dest"] = dest
            return len(body)

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._atomic_download_url",
                side_effect=_fake_download,
            ),
        ):
            result = await _handle_web_search(
                {"operation": "fetch_url", "url": "https://example.com/report"}
            )
        # The producer's digest reaches the verifying downloader.
        assert captured["expected_sha256"] == sha
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "success"
        assert payload["download_sha256"] == sha
        assert payload["sha256_verified"] is True

    async def test_sha256_mismatch_reports_error_and_retains_s3_ref(self):
        mock_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_size": 10,
            "download_url": "https://signed.example/get?sig=abc",
            "download_sha256": "deadbeef" * 8,
        }

        def _boom(url: str, dest: str, *, expected_sha256: str | None = None) -> int:
            raise BinaryDownloadIntegrityError("sha256 mismatch")

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool._atomic_download_url",
                side_effect=_boom,
            ),
        ):
            result = await _handle_web_search(
                {"operation": "fetch_url", "url": "https://example.com/report"}
            )
        # Hard-fail surfaces as an error; S3 ref is retained so bytes aren't lost.
        assert result.get("isError") is True
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "error"
        assert payload["s3_key"] == mock_result["s3_key"]


class TestResolveOversizedResult:
    """resolve_oversized_result downloads, sha256-VERIFIES, and parses the FULL
    spilled result losslessly — the structured-result half of the 100% bar."""

    @staticmethod
    def _full_result() -> dict:
        # A result that would blow the 6 MB inline cap — every item must survive.
        return {
            "status": "success",
            "results": [
                {"id": i, "text": "x" * 1000, "chunk": "y" * 500} for i in range(2000)
            ],
            "summarised_content": "z" * 50000,
            "total_results_count": 2000,
        }

    def _envelope(self, body: bytes, *, sha: str | None = None, size=None) -> dict:
        return {
            "status": "success",
            "oversized": True,
            "result_url": "https://signed.example/result.json?sig=x",
            "result_sha256": (
                sha if sha is not None else hashlib.sha256(body).hexdigest()
            ),
            "result_size": size if size is not None else len(body),
            "note": "oversized; fetch result_url",
        }

    def test_lossless_roundtrip_verified(self):
        full = self._full_result()
        body = json.dumps(full, default=str).encode("utf-8")
        env = self._envelope(body)
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(body),
        ):
            resolved = resolve_oversized_result(env)
        # COMPLETE result, nothing dropped or truncated.
        assert resolved == full
        assert len(resolved["results"]) == 2000
        assert resolved["results"][1999]["text"] == "x" * 1000
        assert "truncated" not in json.dumps(resolved)

    def test_sha256_mismatch_hard_fails(self):
        body = json.dumps({"a": 1}).encode("utf-8")
        env = self._envelope(body, sha="00" * 32)  # deliberately wrong
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(body),
        ):
            with pytest.raises(OversizedResultIntegrityError) as ei:
                resolve_oversized_result(env)
        assert "sha256" in str(ei.value).lower()

    def test_size_mismatch_hard_fails(self):
        body = json.dumps({"a": 1}).encode("utf-8")
        # Correct sha but wrong declared size → still refuse (possible truncation).
        env = self._envelope(body, size=len(body) + 99)
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(body),
        ):
            with pytest.raises(OversizedResultIntegrityError) as ei:
                resolve_oversized_result(env)
        assert "size" in str(ei.value).lower()

    def test_missing_fields_hard_fails(self):
        env = {"status": "success", "oversized": True, "result_url": "https://x"}
        # No result_sha256 → cannot verify → refuse rather than trust bytes.
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            return_value=_FakeURLResponse(b"{}"),
        ):
            with pytest.raises(OversizedResultIntegrityError):
                resolve_oversized_result(env)

    def test_non_oversized_passes_through_unchanged(self):
        """Backward-compatible: an inline result is returned as-is, no fetch."""
        inline = {"status": "success", "results": [1, 2, 3]}
        with patch(
            "numa_workspace_agent.atomic_io.urllib.request.urlopen",
            side_effect=AssertionError("must not fetch for inline results"),
        ):
            assert resolve_oversized_result(inline) is inline

    def test_oversized_false_passes_through(self):
        inline = {"status": "success", "oversized": False, "data": "ok"}
        assert resolve_oversized_result(inline) is inline


class TestInvokeWorkspaceToolResolvesOversized:
    """invoke_workspace_tool transparently resolves the oversized envelope so
    every KB/extract/list handler receives the COMPLETE, verified result."""

    def test_oversized_envelope_resolved_end_to_end(self, monkeypatch):
        from numa_workspace_agent.mcp_tools import lambda_client

        monkeypatch.setenv("WORKSPACE_TOOLS_LAMBDA_NAME", "wct")
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", "[]")

        full = {"status": "success", "listings": {"kb1": {"files": ["a", "b"]}}}
        body = json.dumps(full, default=str).encode("utf-8")
        envelope = {
            "status": "success",
            "oversized": True,
            "result_url": "https://signed/result.json",
            "result_sha256": hashlib.sha256(body).hexdigest(),
            "result_size": len(body),
            "note": "n",
        }
        lambda_response = {"status": "success", "result": envelope}

        class _Payload:
            def read(self):
                return json.dumps(lambda_response).encode("utf-8")

        mock_client = MagicMock()
        mock_client.invoke.return_value = {"Payload": _Payload()}
        mock_session = MagicMock()
        mock_session.client.return_value = mock_client

        with (
            (
                patch.object(lambda_client.boto3, "Session", return_value=mock_session)
                if hasattr(lambda_client, "boto3")
                else patch("boto3.Session", return_value=mock_session)
            ),
            patch(
                "numa_workspace_agent.atomic_io.urllib.request.urlopen",
                return_value=_FakeURLResponse(body),
            ),
        ):
            resolved = lambda_client.invoke_workspace_tool("list_kb_files", {})

        # The handler sees the COMPLETE result, not the envelope.
        assert resolved == full
        assert "oversized" not in resolved
        assert resolved["listings"]["kb1"]["files"] == ["a", "b"]


class TestKbDownloadSha256Verification:
    """_handle_kb_download re-hashes the downloaded bytes and hard-fails on a
    mismatch (both the base64 and presigned paths)."""

    def setup_method(self):
        import os

        os.environ["NUMA_ALLOWED_KBS"] = "[]"
        os.environ["NUMA_USER_SUB"] = "user-1"

    async def test_base64_verified_and_surfaced(self, tmp_path):
        content = b"kb file contents"
        sha = hashlib.sha256(content).hexdigest()
        mock_result = {
            "filename": "doc.pdf",
            "content_base64": base64.b64encode(content).decode(),
            "download_sha256": sha,
            "s3_uri": "s3://bucket/doc.pdf",
        }
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download(
                {"file": "doc.pdf", "output_dir": str(tmp_path)}
            )
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "success"
        assert payload["sha256_verified"] is True
        assert payload["download_sha256"] == sha
        assert (tmp_path / "doc.pdf").read_bytes() == content

    async def test_base64_mismatch_hard_fails_no_write(self, tmp_path):
        content = b"kb file contents"
        mock_result = {
            "filename": "doc.pdf",
            "content_base64": base64.b64encode(content).decode(),
            "download_sha256": "ab" * 32,  # wrong
            "s3_uri": "s3://bucket/doc.pdf",
        }
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download(
                {"file": "doc.pdf", "output_dir": str(tmp_path)}
            )
        assert result.get("isError") is True
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "error"
        # Nothing unverified written to disk.
        assert not (tmp_path / "doc.pdf").exists()

    async def test_presigned_verified(self, tmp_path):
        content = b"large kb file via presigned url"
        sha = hashlib.sha256(content).hexdigest()
        mock_result = {
            "filename": "big.pdf",
            "presigned_url": "https://signed/get",
            "size_bytes": len(content),
            "download_sha256": sha,
            "s3_uri": "s3://bucket/big.pdf",
        }

        def _fake_presigned_dl(url, dest_path, expected_size=0):
            Path(dest_path).write_bytes(content)
            return len(content)

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                side_effect=_fake_presigned_dl,
            ),
        ):
            result = await _handle_kb_download(
                {"file": "big.pdf", "output_dir": str(tmp_path)}
            )
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "success"
        assert payload["sha256_verified"] is True
        assert (tmp_path / "big.pdf").read_bytes() == content

    async def test_presigned_mismatch_deletes_and_errors(self, tmp_path):
        content = b"corrupted-on-arrival"
        mock_result = {
            "filename": "big.pdf",
            "presigned_url": "https://signed/get",
            "size_bytes": len(content),
            "download_sha256": "cd" * 32,  # wrong
            "s3_uri": "s3://bucket/big.pdf",
        }

        def _fake_presigned_dl(url, dest_path, expected_size=0):
            Path(dest_path).write_bytes(content)
            return len(content)

        with (
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
                return_value=mock_result,
            ),
            patch(
                "numa_workspace_agent.mcp_tools.numa_tool.download_from_presigned_url",
                side_effect=_fake_presigned_dl,
            ),
        ):
            result = await _handle_kb_download(
                {"file": "big.pdf", "output_dir": str(tmp_path)}
            )
        assert result.get("isError") is True
        # Corrupt file deleted — no unverified bytes left behind.
        assert not (tmp_path / "big.pdf").exists()

    async def test_legacy_no_sha_still_succeeds(self, tmp_path):
        """Backward-compatible: older Lambda omits download_sha256."""
        content = b"legacy kb file"
        mock_result = {
            "filename": "old.pdf",
            "content_base64": base64.b64encode(content).decode(),
            "s3_uri": "s3://bucket/old.pdf",
        }
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value=mock_result,
        ):
            result = await _handle_kb_download(
                {"file": "old.pdf", "output_dir": str(tmp_path)}
            )
        payload = json.loads(result["content"][0]["text"])
        assert payload["status"] == "success"
        assert "sha256_verified" not in payload
        assert (tmp_path / "old.pdf").read_bytes() == content
