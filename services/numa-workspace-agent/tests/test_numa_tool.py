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
    _OPERATION_TO_ENABLED_TOOL_KEY,
    MAX_UPLOAD_SIZE,
    TOOL_HANDLERS,
    TOOL_NAMES,
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
        result = _err("bad thing happened")
        assert result == {
            "content": [{"type": "text", "text": "bad thing happened"}],
            "isError": True,
        }

    def test_ok_does_not_have_error_flag(self):
        result = _ok("fine")
        assert "isError" not in result


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
        """Layer 2 blocks knowledge_base when not in enabledTools."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        result = _check_operation_allowed("knowledge_base")
        assert result is not None
        assert "Knowledge base" in result

    def test_unmapped_ops_bypass_frontend_toggle(self, monkeypatch):
        """Operations not in _OPERATION_TO_ENABLED_TOOL_KEY bypass frontend checks."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        # Only extract_content and convert_document have no frontend toggle
        for op in ["extract_content", "convert_document"]:
            assert (
                _check_operation_allowed(op) is None
            ), f"{op} should bypass frontend toggle"

    def test_layer2_blocks_kb_operations_when_toggle_off(self, monkeypatch):
        """knowledge_base is blocked when query_knowledge_base not in enabledTools."""
        monkeypatch.delenv("NUMA_ALLOWED_OPERATIONS", raising=False)
        monkeypatch.setenv("NUMA_ENABLED_TOOLS", json.dumps([]))

        result = _check_operation_allowed("knowledge_base")
        assert (
            result is not None
        ), "knowledge_base should be blocked when KB not enabled"
        assert "Knowledge base" in result

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


class TestOperationToEnabledToolKeyMapping:
    """Tests for the _OPERATION_TO_ENABLED_TOOL_KEY mapping."""

    def test_mapped_operations_have_correct_keys(self):
        """Verify the mapping matches what the frontend sends."""
        assert (
            _OPERATION_TO_ENABLED_TOOL_KEY["knowledge_base"] == "query_knowledge_base"
        )
        assert _OPERATION_TO_ENABLED_TOOL_KEY["web_search"] == "web_search"
        assert _OPERATION_TO_ENABLED_TOOL_KEY["agents"] == "create_agent_tool"
        assert _OPERATION_TO_ENABLED_TOOL_KEY["memories"] == "memories_tool"

    def test_kb_toggle_maps_to_query_knowledge_base(self):
        """The knowledge_base tool maps to the query_knowledge_base frontend toggle."""
        assert (
            _OPERATION_TO_ENABLED_TOOL_KEY["knowledge_base"] == "query_knowledge_base"
        ), "knowledge_base should map to query_knowledge_base toggle"

    def test_utility_operations_are_not_mapped(self):
        """Pure utility operations should not have frontend toggles."""
        for op in ["extract_content", "convert_document"]:
            assert (
                op not in _OPERATION_TO_ENABLED_TOOL_KEY
            ), f"{op} should not be in the mapping (no frontend toggle)"


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
        """An invalid operation should return an error listing valid operations."""
        result = await _handle_knowledge_base({"operation": "delete"})

        assert result["isError"] is True
        text = result["content"][0]["text"]
        assert "Invalid knowledge_base operation" in text
        assert "query" in text

    async def test_missing_operation_returns_error(self):
        """Missing operation should return an error."""
        result = await _handle_knowledge_base({})

        assert result["isError"] is True
        assert "Invalid knowledge_base operation" in result["content"][0]["text"]

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

    async def test_missing_user_intent_returns_error(self):
        """Missing 'user_intent' returns an error."""
        result = await _handle_web_search({"query": "test"})
        assert result["isError"] is True

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

    async def test_default_max_results_is_3(self):
        """When max_results is not provided, default should be 3."""
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
        assert sent_params["max_results"] == 3


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
            result = await _handle_kb_upload({"file": str(test_file)})

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

    async def test_file_too_large_returns_error(self, tmp_path):
        """File exceeding MAX_UPLOAD_SIZE returns an error."""
        big_file = tmp_path / "big.bin"
        # Write just over 4 MB
        big_file.write_bytes(b"x" * (MAX_UPLOAD_SIZE + 1))

        result = await _handle_kb_upload({"file": str(big_file)})

        assert result["isError"] is True
        assert "too large" in result["content"][0]["text"].lower()
        assert "4 MB" in result["content"][0]["text"]

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
        """Allowed KB IDs are passed as extra_event_fields."""
        with patch(
            "numa_workspace_agent.mcp_tools.numa_tool.invoke_workspace_tool",
            return_value={"files": []},
        ) as mock_invoke:
            await _handle_kb_list({})

        extra = mock_invoke.call_args[1].get("extra_event_fields", {})
        assert extra["allowed_kbs"] == ["kb-1"]


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
