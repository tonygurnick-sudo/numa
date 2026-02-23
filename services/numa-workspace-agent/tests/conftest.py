"""
Shared test fixtures for numa-workspace-agent tests.

Provides mock agent types, registry cleanup, and mock SDK functions
so tests can exercise the agent type system without real Bedrock calls.
"""

import pytest
from numa_workspace_agent.agent_types.base import AgentTypeConfig
from numa_workspace_agent.agent_types.registry import _registry, register_agent_type


@pytest.fixture(autouse=True)
def clean_registry():
    """Save and restore the registry around each test.

    Tests can freely register/overwrite types without contaminating
    other tests. The built-in types (numa-chat, research-agent,
    document-summariser) are restored after each test.
    """
    saved = dict(_registry)
    yield
    _registry.clear()
    _registry.update(saved)


@pytest.fixture
def mock_chat_type() -> AgentTypeConfig:
    """A minimal 'mock-chat' type for testing."""
    config = AgentTypeConfig(
        type_id="mock-chat",
        display_name="Mock Chat",
        response_mode="stream",
        tools=["Read", "Write"],
        allowed_tools=["Read", "Write"],
        enable_scripts_mcp=False,
        enable_integrations_mcp=False,
        enabled_numa_tools=[],
        tools_source_dirs=[],
        max_turns=5,
    )
    register_agent_type(config)
    return config


@pytest.fixture
def mock_sync_type() -> AgentTypeConfig:
    """A minimal 'mock-sync' type for testing sync response mode."""
    config = AgentTypeConfig(
        type_id="mock-sync",
        display_name="Mock Sync",
        response_mode="sync",
        tools=["Read"],
        allowed_tools=["Read"],
        enable_scripts_mcp=False,
        enable_integrations_mcp=False,
        enabled_numa_tools=[],
        tools_source_dirs=[],
        pipeline_result_mode="result_file",
        max_turns=3,
    )
    register_agent_type(config)
    return config


@pytest.fixture
def mock_pipeline_step_a() -> AgentTypeConfig:
    """Pipeline step A — a simple step type."""
    config = AgentTypeConfig(
        type_id="step-a",
        display_name="Step A",
        response_mode="sync",
        tools=["Read"],
        allowed_tools=["Read"],
        enable_scripts_mcp=False,
        enable_integrations_mcp=False,
        enabled_numa_tools=[],
        tools_source_dirs=[],
        max_turns=5,
    )
    register_agent_type(config)
    return config


@pytest.fixture
def mock_pipeline_step_b() -> AgentTypeConfig:
    """Pipeline step B — a simple step type."""
    config = AgentTypeConfig(
        type_id="step-b",
        display_name="Step B",
        response_mode="sync",
        tools=["Read", "Write"],
        allowed_tools=["Read", "Write"],
        enable_scripts_mcp=False,
        enable_integrations_mcp=False,
        enabled_numa_tools=[],
        tools_source_dirs=[],
        max_turns=5,
    )
    register_agent_type(config)
    return config


@pytest.fixture
def mock_pipeline_type(mock_pipeline_step_a, mock_pipeline_step_b) -> AgentTypeConfig:
    """A pipeline type with two steps (step-a → step-b)."""
    config = AgentTypeConfig(
        type_id="mock-pipeline",
        display_name="Mock Pipeline",
        response_mode="sync",
        tools=[],
        allowed_tools=[],
        enable_scripts_mcp=False,
        enable_integrations_mcp=False,
        enabled_numa_tools=[],
        tools_source_dirs=[],
        pipeline_steps=["step-a", "step-b"],
        pipeline_result_mode="last_step_text",
        max_turns=10,
    )
    register_agent_type(config)
    return config


def make_sdk_result(
    text: str = "mock response",
    status: str = "completed",
    num_turns: int = 1,
    cost: float = 0.01,
    duration_ms: int = 1000,
) -> dict:
    """Create a mock run_claude_sdk() result dict."""
    return {
        "status": status,
        "text": text,
        "artifacts": [],
        "usage": {
            "num_turns": num_turns,
            "total_cost_usd": cost,
            "duration_ms": duration_ms,
        },
        "session_id": "mock-session-id",
    }
