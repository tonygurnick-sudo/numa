"""
Pipedream integration MCP tools for the workspace agent.

Provides tools for executing integration actions through the Pipedream
Connect API via the workspace-chat-tools Lambda. Actions requiring
side effects (run_action, proxy_request) go through human-in-the-loop
approval before execution.

Results are saved to files in /workdir/outputs/integrations-results/ to
avoid flooding the agent's context window with large API responses.
Files returned via Pipedream's file stash are automatically downloaded
into the same directory.
"""

import json
import os
from typing import Any

import structlog
from claude_agent_sdk import tool
from numa_workspace_agent.mcp_tools.integration_preferences import is_pipedream_allowed
from numa_workspace_agent.mcp_tools.lambda_client import (
    extract_status,
    invoke_workspace_tool,
    pop_approval_id,
    save_result,
)

logger = structlog.get_logger()


# ── Upstream-error detection ─────────────────────────────────────────────────
# Pipedream's invoke_workspace_tool returns `status: success` whenever it
# successfully forwarded a request to the upstream — even if the upstream
# (Gmail, LinkedIn, Microsoft Graph, etc.) returned a 4xx/5xx. The real error
# is logged in the observability stream (`result.os[].k == "error"`) or as a
# top-level `result.error` object. Without inspection here the model thinks
# the action worked and only discovers the failure if it Reads the response
# payload — costing turns. Confirmed across multiple clients in the cost-spike
# investigation (LinkedIn canonical: ddconsulting; Gmail confirmed on nd-labs).


def _extract_error_message(err: Any) -> str | None:
    """Pull a concise error message from a nested upstream error structure.

    Tries common shapes from Pipedream, Google APIs, and Microsoft Graph.
    Truncates to 300 chars so the message stays useful for the model without
    bloating tool_result content.
    """
    if isinstance(err, str):
        return err[:300]
    if not isinstance(err, dict):
        return None
    # Flat shapes: { message: "..." } etc.
    for key in ("message", "error_description", "detail", "reason"):
        if isinstance(err.get(key), str):
            return err[key][:300]
    # Google API shape: { error: { code: 400, message: "...", status: "..." } }
    nested = err.get("error")
    if isinstance(nested, dict) and isinstance(nested.get("message"), str):
        code = nested.get("code", "?")
        return f"{code}: {nested['message']}"[:300]
    # Pipedream sometimes wraps the upstream response under `response.body`
    response = err.get("response")
    if isinstance(response, dict):
        body = response.get("body")
        if isinstance(body, dict):
            body_err = body.get("error")
            if isinstance(body_err, dict) and isinstance(body_err.get("message"), str):
                code = body_err.get("code", "?")
                return f"{code}: {body_err['message']}"[:300]
    return None


def _detect_upstream_error(result: Any) -> tuple[bool, str | None]:
    """Inspect a Pipedream Connect (or proxy_request) result for upstream
    failures that the wrapper layer would otherwise mask as 'success'.

    Returns:
        (has_error, summary): summary is a short message suitable for
        surfacing to the model, or None if no error detected.
    """
    if not isinstance(result, dict):
        return False, None

    # invoke_workspace_tool wraps the upstream response inside `result.result`.
    # The outer `result.status` is wrapper-level (always "success" if we got
    # here); inspect the inner payload.
    inner = result.get("result", result)
    if not isinstance(inner, dict):
        return False, None

    # Pattern 1: Pipedream observability stream has an error event.
    os_events = inner.get("os")
    if isinstance(os_events, list):
        for event in os_events:
            if isinstance(event, dict) and event.get("k") == "error":
                msg = (
                    _extract_error_message(event.get("err"))
                    or "upstream error logged in os[]"
                )
                return True, msg

    # Pattern 2: top-level error object in the upstream payload.
    err = inner.get("error")
    if err:
        msg = _extract_error_message(err) or "upstream error in result.error"
        return True, msg

    # Pattern 3: HTTP-style status code from proxy_request paths.
    status_code = inner.get("status_code") or inner.get("statusCode")
    if isinstance(status_code, int) and not 200 <= status_code < 300:
        # Try to surface the response body if useful.
        body_msg = _extract_error_message(inner.get("body"))
        suffix = f" — {body_msg}" if body_msg else ""
        return True, f"upstream returned HTTP {status_code}{suffix}"

    return False, None


@tool(
    name="run_action",
    description=(
        "Execute a Pipedream integration action (e.g., search Google Drive, send Slack message). "
        "Requires user approval before execution. Results are saved to a file. "
        "Read action schemas from /workdir/tools/integrations/{app_slug}/ first."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action_key": {
                "type": "string",
                "description": "The action key from the schema (e.g., 'google_drive-find-file')",
            },
            "props": {
                "type": "string",
                "description": (
                    'JSON string of configured props. Include auth with "auto": '
                    'e.g., \'{"googleDrive":{"authProvisionId":"auto"},"nameSearchTerm":"report"}\''
                ),
            },
            "description": {
                "type": "string",
                "description": (
                    "Human-readable description shown to user for approval. "
                    "For write/send/create operations, include the full content verbatim "
                    "(e.g., email subject + body, message text, record fields being set)."
                ),
            },
            "stash_id": {
                "type": "string",
                "description": "Optional stash ID for file operations (use 'NEW' for first file download)",
            },
        },
        "required": ["action_key", "props", "description"],
    },
)
async def run_action(args: dict[str, Any]) -> dict[str, Any]:
    """Execute a Pipedream integration action with approval."""
    action_key = args.get("action_key", "")
    props_str = args.get("props", "{}")
    description = args.get("description", "")
    stash_id = args.get("stash_id")

    # Early check: reject if integration is not enabled
    integration_slug = action_key.split("-")[0] if action_key else ""
    enabled_raw = os.environ.get("NUMA_ENABLED_INTEGRATIONS", "")
    if integration_slug:
        try:
            enabled = json.loads(enabled_raw) if enabled_raw else []
        except json.JSONDecodeError:
            enabled = []
        if not enabled or integration_slug not in enabled:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Integration '{integration_slug}' is not enabled for this chat session. "
                            "The user needs to enable it in their chat settings "
                            "(integrations toggle in the chat sidebar) before it can be used."
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        # Honour the admin's per-service preferred_method choice. When admin has
        # chosen the native connector for this service, refuse the Pipedream call
        # and let the agent fall through to the connector tools.
        if not is_pipedream_allowed(integration_slug):
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"This workspace uses the native Numa connector for '{integration_slug}', "
                            "not Pipedream. Use the connector tools (mcp__connectors__*) instead."
                        ),
                    }
                ],
                "isError": True,
            }

    # Parse props JSON
    try:
        configured_props = json.loads(props_str)
    except json.JSONDecodeError as e:
        return {
            "content": [{"type": "text", "text": f"Error: Invalid props JSON: {e}"}],
            "is_error": True,
            "isError": True,
        }

    # If any prop values reference /workdir/ paths, sync local files to S3 first
    # so the workspace-chat-tools Lambda can find them when generating presigned URLs
    def _has_workdir_path(v: object) -> bool:
        if isinstance(v, str) and v.startswith("/workdir/"):
            return True
        if isinstance(v, list):
            return any(isinstance(el, str) and el.startswith("/workdir/") for el in v)
        return False

    has_workdir_paths = any(_has_workdir_path(v) for v in configured_props.values())
    if has_workdir_paths:
        user_sub = os.environ.get("NUMA_USER_SUB", "")
        conversation_id = os.environ.get("NUMA_CONVERSATION_ID", "")
        if user_sub and conversation_id:
            logger.info(
                "Syncing workspace files to S3 before integration tool call",
                action_key=action_key,
            )
            from numa_workspace_agent.s3_workspace import sync_to_s3

            sync_to_s3(user_sub, conversation_id)

    try:
        result = invoke_workspace_tool(
            "pipedream_run_action",
            {
                "action_key": action_key,
                "configured_props": configured_props,
                "description": description,
                "stash_id": stash_id,
                "request_id": pop_approval_id(action_key),
                "auto_approved": os.environ.get("NUMA_APPROVAL_MODE") == "auto",
            },
        )

        # Handle approval decisions
        status = extract_status(result)
        if status == "denied":
            deny_reason = result.get("deny_reason", "")
            msg = f"Action denied by user: {action_key}"
            if deny_reason:
                msg += f'. The user said: "{deny_reason}"'
            return {
                "content": [{"type": "text", "text": msg}],
            }
        if status == "timeout":
            if os.environ.get("NUMA_APPROVAL_MODE") == "auto":
                logger.warning(
                    "Unexpected approval timeout while auto-approve is enabled",
                    action_key=action_key,
                )
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"Execution timed out for: {action_key}. "
                                "The call did not complete. Check the target system "
                                "before retrying."
                            ),
                        }
                    ],
                    "is_error": True,
                    "isError": True,
                }
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Approval timed out for: {action_key}. "
                            "This workspace has human-in-the-loop approval enabled for integration tools. "
                            "An approval card was shown to the user but they did not respond "
                            "before the approval window expired. You can offer to try again if the user is ready to approve."
                        ),
                    }
                ],
            }
        if status in ("execution_timeout", "execution_failed"):
            # Pass through the real error message from the relay/proxy
            error_message = result.get("message", "")
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "status": status,
                                "message": (
                                    error_message
                                    or f"Execution failed or timed out for: {action_key}. "
                                    "The action was approved but may not have completed. "
                                    "Check the target system before retrying."
                                ),
                            }
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }
        if status == "already_executed":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Action already executed: {action_key}. "
                            "This was already run from a previous attempt. "
                            "Check the target system for results."
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        # Save result to file
        file_path, preview = save_result(result, action_key, description)

        # Detect upstream errors masked by wrapper "success" (e.g. Gmail
        # returns 400 in the response body but Pipedream's proxy reports
        # the call as completed).
        has_error, error_msg = _detect_upstream_error(result)
        if has_error:
            logger.info(
                "Pipedream upstream error detected",
                action_key=action_key,
                error_msg=error_msg,
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Action failed: {action_key}\n"
                            f"Upstream error: {error_msg}\n"
                            f"Full result saved to: {file_path}\n\nPreview:\n{preview}"
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Action completed: {action_key}\nResult saved to: {file_path}\n\nPreview:\n{preview}",
                }
            ],
        }

    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error executing {action_key}: {e}"}],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="configure_props",
    description=(
        "Get dynamic dropdown options for an action prop. "
        "Use this to discover valid values for props like 'drive', 'parentId', etc. "
        "Does NOT require user approval (read-only metadata)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action_key": {
                "type": "string",
                "description": "The action key (e.g., 'google_drive-list-files')",
            },
            "prop_name": {
                "type": "string",
                "description": "The prop to get options for (e.g., 'drive')",
            },
            "configured_props": {
                "type": "string",
                "description": (
                    "JSON string of currently configured props. "
                    'Include auth: \'{"googleDrive":{"authProvisionId":"auto"}}\''
                ),
            },
        },
        "required": ["action_key", "prop_name", "configured_props"],
    },
)
async def configure_props(args: dict[str, Any]) -> dict[str, Any]:
    """Get dynamic dropdown options for an action prop."""
    action_key = args.get("action_key", "")
    prop_name = args.get("prop_name", "")
    configured_props_str = args.get("configured_props", "{}")

    integration_slug = action_key.split("-")[0] if action_key else ""
    if integration_slug and not is_pipedream_allowed(integration_slug):
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"This workspace uses the native Numa connector for '{integration_slug}', "
                        "not Pipedream. Use the connector tools (mcp__connectors__*) instead."
                    ),
                }
            ],
            "isError": True,
        }

    try:
        configured_props = json.loads(configured_props_str)
    except json.JSONDecodeError as e:
        return {
            "content": [
                {"type": "text", "text": f"Error: Invalid configured_props JSON: {e}"}
            ],
            "is_error": True,
            "isError": True,
        }

    try:
        result = invoke_workspace_tool(
            "pipedream_configure_props",
            {
                "action_key": action_key,
                "prop_name": prop_name,
                "configured_props": configured_props,
            },
        )

        options = result.get("options", [])
        options_text = json.dumps(options, indent=2, default=str)

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Options for {action_key}.{prop_name}:\n{options_text}",
                }
            ],
        }

    except Exception as e:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error configuring {action_key}.{prop_name}: {e}",
                }
            ],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="proxy_request",
    description=(
        "Make a raw API call through Pipedream's proxy. "
        "Use this when no pre-built action exists for what you need. "
        "Pipedream injects the user's OAuth token automatically. "
        "Requires user approval."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "method": {
                "type": "string",
                "description": "HTTP method (GET, POST, PUT, PATCH, DELETE)",
                "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"],
            },
            "upstream_url": {
                "type": "string",
                "description": "The upstream API URL to call (e.g., 'https://www.googleapis.com/drive/v3/files/FILE_ID/revisions')",
            },
            "description": {
                "type": "string",
                "description": "Human-readable description of what this API call does (shown for approval)",
            },
            "integration_slug": {
                "type": "string",
                "description": "The integration slug (e.g., 'google_drive', 'slack', 'hubspot')",
            },
            "body": {
                "type": "object",
                "description": "Optional JSON body for POST/PUT/PATCH requests (e.g., event data, query parameters)",
            },
            "headers": {
                "type": "object",
                "description": (
                    "Optional custom HTTP headers for the upstream API. "
                    "Use the Pipedream x-pd-proxy- prefix to forward headers to the upstream service "
                    '(e.g., {"x-pd-proxy-Notion-Version": "2022-06-28"}).'
                ),
            },
        },
        "required": [
            "method",
            "upstream_url",
            "description",
            "integration_slug",
        ],
    },
)
async def proxy_request(args: dict[str, Any]) -> dict[str, Any]:
    """Make a raw API call through Pipedream's proxy with approval."""
    method = args.get("method", "GET")
    upstream_url = args.get("upstream_url", "")
    description = args.get("description", "")
    integration_slug = args.get("integration_slug", "")
    body = args.get("body")
    headers = args.get("headers")

    # Early check: reject if integration is not enabled
    enabled_raw = os.environ.get("NUMA_ENABLED_INTEGRATIONS", "")
    if integration_slug:
        try:
            enabled = json.loads(enabled_raw) if enabled_raw else []
        except json.JSONDecodeError:
            enabled = []
        if not enabled or integration_slug not in enabled:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Integration '{integration_slug}' is not enabled for this chat session. "
                            "The user needs to enable it in their chat settings "
                            "(integrations toggle in the chat sidebar) before it can be used."
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        # Honour the admin's per-service preferred_method choice.
        if not is_pipedream_allowed(integration_slug):
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"This workspace uses the native Numa connector for '{integration_slug}', "
                            "not Pipedream. Use the connector tools (mcp__connectors__*) instead."
                        ),
                    }
                ],
                "isError": True,
            }

    try:
        result = invoke_workspace_tool(
            "pipedream_proxy_request",
            {
                "method": method,
                "upstream_url": upstream_url,
                "integration_slug": integration_slug,
                "description": description,
                "body": body,
                "headers": headers,
                "request_id": pop_approval_id(f"{integration_slug}-{method}"),
                "auto_approved": os.environ.get("NUMA_APPROVAL_MODE") == "auto",
            },
        )

        status = extract_status(result)
        if status == "denied":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Proxy request denied by user: {method} {upstream_url}",
                    }
                ],
            }
        if status == "timeout":
            if os.environ.get("NUMA_APPROVAL_MODE") == "auto":
                logger.warning(
                    "Unexpected approval timeout while auto-approve is enabled",
                    method=method,
                    upstream_url=upstream_url,
                )
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"Execution timed out for proxy request: {method} {upstream_url}. "
                                "The request did not complete. Check the target system "
                                "before retrying."
                            ),
                        }
                    ],
                    "is_error": True,
                    "isError": True,
                }
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Approval timed out for proxy request: {method} {upstream_url}. "
                            "This workspace has human-in-the-loop approval enabled for integration tools. "
                            "An approval card was shown to the user but they did not respond "
                            "before the approval window expired. You can offer to try again if the user is ready to approve."
                        ),
                    }
                ],
            }
        if status in ("execution_timeout", "execution_failed"):
            error_message = result.get("message", "")
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "status": status,
                                "message": (
                                    error_message
                                    or f"Execution failed or timed out for proxy request: {method} {upstream_url}. "
                                    "The request was approved but may not have completed. "
                                    "Check the target system before retrying."
                                ),
                            }
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }
        if status == "already_executed":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Proxy request already executed: {method} {upstream_url}. "
                            "This was already run from a previous attempt. "
                            "Check the target system for results."
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        # Save result to file
        file_path, preview = save_result(result, f"proxy_{method}", description)

        # Detect upstream errors masked by wrapper "success" — same pattern
        # as run_action above (Pipedream reports the proxy hop succeeded
        # even when the upstream API returned a non-2xx).
        has_error, error_msg = _detect_upstream_error(result)
        if has_error:
            logger.info(
                "Proxy request upstream error detected",
                method=method,
                upstream_url=upstream_url,
                error_msg=error_msg,
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Proxy request failed: {method} {upstream_url}\n"
                            f"Upstream error: {error_msg}\n"
                            f"Full result saved to: {file_path}\n\nPreview:\n{preview}"
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Proxy request completed: {method} {upstream_url}\nResult saved to: {file_path}\n\nPreview:\n{preview}",
                }
            ],
        }

    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error in proxy request: {e}"}],
            "is_error": True,
            "isError": True,
        }
