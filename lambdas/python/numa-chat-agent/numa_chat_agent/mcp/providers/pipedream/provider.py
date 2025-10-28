"""
Pipedream MCP provider implementation.
"""

from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass, field
from importlib import import_module
from typing import Any, Iterable, List, Optional, Sequence

import structlog
from mcp.client.streamable_http import streamablehttp_client

from ....config import (
    MODEL_ID,
    PIPEDREAM_PROXY_LAMBDA_ARN,
    get_pipedream_routing_mode,
)
from ...clients import get_external_user_id
from .config import get_static_tool_routing_mode
from .fallback import passthrough_tools
from .policy import get_mcp_policy_from_dynamo, is_integration_globally_disabled
from .proxy import get_mcp_connection_details_from_proxy
from .router import (
    ToolsOnlyIntegrationRouter,
    build_tool_definitions,
    definition_requires_backup,
)


def _get_mcp_client_class():
    """Return the MCPClient class if available at runtime, else None."""
    try:  # pragma: no cover - dynamic import for optional dependency
        module = import_module("strands.tools.mcp")
        return getattr(module, "MCPClient", None)
    except Exception:
        return None


logger = structlog.get_logger(__name__)


@dataclass
class ProviderResult:
    tools: List[Any] = field(default_factory=list)
    clients: List[Any] = field(default_factory=list)


class PipedreamProvider:
    """
    Build MCP tooling for Pipedream-backed integrations.
    """

    def __init__(self, supported_apps: Sequence[str]) -> None:
        self.supported_apps = list(supported_apps)

    def build_tooling(
        self, enabled_apps: Optional[Iterable[str]] = None
    ) -> ProviderResult:
        if not PIPEDREAM_PROXY_LAMBDA_ARN:
            logger.debug("Pipedream proxy not configured, skipping MCP setup")
            return ProviderResult()

        resolved_apps = self._resolve_app_list(enabled_apps)
        if not resolved_apps:
            logger.debug("No Pipedream apps enabled, skipping MCP setup")
            return ProviderResult()

        external_user_id = get_external_user_id()
        if not external_user_id:
            logger.warning("Cannot create MCP clients without user context")
            return ProviderResult()

        result = ProviderResult()

        for app_name in resolved_apps:
            if app_name not in self.supported_apps:
                logger.warning("Skipping unsupported MCP app", app_name=app_name)
                continue

            if self._is_globally_disabled(app_name):
                logger.info("Skipping globally disabled integration", app_name=app_name)
                continue

            client = None
            stack: Optional[ExitStack] = None
            try:
                client = self._create_client(app_name, external_user_id)
                if not client:
                    logger.warning("Failed to create MCP client", app_name=app_name)
                    continue

                # Enter the client context but keep it alive for the agent lifetime
                stack = ExitStack()
                entered_client = stack.enter_context(client)
                # Also enter the attached backup client (instruction-only headers)
                try:
                    backup_client = getattr(client, "_pipedream_backup_client", None)
                    if backup_client is not None:
                        stack.enter_context(backup_client)
                except Exception:
                    pass

                raw_tools = entered_client.list_tools_sync()
                logger.info(
                    "Raw MCP tools retrieved",
                    app_name=app_name,
                    tool_names=[
                        getattr(t, "tool_name", None)
                        or getattr(getattr(t, "mcp_tool", None), "name", None)
                        or getattr(t, "name", None)
                        for t in raw_tools
                    ],
                )

                filtered_tools = self._filter_tools(
                    app_name, raw_tools, external_user_id
                )
                if not filtered_tools:
                    logger.info(
                        "No allowed tools after policy filtering", app_name=app_name
                    )
                    if stack:
                        try:
                            stack.close()
                        except Exception:  # pragma: no cover - best effort cleanup
                            pass
                    continue

                built_tools = self._build_tools(
                    app_name, entered_client, filtered_tools, external_user_id
                )
                if not built_tools:
                    logger.warning("No MCP tools registered", app_name=app_name)
                    if stack:
                        try:
                            stack.close()
                        except Exception:  # pragma: no cover - best effort cleanup
                            pass
                    continue

                result.tools.extend(built_tools)
                # Keep the stack (context manager) alive for later cleanup
                result.clients.append(stack if stack is not None else client)

            except Exception as exc:
                logger.error(
                    "Failed to initialise MCP integration",
                    app_name=app_name,
                    error=str(exc),
                    exc_info=True,
                )
                if stack is not None:
                    try:
                        stack.close()
                    except Exception:  # pragma: no cover - best effort cleanup
                        pass

        logger.info(
            "Completed Pipedream MCP setup",
            requested_apps=list(resolved_apps),
            registered_tools=len(result.tools),
            active_clients=len(result.clients),
        )
        return result

    def _resolve_app_list(self, enabled_apps: Optional[Iterable[str]]) -> List[str]:
        if enabled_apps is None:
            return list(self.supported_apps)

        resolved = [app for app in enabled_apps if app]
        if not resolved:
            return []
        return resolved

    def _is_globally_disabled(self, app_name: str) -> bool:
        try:
            return is_integration_globally_disabled(app_name)
        except Exception:  # pragma: no cover - fail open
            return False

    def _create_client(self, app_name: str, external_user_id: str) -> Optional[Any]:
        if _get_mcp_client_class() is None:  # pragma: no cover - optional dependency
            logger.warning(
                "Strands MCP client unavailable; skipping Pipedream integration",
                app_name=app_name,
            )
            return None
        try:
            connection_details = get_mcp_connection_details_from_proxy(
                external_user_id, app_name
            )
        except Exception as exc:
            logger.error(
                "Failed to get MCP connection details from proxy",
                app_name=app_name,
                error=str(exc),
            )
            return None

        base_url = connection_details.get("base_url")
        headers = dict(connection_details.get("headers", {}))
        if not base_url:
            logger.error("No base URL received from proxy", app_name=app_name)
            return None

        # Build two header sets: tools-only and backup (instruction-only)
        conversation_id = f"{external_user_id}-{app_name}".replace(" ", "_")
        headers_base = dict(headers)
        headers_base.pop("x-pd-tool-mode", None)
        headers_base.setdefault("x-pd-conversation-id", conversation_id)

        headers_tools = dict(headers_base)
        headers_tools["x-pd-tool-mode"] = "tools-only"

        def create_transport_tools():
            return streamablehttp_client(base_url, headers=headers_tools)

        def create_transport_backup():
            return streamablehttp_client(base_url, headers=headers_base)

        mcp_client_class = _get_mcp_client_class()
        if not mcp_client_class:
            return None
        client_tools: Any = mcp_client_class(create_transport_tools)
        client_backup: Any = mcp_client_class(create_transport_backup)

        # Attach helpful metadata and a reference to the backup client
        setattr(client_tools, "_pipedream_headers", dict(headers_tools))
        setattr(client_tools, "_pipedream_base_url", base_url)
        setattr(client_tools, "_pipedream_backup_headers", dict(headers_base))
        setattr(client_tools, "_pipedream_backup_client", client_backup)

        return client_tools

    def _filter_tools(
        self, app_name: str, tools: Iterable[Any], external_user_id: str
    ) -> List[Any]:
        tools_list = list(tools)
        policy = get_mcp_policy_from_dynamo(external_user_id, app_name)
        deny = set(policy.get("denyTools", []) or [])
        filtered = []
        for tool in tools_list:
            tool_name = (
                getattr(tool, "tool_name", None)
                or getattr(getattr(tool, "mcp_tool", None), "name", None)
                or getattr(tool, "name", None)
            )
            if tool_name not in deny:
                filtered.append(tool)

        logger.info(
            "MCP tools filtered",
            app_name=app_name,
            total=len(tools_list),
            allowed=len(filtered),
            denied_count=len(deny),
        )
        return filtered

    def _build_tools(
        self,
        app_name: str,
        mcp_client: Any,
        tools: List[Any],
        external_user_id: str,
    ) -> List[Any]:
        routing_mode = get_pipedream_routing_mode(app_name)
        if routing_mode == "backup":
            logger.info(
                "Using backup Pipedream sub-agent tools",
                app_name=app_name,
                tool_count=len(tools),
            )
            return passthrough_tools(tools)

        try:
            definitions = build_tool_definitions(tools)
            if not definitions:
                raise ValueError("No tool definitions extracted from MCP payload")

            requires_backup_map = {
                definition.name: definition_requires_backup(definition)
                for definition in definitions
            }

            # Apply static per-tool overrides defined in code (takes precedence)
            for definition in definitions:
                static_mode = get_static_tool_routing_mode(app_name, definition.name)
                if static_mode:
                    logger.info(
                        "Applied static routing override",
                        app_name=app_name,
                        tool_name=definition.name,
                        mode=static_mode,
                    )
                if static_mode == "backup":
                    requires_backup_map[definition.name] = True
                elif static_mode == "numa":
                    requires_backup_map[definition.name] = False

            router = ToolsOnlyIntegrationRouter(
                integration_name=app_name,
                mcp_client=mcp_client,
                tool_definitions=definitions,
                model_id=MODEL_ID,
                external_user_id=external_user_id,
                requires_backup=requires_backup_map,
            )
            router_tool = router.build_strands_tool()
            logger.info(
                "Registered Numa tools-only router",
                app_name=app_name,
                tool_count=len(definitions),
                backup_candidates=sum(
                    1 for value in requires_backup_map.values() if value
                ),
                routing_mode=routing_mode,
            )
            return [router_tool]

        except Exception as exc:
            logger.error(
                "Failed to initialise Numa Pipedream router, falling back to backup tools",
                app_name=app_name,
                error=str(exc),
                exc_info=True,
            )
            return passthrough_tools(tools)


def create_provider(supported_apps: Sequence[str]) -> PipedreamProvider:
    return PipedreamProvider(supported_apps=supported_apps)
