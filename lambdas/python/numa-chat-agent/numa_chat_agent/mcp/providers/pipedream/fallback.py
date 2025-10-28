"""
Fallback helpers for Pipedream MCP tooling.
"""

from typing import Any, Iterable, List


def passthrough_tools(tools: Iterable[Any]) -> List[Any]:
    """
    Return the tools exactly as provided.
    """
    return list(tools)


__all__ = ["passthrough_tools"]
