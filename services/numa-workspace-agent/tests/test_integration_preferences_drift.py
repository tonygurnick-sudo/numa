"""
Drift test for the Pipedream-slug ↔ native-connector-slug overlap map.

This map is duplicated in three places:

* ``infra/config/connectors.ts`` (TypeScript, canonical) — used by the
  schedule runner Lambda and the frontend chat / agent / preflight paths.
* ``numa-frontend/src/Components/Integrations/integrationCatalogHelpers.ts``
  (TypeScript mirror) — used by Settings, the unified Integrations page,
  and the chat sidebar.
* ``numa_workspace_agent/mcp_tools/integration_preferences.py`` (this
  file's module under test) — used by the workspace-agent runtime to
  enforce the admin's ``preferred_method`` choice.

The agent container cannot import TypeScript, so the map has to be hand-
maintained. A missing entry silently disables ``preferred_method``
enforcement for that service — there is no runtime guardrail. This test
parses the canonical TS source as text and asserts the Python copy
matches; it does NOT require a TypeScript toolchain.
"""

from __future__ import annotations

import re
from pathlib import Path

from numa_workspace_agent.mcp_tools.integration_preferences import (
    _CONNECTOR_TO_PIPEDREAM,
    _PIPEDREAM_TO_CONNECTOR,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CANONICAL_TS = _REPO_ROOT / "infra" / "config" / "connectors.ts"


def _parse_canonical_pipedream_to_connector() -> dict[str, str]:
    """Read the canonical TS map by regex.

    We deliberately don't shell out to ``tsc`` or ``node`` — the test must
    run inside the agent's Python venv. Format is tightly controlled:
    a single ``export const PIPEDREAM_TO_CONNECTOR: Record<string,
    NativeConnector> = { ... }`` block where every entry is one
    ``key: 'value',`` line.
    """
    text = _CANONICAL_TS.read_text()
    match = re.search(
        r"export const PIPEDREAM_TO_CONNECTOR[^{]*\{([^}]*)\}",
        text,
        re.DOTALL,
    )
    assert match, (
        "Could not locate PIPEDREAM_TO_CONNECTOR block in "
        f"{_CANONICAL_TS} — has the file layout changed?"
    )
    body = match.group(1)
    pairs: dict[str, str] = {}
    for line in body.splitlines():
        line = line.strip().rstrip(",")
        if not line or line.startswith("//"):
            continue
        # Each line looks like: `gmail: 'gmail'` or `google_drive: 'googledrive'`.
        m = re.match(r"([A-Za-z_][\w-]*)\s*:\s*['\"]([\w-]+)['\"]", line)
        if not m:
            continue
        pairs[m.group(1)] = m.group(2)
    assert pairs, f"Parsed zero pairs from {_CANONICAL_TS} — regex broken?"
    return pairs


def test_python_pipedream_to_connector_matches_canonical_ts() -> None:
    """If this fails, mirror the change from infra/config/connectors.ts
    into integration_preferences.py (and the frontend helpers)."""
    canonical = _parse_canonical_pipedream_to_connector()
    assert _PIPEDREAM_TO_CONNECTOR == canonical


def test_python_connector_to_pipedream_is_reverse_of_pipedream_to_connector() -> None:
    """Sanity: the reverse map should be the literal inverse of the forward one."""
    expected = {v: k for k, v in _PIPEDREAM_TO_CONNECTOR.items()}
    assert _CONNECTOR_TO_PIPEDREAM == expected


def test_overlap_map_is_a_bijection() -> None:
    """Every Pipedream slug maps to one connector and vice versa — no dupes."""
    assert len(set(_PIPEDREAM_TO_CONNECTOR.values())) == len(_PIPEDREAM_TO_CONNECTOR)
    assert len(set(_PIPEDREAM_TO_CONNECTOR.keys())) == len(_PIPEDREAM_TO_CONNECTOR)
