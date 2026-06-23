"""Tests for the flag-gated platform default model (FEAT-247).

When WORKSPACE_CHAT_MODEL_SELECTION is on for the client, the everyday default
model — used when neither the request nor the agent/type config sets one —
becomes the Numa Standard Model (cheap tier) instead of DEFAULT_MODEL (Premium).
An explicit per-request model or an agent-type default_model always wins; this
only affects the final fallback in the resolution chain.
"""

import pytest
from numa_workspace_agent import sdk_config


def test_platform_default_is_anthropic_when_flag_off(monkeypatch):
    monkeypatch.setattr(sdk_config, "WORKSPACE_CHAT_MODEL_SELECTION", False)
    assert sdk_config.platform_default_model() == sdk_config.DEFAULT_MODEL


def test_platform_default_is_standard_when_flag_on(monkeypatch):
    monkeypatch.setattr(sdk_config, "WORKSPACE_CHAT_MODEL_SELECTION", True)
    assert sdk_config.platform_default_model() == sdk_config.NUMA_STANDARD_MODEL_ID


def test_flag_parsed_truthy_only_for_literal_true(monkeypatch):
    # The construct emits the string 'true' only when the per-client flag is on;
    # any other value (unset, '', 'false', '1') must read as off.
    import importlib

    for value, expected in [
        ("true", True),
        ("TRUE", True),
        ("false", False),
        ("1", False),
        ("", False),
    ]:
        monkeypatch.setenv("WORKSPACE_CHAT_MODEL_SELECTION", value)
        reloaded = importlib.reload(sdk_config)
        assert reloaded.WORKSPACE_CHAT_MODEL_SELECTION is expected, value

    # Restore the module to its unset state so later tests see a clean import.
    monkeypatch.delenv("WORKSPACE_CHAT_MODEL_SELECTION", raising=False)
    importlib.reload(sdk_config)


@pytest.mark.parametrize(
    "request_model,type_default,flag_on,expected_is_standard",
    [
        # Explicit request model always wins over the flag default.
        ("anthropic.claude-sonnet-4-6", None, True, False),
        # Agent-type default_model wins over the flag default.
        (None, "anthropic.claude-opus-4-6-v1", True, False),
        # No request, no type default, flag on → Standard.
        (None, None, True, True),
        # No request, no type default, flag off → not Standard (DEFAULT_MODEL).
        (None, None, False, False),
    ],
)
def test_resolution_precedence(
    monkeypatch, request_model, type_default, flag_on, expected_is_standard
):
    """Mirror the resolution chain used in create_agent_options / sdk_runner:
    request override > type default > platform_default_model()."""
    monkeypatch.setattr(sdk_config, "WORKSPACE_CHAT_MODEL_SELECTION", flag_on)
    raw_model = request_model or type_default or sdk_config.platform_default_model()
    is_standard = raw_model == sdk_config.NUMA_STANDARD_MODEL_ID
    assert is_standard is expected_is_standard
