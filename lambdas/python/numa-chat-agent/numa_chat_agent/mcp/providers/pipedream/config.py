"""
Static configuration for Pipedream MCP routing.

This module allows us to force per-tool routing modes without relying on
environment variables. Use it sparingly for tools that expose only a stub
schema but require dynamic props (e.g., Google Calendar create-event).

Modes:
- "backup": use Pipedream's instruction-only sub-agent
- "numa": use Numa's tools-only router
"""

from __future__ import annotations

from typing import Dict, Tuple

# Keyed by (integration_name, tool_name) in lowercase
PER_TOOL_ROUTING_OVERRIDES: Dict[Tuple[str, str], str] = {
    # Google Calendar: the detailed create-event flow hides dynamic fields
    # behind additionalProps; force sub-agent to resolve them correctly.
    # ("google_calendar", "google_calendar-create-event"): "backup",
}


def _normalise(value: str | None) -> str:
    return (value or "").strip().lower()


def get_static_tool_routing_mode(app_name: str, tool_name: str) -> str | None:
    """
    Return a static per-tool routing mode if defined, else None.
    """
    key = (_normalise(app_name), _normalise(tool_name))
    mode = PER_TOOL_ROUTING_OVERRIDES.get(key)
    if not mode:
        return None
    mode_lc = mode.lower()
    if mode_lc in ("backup", "numa"):
        return mode_lc
    if mode_lc == "legacy":
        return "backup"
    if mode_lc == "tools-only":
        return "numa"
    return None
