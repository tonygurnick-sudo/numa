"""
High-level orchestration for MCP tooling.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterable, List, Optional, Tuple

import structlog

from ..utils import cleanup_mcp_clients
from .providers import get_provider

logger = structlog.get_logger(__name__)

SUPPORTED_MCP_APPS: List[str] = json.loads(
    os.environ.get("SUPPORTED_INTEGRATIONS", "[]")
)


@dataclass
class MCPBundle:
    tools: List[Any] = field(default_factory=list)
    clients: List[Any] = field(default_factory=list)


def get_supported_mcp_apps() -> List[str]:
    """
    Return the list of MCP apps supported for the current deployment.
    """
    return list(SUPPORTED_MCP_APPS)


def build_mcp_tooling(enabled_apps: Optional[Iterable[str]] = None) -> MCPBundle:
    """
    Build MCP tooling for the configured providers.
    """
    supported = list(SUPPORTED_MCP_APPS)
    if not supported:
        return MCPBundle()

    normalised_request = _normalise_requested_apps(enabled_apps)
    if normalised_request == []:
        return MCPBundle()

    if normalised_request is None:
        effective_apps = supported
    else:
        invalid = [app for app in normalised_request if app not in supported]
        if invalid:
            logger.warning(
                "Ignoring unsupported MCP apps", invalid_apps=sorted(set(invalid))
            )
        effective_apps = [app for app in normalised_request if app in supported]
        if not effective_apps:
            return MCPBundle()

    provider = get_provider("pipedream", supported_apps=supported)
    if not provider:
        logger.debug("No MCP provider available", provider="pipedream")
        return MCPBundle()

    result = provider.build_tooling(enabled_apps=effective_apps)
    return MCPBundle(tools=list(result.tools), clients=list(result.clients))


def get_mcp_tools_and_clients_for_agent(
    enabled_apps: Optional[Iterable[str]] = None,
) -> Tuple[List[Any], List[Any]]:
    """
    Convenience helper for agent construction.
    """
    bundle = build_mcp_tooling(enabled_apps)
    return bundle.tools, bundle.clients


@contextmanager
def mcp_clients_context(enabled_apps: Optional[Iterable[str]] = None):
    """
    Context manager that yields active MCP clients and cleans them up afterwards.
    """
    bundle = build_mcp_tooling(enabled_apps)
    try:
        yield bundle.clients
    finally:
        cleanup_mcp_clients(bundle.clients)


def _normalise_requested_apps(
    enabled_apps: Optional[Iterable[str]],
) -> Optional[List[str]]:
    if enabled_apps is None:
        return None
    resolved = [app for app in enabled_apps if app]
    if not resolved:
        logger.debug("Enabled apps list empty, disabling MCP tooling")
        return []
    return resolved
