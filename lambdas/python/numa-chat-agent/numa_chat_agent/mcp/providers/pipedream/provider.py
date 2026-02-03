"""
Pipedream MCP provider implementation.
"""

from __future__ import annotations

import time
import uuid
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
        tooling_start = time.time()
        build_id = str(uuid.uuid4())[:8]

        logger.info(
            "MCP_TOOLING_BUILD_START: Beginning MCP tooling build",
            supported_apps=self.supported_apps,
            requested_apps=list(enabled_apps) if enabled_apps else None,
            has_proxy_arn=bool(PIPEDREAM_PROXY_LAMBDA_ARN),
            build_id=build_id,
        )

        if not PIPEDREAM_PROXY_LAMBDA_ARN:
            logger.error(
                "MCP_TOOLING_BUILD_FAILED: Pipedream proxy not configured",
                proxy_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
                build_id=build_id,
            )
            return ProviderResult()

        resolved_apps = self._resolve_app_list(enabled_apps)
        if not resolved_apps:
            logger.warning(
                "MCP_TOOLING_BUILD_SKIPPED: No Pipedream apps enabled",
                supported_apps=self.supported_apps,
                requested_apps=list(enabled_apps) if enabled_apps else None,
                build_id=build_id,
            )
            return ProviderResult()

        logger.info(
            "MCP_TOOLING_APPS_RESOLVED: Apps resolved for tooling build",
            resolved_apps=resolved_apps,
            supported_apps=self.supported_apps,
            build_id=build_id,
        )

        external_user_id = get_external_user_id()
        if not external_user_id:
            logger.error(
                "SECURITY_RISK: External user ID derivation failed - no authentication context for MCP",
                timestamp=time.time(),
            )
            return ProviderResult()
        else:
            logger.info(
                "SECURITY_CHECK: External user ID derived successfully",
                user_id_prefix=(
                    external_user_id[:8] + "..."
                    if len(external_user_id) > 8
                    else external_user_id
                ),
            )

        result = ProviderResult()

        successful_apps = []
        failed_apps = []

        for app_index, app_name in enumerate(resolved_apps):
            app_start = time.time()
            logger.info(
                "MCP_APP_PROCESSING_START: Processing app for MCP tooling",
                app_name=app_name,
                app_index=app_index + 1,
                total_apps=len(resolved_apps),
                build_id=build_id,
            )

            if app_name not in self.supported_apps:
                logger.warning(
                    "MCP_APP_UNSUPPORTED: Skipping unsupported MCP app",
                    app_name=app_name,
                    supported_apps=self.supported_apps,
                    build_id=build_id,
                )
                failed_apps.append({"app": app_name, "reason": "unsupported"})
                continue

            # IMPROVEMENT NEEDED: Implement real-time policy enforcement with cache invalidation
            # RATIONALE: The current implementation only checks global policies at agent creation time,
            # creating a window where policies updated after agent creation are not enforced. This
            # policy lag vulnerability allows users to continue using integrations that have been
            # disabled by administrators.
            # CONSEQUENCE: Without real-time policy enforcement:
            # - Users can bypass security restrictions through timing attacks
            # - Disabled integrations remain accessible until agent restart
            # - Compliance violations may occur due to policy lag
            # - Security incidents may go undetected during the lag window
            #
            # PROPOSED FIX:
            # def check_policy_with_cache_invalidation(app_name: str, external_user_id: str) -> bool:
            #     """Check policy with cache invalidation for real-time enforcement."""
            #     cache_key = f"policy:{external_user_id}:{app_name}"
            #     cache_ttl = 60  # 1 minute cache
            #
            #     # Check if policy has been recently updated
            #     policy_last_modified = get_policy_last_modified(external_user_id, app_name)
            #     cached_policy = get_cached_policy(cache_key)
            #
            #     if cached_policy and cached_policy['timestamp'] > policy_last_modified:
            #         return not cached_policy['globally_disabled']
            #
            #     # Refresh policy from authoritative source
            #     current_policy = get_fresh_policy_from_dynamo(external_user_id, app_name)
            #     is_disabled = is_integration_globally_disabled(app_name)
            #
            #     cache_policy(cache_key, {
            #         'globally_disabled': is_disabled,
            #         'user_policy': current_policy,
            #         'timestamp': time.time()
            #     }, ttl=cache_ttl)
            #
            #     return not is_disabled
            #
            # if not check_policy_with_cache_invalidation(app_name, external_user_id):

            logger.info(
                "POLICY_CHECK_START: Checking global policy for integration",
                app_name=app_name,
                build_id=build_id,
                policy_check_timestamp=time.time(),
            )

            is_disabled = self._is_globally_disabled(app_name)
            if is_disabled:
                logger.warning(
                    "RELIABILITY_RISK: Integration globally disabled but policy checked at agent creation time only",
                    app_name=app_name,
                    agent_creation_time=time.time(),
                    policy_check_time=time.time(),
                    reliability_concerns=[
                        "policy_lag_vulnerability_allows_continued_access",
                        "no_real_time_policy_enforcement",
                        "users_can_bypass_restrictions_via_timing_attacks",
                        "disabled_integrations_remain_accessible_until_restart",
                    ],
                    security_gaps=[
                        "policy_enforcement_window_during_updates",
                        "potential_compliance_violations_during_lag",
                        "security_incident_detection_delays",
                    ],
                )

                # RELIABILITY IMPROVEMENT NEEDED: Implement real-time policy enforcement with cache invalidation
                # RATIONALE: The current implementation only checks global policies at agent creation time,
                # creating a window where policies updated after agent creation are not enforced. This
                # policy lag vulnerability allows users to continue using integrations that have been
                # disabled by administrators, leading to potential security violations and compliance issues.
                # CONSEQUENCE OF NOT FIXING: Users can exploit timing windows where:
                # - Disabled integrations remain accessible until the next agent restart
                # - Policy updates don't take effect immediately, creating security gaps
                # - Compliance violations may occur during the policy lag period
                # - Security incidents may go undetected during the enforcement gap
                # - Administrators' security decisions are not enforced in real-time
                # CONSEQUENCE OF FIXING: With real-time policy enforcement, the system would have:
                # - Immediate enforcement of security policy changes
                # - Consistent security posture without timing-based vulnerabilities
                # - Better compliance with regulatory requirements
                # - Enhanced security incident response capabilities
                # - Improved administrative control over integration access
                #
                # PROPOSED REAL-TIME POLICY ENFORCEMENT FIX:
                # import threading
                # from typing import Dict, Optional
                #
                # class PolicyCache:
                #     """Thread-safe policy cache with TTL and invalidation."""
                #     def __init__(self, ttl_seconds: int = 60):
                #         self.cache: Dict[str, Dict] = {}
                #         self.cache_timestamps: Dict[str, float] = {}
                #         self.ttl_seconds = ttl_seconds
                #         self.lock = threading.Lock()
                #
                #     def get_policy(self, cache_key: str) -> Optional[Dict]:
                #         with self.lock:
                #             if cache_key not in self.cache:
                #                 return None
                #
                #             timestamp = self.cache_timestamps.get(cache_key, 0)
                #             if time.time() - timestamp > self.ttl_seconds:
                #                 # Cache entry expired
                #                 del self.cache[cache_key]
                #                 del self.cache_timestamps[cache_key]
                #                 return None
                #
                #             return self.cache[cache_key]
                #
                #     def set_policy(self, cache_key: str, policy: Dict):
                #         with self.lock:
                #             self.cache[cache_key] = policy
                #             self.cache_timestamps[cache_key] = time.time()
                #
                # policy_cache = PolicyCache(ttl_seconds=60)  # 1 minute cache
                #
                # def check_policy_with_cache_invalidation(app_name: str, external_user_id: str) -> bool:
                #     """Check policy with cache invalidation for real-time enforcement."""
                #     cache_key = f"policy:{external_user_id}:{app_name}"
                #
                #     # Try to get from cache first
                #     cached_policy = policy_cache.get_policy(cache_key)
                #     if cached_policy is not None:
                #         logger.info(
                #             "POLICY_CACHE_HIT: Using cached policy decision",
                #             app_name=app_name,
                #             cache_key=cache_key,
                #             cached_result=not cached_policy.get('globally_disabled', False)
                #         )
                #         return not cached_policy.get('globally_disabled', False)
                #
                #     # Cache miss - fetch fresh policy from authoritative source
                #     logger.info(
                #         "POLICY_CACHE_MISS: Fetching fresh policy from authoritative source",
                #         app_name=app_name,
                #         cache_key=cache_key
                #     )
                #
                #     try:
                #         # Get fresh policy from DynamoDB or other authoritative source
                #         is_disabled = is_integration_globally_disabled(app_name)
                #         user_policy = get_mcp_policy_from_dynamo(external_user_id, app_name)
                #
                #         # Cache the policy decision
                #         policy_data = {
                #             'globally_disabled': is_disabled,
                #             'user_policy': user_policy,
                #             'timestamp': time.time(),
                #             'cache_key': cache_key
                #         }
                #         policy_cache.set_policy(cache_key, policy_data)
                #
                #         logger.info(
                #             "POLICY_REAL_TIME_CHECK: Fresh policy retrieved and cached",
                #             app_name=app_name,
                #             is_globally_disabled=is_disabled,
                #             cache_ttl_seconds=60,
                #             policy_enforcement="REAL_TIME"
                #         )
                #
                #         return not is_disabled
                #
                #     except Exception as e:
                #         logger.error(
                #             "POLICY_CHECK_FAILED: Real-time policy check failed",
                #             app_name=app_name,
                #             error_type=type(e).__name__,
                #             error=str(e)
                #         )
                #         # Fail secure - deny access when policy check fails
                #         return False
                #
                # # Use real-time policy check instead of one-time check
                # if not check_policy_with_cache_invalidation(app_name, external_user_id):

                logger.warning(
                    "MCP_APP_DISABLED: Skipping globally disabled app",
                    app_name=app_name,
                    build_id=build_id,
                    policy_enforcement="ONE_TIME_AT_CREATION",
                )
                failed_apps.append({"app": app_name, "reason": "globally_disabled"})
                continue

            client = None
            stack: Optional[ExitStack] = None
            try:
                client_creation_start = time.time()
                logger.info(
                    "MCP_CLIENT_CREATION_START: Creating MCP client",
                    app_name=app_name,
                    external_user_id=(
                        external_user_id[:8] + "..." if external_user_id else "None"
                    ),
                    build_id=build_id,
                )

                client = self._create_client(app_name, external_user_id)
                client_creation_duration = time.time() - client_creation_start

                if not client:
                    logger.error(
                        "MCP_CLIENT_CREATION_FAILED: Failed to create MCP client",
                        app_name=app_name,
                        client_creation_duration_ms=round(
                            client_creation_duration * 1000, 2
                        ),
                        build_id=build_id,
                    )
                    failed_apps.append(
                        {"app": app_name, "reason": "client_creation_failed"}
                    )
                    continue

                logger.info(
                    "MCP_CLIENT_CREATION_SUCCESS: MCP client created successfully",
                    app_name=app_name,
                    client_type=type(client).__name__,
                    client_creation_duration_ms=round(
                        client_creation_duration * 1000, 2
                    ),
                    build_id=build_id,
                )

                # IMPROVEMENT NEEDED: Implement robust connection lifecycle management
                # RATIONALE: The current implementation uses ExitStack to manage MCP client connections,
                # but this creates several risks: premature closure can break active tools, there's no
                # connection monitoring, and no graceful degradation when connections fail.
                # CONSEQUENCE: Without proper connection management:
                # - Tools may fail unexpectedly due to premature connection closure
                # - No way to detect and recover from connection drops
                # - Resource leaks if cleanup fails silently
                # - Poor user experience during connection issues
                #
                # PROPOSED FIX:
                # class ManagedMCPConnection:
                #     def __init__(self, client, app_name: str):
                #         self.client = client
                #         self.app_name = app_name
                #         self.created_at = time.time()
                #         self.last_used = time.time()
                #         self.is_healthy = True
                #         self.error_count = 0
                #
                #     def use_client(self):
                #         """Get client with health check and usage tracking."""
                #         if not self.is_healthy:
                #             raise RuntimeError(f"MCP connection for {self.app_name} is unhealthy")
                #         self.last_used = time.time()
                #         return self.client
                #
                #     def mark_error(self, error: Exception):
                #         """Track errors and mark unhealthy if threshold exceeded."""
                #         self.error_count += 1
                #         if self.error_count > 3:
                #             self.is_healthy = False
                #             logger.warning("MCP connection marked unhealthy", app=self.app_name, errors=self.error_count)
                #
                #     def cleanup(self):
                #         """Safely cleanup connection with retry logic."""
                #         try:
                #             if hasattr(self.client, '__exit__'):
                #                 self.client.__exit__(None, None, None)
                #         except Exception as e:
                #             logger.warning("MCP connection cleanup failed", app=self.app_name, error=str(e))
                #
                # managed_connection = ManagedMCPConnection(client, app_name)

                # Enter the client context but keep it alive for the agent lifetime
                stack = ExitStack()

                logger.warning(
                    "RELIABILITY_RISK: Using ExitStack for MCP client lifecycle management - potential for connection instability",
                    app_name=app_name,
                    client_type=type(client).__name__,
                    reliability_concerns=[
                        "premature_context_closure_breaks_active_tools",
                        "no_connection_health_monitoring",
                        "resource_leaks_if_cleanup_fails",
                        "no_graceful_degradation_on_connection_loss",
                    ],
                    failure_modes=[
                        "tools_fail_mid_execution_due_to_closed_context",
                        "silent_resource_leaks_during_exceptions",
                        "poor_user_experience_with_connection_drops",
                        "difficult_debugging_of_connection_lifecycle_issues",
                    ],
                )

                # RELIABILITY IMPROVEMENT NEEDED: Implement robust connection lifecycle management
                # RATIONALE: The current implementation uses ExitStack to manage MCP client connections,
                # which creates several reliability risks: premature closure can break active tools,
                # there's no connection monitoring, and no graceful degradation when connections fail.
                # This leads to intermittent failures where tools work sometimes but fail other times
                # depending on connection timing and lifecycle events.
                # CONSEQUENCE OF NOT FIXING: Users experience inconsistent behavior where:
                # - Tools fail unexpectedly due to premature connection closure during execution
                # - No way to detect and recover from connection drops or degradation
                # - Resource leaks accumulate if cleanup fails silently during exception handling
                # - Poor user experience during network issues or service degradation
                # - Difficult debugging of connection-related intermittent failures
                # CONSEQUENCE OF FIXING: With robust connection management, the system would have:
                # - Reliable tool execution with health monitoring and automatic recovery
                # - Early detection and graceful handling of connection issues
                # - Better resource utilization with guaranteed cleanup and leak prevention
                # - Improved user experience with clear error messages and fallback behavior
                # - Enhanced observability for debugging connection-related issues
                #
                # PROPOSED ROBUST CONNECTION MANAGEMENT FIX:
                # import threading
                # from contextlib import contextmanager
                # from typing import Optional
                # import weakref
                #
                # class ManagedMCPConnection:
                #     """Robust MCP connection manager with health monitoring and graceful degradation."""
                #     def __init__(self, client, app_name: str):
                #         self.client = client
                #         self.app_name = app_name
                #         self.created_at = time.time()
                #         self.last_used = time.time()
                #         self.last_health_check = 0.0
                #         self.is_healthy = True
                #         self.error_count = 0
                #         self.max_errors = 3
                #         self.health_check_interval = 30.0  # seconds
                #         self.lock = threading.Lock()
                #         self._closed = False
                #
                #     def use_client(self):
                #         """Get client with health check and usage tracking."""
                #         with self.lock:
                #             if self._closed:
                #                 raise RuntimeError(f"MCP connection for {self.app_name} is closed")
                #
                #             # Perform periodic health checks
                #             now = time.time()
                #             if now - self.last_health_check > self.health_check_interval:
                #                 self._perform_health_check()
                #
                #             if not self.is_healthy:
                #                 raise RuntimeError(f"MCP connection for {self.app_name} is unhealthy (errors: {self.error_count})")
                #
                #             self.last_used = now
                #             return self.client
                #
                #     def _perform_health_check(self):
                #         """Perform connection health check."""
                #         try:
                #             health_start = time.time()
                #             # Simple health check using list_tools
                #             tools = self.client.list_tools_sync()
                #             health_duration = time.time() - health_start
                #
                #             if health_duration > 5.0:  # Slow response threshold
                #                 logger.warning(
                #                     "CONNECTION_HEALTH_DEGRADED: MCP connection responding slowly",
                #                     app_name=self.app_name,
                #                     health_check_duration_ms=round(health_duration * 1000, 2)
                #                 )
                #                 self.mark_error(Exception(f"Slow health check: {health_duration:.2f}s"))
                #                 return
                #
                #             if not tools:
                #                 logger.error(
                #                     "CONNECTION_HEALTH_FAILED: MCP connection returned no tools",
                #                     app_name=self.app_name
                #                 )
                #                 self.mark_error(Exception("Health check returned no tools"))
                #                 return
                #
                #             # Health check passed - reset error count
                #             self.error_count = 0
                #             self.is_healthy = True
                #             self.last_health_check = time.time()
                #
                #             logger.info(
                #                 "CONNECTION_HEALTH_OK: MCP connection health check passed",
                #                 app_name=self.app_name,
                #                 tools_available=len(tools),
                #                 health_check_duration_ms=round(health_duration * 1000, 2)
                #             )
                #
                #         except Exception as e:
                #             logger.error(
                #                 "CONNECTION_HEALTH_ERROR: MCP connection health check failed",
                #                 app_name=self.app_name,
                #                 error_type=type(e).__name__,
                #                 error=str(e)
                #             )
                #             self.mark_error(e)
                #
                #     def mark_error(self, error: Exception):
                #         """Track errors and mark unhealthy if threshold exceeded."""
                #         with self.lock:
                #             self.error_count += 1
                #             logger.warning(
                #                 "CONNECTION_ERROR: MCP connection error recorded",
                #                 app_name=self.app_name,
                #                 error_count=self.error_count,
                #                 max_errors=self.max_errors,
                #                 error_type=type(error).__name__,
                #                 error=str(error)
                #             )
                #
                #             if self.error_count >= self.max_errors:
                #                 self.is_healthy = False
                #                 logger.error(
                #                     "CONNECTION_UNHEALTHY: MCP connection marked unhealthy due to error threshold",
                #                     app_name=self.app_name,
                #                     error_count=self.error_count,
                #                     max_errors=self.max_errors
                #                 )
                #
                #     def cleanup(self):
                #         """Safely cleanup connection with retry logic."""
                #         with self.lock:
                #             if self._closed:
                #                 return
                #
                #             self._closed = True
                #             cleanup_attempts = 0
                #             max_cleanup_attempts = 3
                #
                #             for attempt in range(max_cleanup_attempts):
                #                 try:
                #                     if hasattr(self.client, '__exit__'):
                #                         self.client.__exit__(None, None, None)
                #                     logger.info(
                #                         "CONNECTION_CLEANUP_SUCCESS: MCP connection cleanup completed",
                #                         app_name=self.app_name,
                #                         cleanup_attempt=attempt + 1
                #                     )
                #                     break
                #                 except Exception as e:
                #                     cleanup_attempts += 1
                #                     logger.warning(
                #                         "CONNECTION_CLEANUP_RETRY: MCP connection cleanup failed, retrying",
                #                         app_name=self.app_name,
                #                         cleanup_attempt=attempt + 1,
                #                         max_attempts=max_cleanup_attempts,
                #                         error_type=type(e).__name__,
                #                         error=str(e)
                #                     )
                #                     if attempt == max_cleanup_attempts - 1:
                #                         logger.error(
                #                             "CONNECTION_CLEANUP_FAILED: MCP connection cleanup failed permanently",
                #                             app_name=app_name,
                #                             total_attempts=max_cleanup_attempts,
                #                             final_error=str(e)
                #                         )
                #
                # # Use managed connection instead of raw ExitStack
                # managed_connection = ManagedMCPConnection(client, app_name)
                # entered_client = managed_connection.use_client()
                # # Store managed connection for proper cleanup
                # result.clients.append(managed_connection)

                entered_client = stack.enter_context(client)
                logger.warning(
                    "RELIABILITY_RISK: MCP client managed by raw ExitStack without connection monitoring",
                    app_name=app_name,
                    client_type=type(client).__name__,
                    context_stack_id=id(stack),
                    reliability_status="UNMONITORED",
                )
                # Also enter the attached backup client (instruction-only headers)
                try:
                    backup_client = getattr(client, "_pipedream_backup_client", None)
                    if backup_client is not None:
                        stack.enter_context(backup_client)
                except Exception:
                    pass

                # Perform connection health check
                health_check_start = time.time()
                try:
                    raw_tools = entered_client.list_tools_sync()
                    health_check_duration = time.time() - health_check_start

                    if not raw_tools:
                        logger.error(
                            "CONNECTION_HEALTH_FAILED: MCP connection returned no tools",
                            app_name=app_name,
                            health_check_duration_ms=round(
                                health_check_duration * 1000, 2
                            ),
                        )
                        if stack:
                            stack.close()
                        failed_apps.append(
                            {"app": app_name, "reason": "no_tools_available"}
                        )
                        continue

                    if health_check_duration > 10.0:  # Slow response threshold
                        logger.warning(
                            "CONNECTION_HEALTH_DEGRADED: MCP connection responding slowly",
                            app_name=app_name,
                            health_check_duration_ms=round(
                                health_check_duration * 1000, 2
                            ),
                            threshold_ms=10000,
                        )

                    logger.info(
                        "CONNECTION_HEALTH_OK: MCP connection health check passed",
                        app_name=app_name,
                        tools_available=len(raw_tools),
                        health_check_duration_ms=round(health_check_duration * 1000, 2),
                        tool_names=[
                            getattr(t, "tool_name", None)
                            or getattr(getattr(t, "mcp_tool", None), "name", None)
                            or getattr(t, "name", None)
                            for t in raw_tools
                        ],
                    )
                except Exception as e:
                    health_check_duration = time.time() - health_check_start
                    logger.error(
                        "CONNECTION_HEALTH_ERROR: MCP connection health check failed",
                        app_name=app_name,
                        error_type=type(e).__name__,
                        error=str(e),
                        health_check_duration_ms=round(health_check_duration * 1000, 2),
                    )
                    if stack:
                        stack.close()
                    failed_apps.append(
                        {
                            "app": app_name,
                            "reason": "health_check_failed",
                            "error": str(e),
                        }
                    )
                    continue

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

                app_duration = time.time() - app_start
                successful_apps.append(
                    {
                        "app": app_name,
                        "tools_count": len(built_tools),
                        "duration_ms": round(app_duration * 1000, 2),
                    }
                )

                logger.info(
                    "MCP_APP_PROCESSING_SUCCESS: App processing completed successfully",
                    app_name=app_name,
                    tools_registered=len(built_tools),
                    app_duration_ms=round(app_duration * 1000, 2),
                    build_id=build_id,
                )

            except Exception as exc:
                app_duration = time.time() - app_start
                logger.error(
                    "MCP_APP_PROCESSING_FAILED: Failed to initialise MCP integration",
                    app_name=app_name,
                    error_type=type(exc).__name__,
                    error=str(exc),
                    app_duration_ms=round(app_duration * 1000, 2),
                    build_id=build_id,
                    exc_info=True,
                )
                failed_apps.append(
                    {
                        "app": app_name,
                        "reason": "processing_exception",
                        "error": str(exc),
                    }
                )
                if stack is not None:
                    try:
                        stack.close()
                    except Exception:  # pragma: no cover - best effort cleanup
                        pass

        total_build_duration = time.time() - tooling_start
        logger.info(
            "MCP_TOOLING_BUILD_COMPLETE: Completed Pipedream MCP tooling build",
            requested_apps=list(resolved_apps),
            successful_apps=[app["app"] for app in successful_apps],
            failed_apps=[app["app"] for app in failed_apps],
            registered_tools=len(result.tools),
            active_clients=len(result.clients),
            total_build_duration_ms=round(total_build_duration * 1000, 2),
            success_rate=(
                round(len(successful_apps) / len(resolved_apps) * 100, 1)
                if resolved_apps
                else 0
            ),
            build_id=build_id,
        )

        logger.debug(
            "MCP_TOOLING_BUILD_DETAILS: Detailed build results",
            successful_apps_details=successful_apps,
            failed_apps_details=failed_apps,
            build_id=build_id,
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
        try:
            policy = get_mcp_policy_from_dynamo(external_user_id, app_name)
            logger.info(
                "SECURITY_CHECK: Retrieved MCP policy from DynamoDB",
                app_name=app_name,
                user_id=external_user_id[:8] + "...",
                deny_tools_count=len(policy.get("denyTools", [])),
            )
        except Exception as e:
            logger.error(
                "SECURITY_RISK: Failed to retrieve MCP policy - defaulting to permissive",
                app_name=app_name,
                user_id=external_user_id[:8] + "...",
                error=str(e),
                fallback_behavior="May allow unauthorized tools",
            )

            # IMPROVEMENT NEEDED: Implement secure fallback policy instead of permissive default
            # RATIONALE: When policy retrieval fails, the current implementation defaults to an
            # empty policy (permissive), which allows all tools. This violates the security
            # principle of "fail secure" and could expose sensitive operations during outages.
            # CONSEQUENCE: Without secure fallbacks:
            # - All tools become available during policy service outages
            # - Security controls are bypassed during infrastructure failures
            # - Potential for privilege escalation during system degradation
            # - Compliance violations during service disruptions
            #
            # PROPOSED FIX:
            # def get_secure_fallback_policy(app_name: str, error_context: str) -> Dict[str, Any]:
            #     """Return a restrictive fallback policy when normal policy retrieval fails."""
            #     # Define minimal safe tools per integration
            #     safe_tools_by_app = {
            #         'slack': ['list_channels', 'get_user_info'],  # Read-only operations
            #         'gmail': ['list_messages'],  # No send/delete capabilities
            #         'google_calendar': ['list_events'],  # No create/modify
            #         # Add other integrations with minimal safe tool sets
            #     }
            #
            #     safe_tools = safe_tools_by_app.get(app_name, [])  # Default to no tools
            #     all_tools = get_all_known_tools_for_app(app_name)  # Get complete tool list
            #     denied_tools = [tool for tool in all_tools if tool not in safe_tools]
            #
            #     logger.warning(
            #         "SECURITY_FALLBACK: Using restrictive fallback policy",
            #         app_name=app_name,
            #         allowed_tools=safe_tools,
            #         denied_tools_count=len(denied_tools),
            #         error_context=error_context
            #     )
            #
            #     return {
            #         'denyTools': denied_tools,
            #         'allowTools': safe_tools,
            #         'fallback_reason': error_context,
            #         'fallback_timestamp': time.time()
            #     }
            #
            # policy = get_secure_fallback_policy(app_name, str(e))

            policy = {}  # Permissive fallback
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
