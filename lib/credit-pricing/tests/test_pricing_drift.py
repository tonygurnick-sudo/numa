"""Drift guard: the credit-pricing lib table MUST equal the workspace agent's copy.

The agent can't import this lib (Docker build context = service dir), so its
``ANTHROPIC_MODEL_PRICING`` is a separate copy. This test AST-reads that copy (without importing
the agent module — which would pull in claude_agent_sdk) and asserts the two tables are identical.
Change a rate or add a model in one place and this fails until the other is mirrored.

Runnable two ways:
    python3 lib/credit-pricing/tests/test_pricing_drift.py    # standalone
    pytest                                                    # CI
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

# Make `credit_pricing` importable whether run via pytest or standalone.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from credit_pricing.pricing import ANTHROPIC_MODEL_PRICING as LIB_PRICING  # noqa: E402
from credit_pricing.pricing import (
    recalculate_anthropic_cost,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT_SDK_CONFIG = (
    REPO_ROOT / "services/numa-workspace-agent/numa_workspace_agent/sdk_config.py"
)


def _extract_agent_pricing() -> dict:
    """Pull ANTHROPIC_MODEL_PRICING out of the agent's sdk_config.py via AST literal_eval."""
    src = AGENT_SDK_CONFIG.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names, value = [node.target.id], node.value
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = node.value
        else:
            continue
        if "ANTHROPIC_MODEL_PRICING" in names and value is not None:
            return ast.literal_eval(value)
    raise AssertionError("ANTHROPIC_MODEL_PRICING not found in agent sdk_config.py")


def test_pricing_table_matches_agent() -> None:
    assert AGENT_SDK_CONFIG.exists(), f"agent sdk_config not found: {AGENT_SDK_CONFIG}"
    agent = _extract_agent_pricing()
    assert agent == LIB_PRICING, (
        "PRICING DRIFT — lib/credit-pricing and the workspace agent disagree:\n"
        f"  only in agent: {sorted(set(agent) - set(LIB_PRICING))}\n"
        f"  only in lib:   {sorted(set(LIB_PRICING) - set(agent))}\n"
        f"  rate mismatches: {sorted(k for k in set(agent) & set(LIB_PRICING) if agent[k] != LIB_PRICING[k])}"
    )


def test_recompute_sane() -> None:
    # 100K cache-read tokens of Sonnet 4.6 @ $0.30/MTok = $0.03 (standard tier; sub-200K prompt).
    cost = recalculate_anthropic_cost(
        "global.anthropic.claude-sonnet-4-6",
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=100_000,
        cache_creation_tokens=0,
        cache_ttl="1h",
    )
    assert cost is not None and abs(cost - 0.03) < 1e-9, cost
    # 1h cache_write costs more than 5m for the same tokens (the under-report we correct for).
    c1h = recalculate_anthropic_cost(
        "anthropic.claude-sonnet-4-6",
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_tokens=100_000,
        cache_ttl="1h",
    )
    c5m = recalculate_anthropic_cost(
        "anthropic.claude-sonnet-4-6",
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_tokens=100_000,
        cache_ttl="5m",
    )
    assert c1h is not None and c5m is not None and c1h > c5m
    # Unmapped model -> None (caller treats as cost-incomplete / title-only).
    assert (
        recalculate_anthropic_cost(
            "amazon.nova-2-lite",
            input_tokens=1,
            output_tokens=1,
            cache_read_tokens=0,
            cache_creation_tokens=0,
        )
        is None
    )


if __name__ == "__main__":
    test_pricing_table_matches_agent()
    test_recompute_sane()
    print("drift test OK — lib pricing == agent pricing; recompute sane")
