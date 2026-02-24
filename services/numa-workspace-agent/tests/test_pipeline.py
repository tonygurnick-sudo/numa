"""
Tests for the pipeline runner.

Covers validation (min steps, unknown types, circular refs), result
extraction (both modes), and the full run_pipeline() flow with mocked
run_claude_sdk.
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from conftest import make_sdk_result
from numa_workspace_agent.agent_types.base import AgentTypeConfig
from numa_workspace_agent.agent_types.registry import register_agent_type
from numa_workspace_agent.pipeline import (
    RESULT_FILE_PATH,
    _extract_final_result,
    run_pipeline,
    validate_pipeline,
)

# ---------------------------------------------------------------------------
# validate_pipeline()
# ---------------------------------------------------------------------------


class TestValidatePipeline:
    """Tests for validate_pipeline()."""

    def test_valid_pipeline(self, mock_pipeline_step_a, mock_pipeline_step_b):
        error = validate_pipeline(["step-a", "step-b"], "parent")
        assert error is None

    def test_single_step_rejected(self, mock_pipeline_step_a):
        error = validate_pipeline(["step-a"], "parent")
        assert error is not None
        assert "at least 2 steps" in error

    def test_empty_pipeline_rejected(self):
        error = validate_pipeline([], "parent")
        assert error is not None
        assert "at least 2 steps" in error

    def test_unknown_step_type(self, mock_pipeline_step_a):
        error = validate_pipeline(["step-a", "nonexistent-step"], "parent")
        # The unknown type falls back to numa-chat (not a KeyError), so
        # validation passes. This is by design — get_agent_type_config
        # falls back to numa-chat for unknown types.
        # If we want strict validation, we'd need to change get_agent_type_config.
        # For now, just verify it doesn't crash.
        # (If the registry has numa-chat, fallback means no error)
        assert error is None  # Falls back to numa-chat

    def test_circular_reference_self(self, mock_pipeline_step_a, mock_pipeline_step_b):
        """A pipeline that references itself is circular."""
        error = validate_pipeline(
            ["step-a", "step-b"],
            "step-a",  # parent is the same as step-a
        )
        assert error is not None
        assert "Circular" in error

    def test_circular_reference_transitive(self, mock_pipeline_step_a):
        """A step appearing in both the parent and a nested pipeline is detected."""
        # step-b-cycle has nested pipeline_steps that reference step-a,
        # which is also a top-level step. The shared visited set correctly
        # detects this as a potential cycle.
        step_b_with_pipeline = AgentTypeConfig(
            type_id="step-b-cycle",
            display_name="Step B Cycle",
            pipeline_steps=["step-a", "step-a"],  # nested pipeline
        )
        register_agent_type(step_b_with_pipeline)

        error = validate_pipeline(
            ["step-a", "step-b-cycle"],
            "parent-cycle",
        )
        assert error is not None
        assert "Circular" in error

    def test_circular_reference_back_to_root(self, mock_pipeline_step_a):
        """Nested pipeline that references the root pipeline is circular."""
        step_b_refs_root = AgentTypeConfig(
            type_id="step-refs-root",
            display_name="Step Refs Root",
            pipeline_steps=["step-a", "step-a"],
        )
        register_agent_type(step_b_refs_root)

        # Now create a pipeline where a step's nested pipeline references root
        step_back_to_root = AgentTypeConfig(
            type_id="step-back-root",
            display_name="Step Back to Root",
            pipeline_steps=["step-a", "root-pipeline"],
        )
        register_agent_type(step_back_to_root)

        root = AgentTypeConfig(
            type_id="root-pipeline",
            display_name="Root Pipeline",
            pipeline_steps=["step-a", "step-back-root"],
        )
        register_agent_type(root)

        error = validate_pipeline(
            ["step-a", "step-back-root"],
            "root-pipeline",
        )
        assert error is not None
        assert "Circular" in error


# ---------------------------------------------------------------------------
# _extract_final_result()
# ---------------------------------------------------------------------------


class TestExtractFinalResult:
    """Tests for _extract_final_result()."""

    def test_last_step_text_mode(self):
        steps = [
            {"step": "a", "text": "Step A output"},
            {"step": "b", "text": "Step B output"},
        ]
        result = _extract_final_result("last_step_text", steps)
        assert result == "Step B output"

    def test_last_step_text_empty_steps(self):
        result = _extract_final_result("last_step_text", [])
        assert result == ""

    def test_result_file_mode_reads_file(self, tmp_path, monkeypatch):
        """When result.json exists, it should be read and returned as JSON."""
        result_file = tmp_path / "result.json"
        result_data = {"title": "Test", "bullets": ["point 1"]}
        result_file.write_text(json.dumps(result_data))

        monkeypatch.setattr(
            "numa_workspace_agent.pipeline.RESULT_FILE_PATH",
            result_file,
        )

        steps = [{"step": "a", "text": "ignored"}]
        result = _extract_final_result("result_file", steps)

        parsed = json.loads(result)
        assert parsed["title"] == "Test"
        assert parsed["bullets"] == ["point 1"]

    def test_result_file_mode_missing_file_falls_back(self, tmp_path, monkeypatch):
        """When result.json doesn't exist, falls back to last step text."""
        nonexistent = tmp_path / "nonexistent.json"
        monkeypatch.setattr(
            "numa_workspace_agent.pipeline.RESULT_FILE_PATH",
            nonexistent,
        )

        steps = [{"step": "a", "text": "fallback text"}]
        result = _extract_final_result("result_file", steps)
        assert result == "fallback text"

    def test_result_file_mode_invalid_json_falls_back(self, tmp_path, monkeypatch):
        """When result.json has invalid JSON, falls back to last step text."""
        bad_file = tmp_path / "result.json"
        bad_file.write_text("not valid json {{{")

        monkeypatch.setattr(
            "numa_workspace_agent.pipeline.RESULT_FILE_PATH",
            bad_file,
        )

        steps = [{"step": "a", "text": "fallback on bad json"}]
        result = _extract_final_result("result_file", steps)
        assert result == "fallback on bad json"


# ---------------------------------------------------------------------------
# run_pipeline()
# ---------------------------------------------------------------------------


class TestRunPipeline:
    """Tests for run_pipeline() with mocked run_claude_sdk."""

    @pytest.mark.asyncio
    async def test_successful_two_step_pipeline(
        self, mock_pipeline_step_a, mock_pipeline_step_b
    ):
        """Two-step pipeline should run both steps and merge results."""
        mock_sdk = AsyncMock(
            side_effect=[
                make_sdk_result(
                    text="Step A done", num_turns=2, cost=0.02, duration_ms=500
                ),
                make_sdk_result(
                    text="Step B done", num_turns=3, cost=0.03, duration_ms=700
                ),
            ]
        )

        parent = AgentTypeConfig(
            type_id="test-pipeline-parent",
            display_name="Test Pipeline",
            pipeline_steps=["step-a", "step-b"],
            pipeline_result_mode="last_step_text",
        )

        with patch("numa_workspace_agent.pipeline.run_claude_sdk", mock_sdk):
            result = await run_pipeline(
                pipeline_steps=["step-a", "step-b"],
                prompt="test prompt",
                user_sub="user-123",
                conversation_id="conv-456",
                parent_type_config=parent,
            )

        assert result["status"] == "completed"
        assert result["text"] == "Step B done"
        assert result["usage"]["num_turns"] == 5  # 2 + 3
        assert result["usage"]["total_cost_usd"] == pytest.approx(0.05)
        assert result["usage"]["duration_ms"] == 1200  # 500 + 700
        assert len(result["steps"]) == 2
        assert result["steps"][0]["step"] == "step-a"
        assert result["steps"][1]["step"] == "step-b"
        assert mock_sdk.call_count == 2

    @pytest.mark.asyncio
    async def test_pipeline_step_failure_stops_pipeline(
        self, mock_pipeline_step_a, mock_pipeline_step_b
    ):
        """If step 1 returns error status, step 2 should not run."""
        mock_sdk = AsyncMock(
            return_value=make_sdk_result(
                text="step A failed",
                status="error",
                num_turns=1,
            )
        )

        parent = AgentTypeConfig(
            type_id="test-fail-parent",
            display_name="Fail Pipeline",
            pipeline_steps=["step-a", "step-b"],
        )

        with patch("numa_workspace_agent.pipeline.run_claude_sdk", mock_sdk):
            result = await run_pipeline(
                pipeline_steps=["step-a", "step-b"],
                prompt="test",
                user_sub="user",
                conversation_id="conv",
                parent_type_config=parent,
            )

        assert result["status"] == "error"
        assert "step 1" in result["error"].lower() or "Step 1" in result["error"]
        assert mock_sdk.call_count == 1  # Only step A ran

    @pytest.mark.asyncio
    async def test_pipeline_step_exception_stops_pipeline(
        self, mock_pipeline_step_a, mock_pipeline_step_b
    ):
        """If step 1 raises an exception, pipeline should stop with error."""
        mock_sdk = AsyncMock(side_effect=RuntimeError("SDK crashed"))

        parent = AgentTypeConfig(
            type_id="test-exc-parent",
            display_name="Exc Pipeline",
            pipeline_steps=["step-a", "step-b"],
        )

        with patch("numa_workspace_agent.pipeline.run_claude_sdk", mock_sdk):
            result = await run_pipeline(
                pipeline_steps=["step-a", "step-b"],
                prompt="test",
                user_sub="user",
                conversation_id="conv",
                parent_type_config=parent,
            )

        assert result["status"] == "error"
        assert "SDK crashed" in result["error"]

    @pytest.mark.asyncio
    async def test_pipeline_validation_failure(self):
        """Pipeline with <2 steps should return error immediately."""
        parent = AgentTypeConfig(
            type_id="test-bad-parent",
            display_name="Bad Pipeline",
            pipeline_steps=["only-one"],
        )

        result = await run_pipeline(
            pipeline_steps=["only-one"],
            prompt="test",
            user_sub="user",
            conversation_id="conv",
            parent_type_config=parent,
        )

        assert result["status"] == "error"
        assert "at least 2 steps" in result["error"]

    @pytest.mark.asyncio
    async def test_pipeline_workspace_setup_called(
        self, mock_pipeline_step_a, mock_pipeline_step_b
    ):
        """workspace_setup callable should be invoked before steps."""
        setup_called = []

        def mock_setup(user_sub: str, conversation_id: str) -> None:
            setup_called.append((user_sub, conversation_id))

        mock_sdk = AsyncMock(
            side_effect=[
                make_sdk_result(text="A"),
                make_sdk_result(text="B"),
            ]
        )

        parent = AgentTypeConfig(
            type_id="test-setup-parent",
            display_name="Setup Pipeline",
            pipeline_steps=["step-a", "step-b"],
            workspace_setup=mock_setup,
        )

        with patch("numa_workspace_agent.pipeline.run_claude_sdk", mock_sdk):
            result = await run_pipeline(
                pipeline_steps=["step-a", "step-b"],
                prompt="test",
                user_sub="user-sub-123",
                conversation_id="conv-456",
                parent_type_config=parent,
            )

        assert result["status"] == "completed"
        assert len(setup_called) == 1
        assert setup_called[0] == ("user-sub-123", "conv-456")

    @pytest.mark.asyncio
    async def test_pipeline_workspace_setup_failure(
        self, mock_pipeline_step_a, mock_pipeline_step_b
    ):
        """If workspace_setup fails, pipeline should return error."""

        def bad_setup(user_sub: str, conversation_id: str) -> None:
            raise RuntimeError("Setup failed!")

        parent = AgentTypeConfig(
            type_id="test-bad-setup",
            display_name="Bad Setup Pipeline",
            pipeline_steps=["step-a", "step-b"],
            workspace_setup=bad_setup,
        )

        result = await run_pipeline(
            pipeline_steps=["step-a", "step-b"],
            prompt="test",
            user_sub="user",
            conversation_id="conv",
            parent_type_config=parent,
        )

        assert result["status"] == "error"
        assert "Setup failed" in result["error"]

    @pytest.mark.asyncio
    async def test_pipeline_per_step_conversation_ids(
        self, mock_pipeline_step_a, mock_pipeline_step_b
    ):
        """Each step should get a unique conversation ID."""
        mock_sdk = AsyncMock(
            side_effect=[
                make_sdk_result(text="A"),
                make_sdk_result(text="B"),
            ]
        )

        parent = AgentTypeConfig(
            type_id="test-convid-parent",
            display_name="ConvID Pipeline",
            pipeline_steps=["step-a", "step-b"],
        )

        with patch("numa_workspace_agent.pipeline.run_claude_sdk", mock_sdk):
            await run_pipeline(
                pipeline_steps=["step-a", "step-b"],
                prompt="test",
                user_sub="user",
                conversation_id="conv-123",
                parent_type_config=parent,
            )

        # Check the conversation_id passed to each call
        call1_conv_id = mock_sdk.call_args_list[0].kwargs.get(
            "conversation_id",
            (
                mock_sdk.call_args_list[0].args[0]
                if mock_sdk.call_args_list[0].args
                else None
            ),
        )
        call2_conv_id = mock_sdk.call_args_list[1].kwargs.get(
            "conversation_id",
            (
                mock_sdk.call_args_list[1].args[0]
                if mock_sdk.call_args_list[1].args
                else None
            ),
        )
        assert call1_conv_id == "conv-123-step-0"
        assert call2_conv_id == "conv-123-step-1"

    @pytest.mark.asyncio
    async def test_pipeline_result_file_mode(
        self, mock_pipeline_step_a, mock_pipeline_step_b, tmp_path, monkeypatch
    ):
        """Pipeline with result_file mode should read result.json."""
        result_file = tmp_path / "result.json"
        result_data = {"summary": "done", "score": 95}
        result_file.write_text(json.dumps(result_data))

        monkeypatch.setattr(
            "numa_workspace_agent.pipeline.RESULT_FILE_PATH",
            result_file,
        )

        mock_sdk = AsyncMock(
            side_effect=[
                make_sdk_result(text="A"),
                make_sdk_result(text="B"),
            ]
        )

        parent = AgentTypeConfig(
            type_id="test-resultfile-parent",
            display_name="ResultFile Pipeline",
            pipeline_steps=["step-a", "step-b"],
            pipeline_result_mode="result_file",
        )

        with patch("numa_workspace_agent.pipeline.run_claude_sdk", mock_sdk):
            result = await run_pipeline(
                pipeline_steps=["step-a", "step-b"],
                prompt="test",
                user_sub="user",
                conversation_id="conv",
                parent_type_config=parent,
            )

        assert result["status"] == "completed"
        parsed = json.loads(result["text"])
        assert parsed["summary"] == "done"
        assert parsed["score"] == 95
