"""
Vault secrets MCP tool for the workspace agent.

Provides a single dispatcher tool for requesting secrets from the user's vault.
Secrets are retrieved via the workspace-chat-tools Lambda and require
user approval unless the secret has danger_mode enabled.

Architecture:
    Claude → vault MCP (name="list_secrets|request_secret") → _invoke_workspace_tool() → Lambda

SECURITY:
- Secret values are NEVER logged or included in text output to the user.
- Secrets are returned as tool results only and must not be persisted.
- The agent should use secrets for one-time operations only.
"""

import json
import os
from typing import Any

import structlog
from claude_agent_sdk import tool

logger = structlog.get_logger()


def _invoke_workspace_tool(tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Invoke the workspace-chat-tools Lambda with the given tool and params."""
    import boto3
    from botocore.config import Config

    lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
    if not lambda_name:
        raise ValueError("WORKSPACE_TOOLS_LAMBDA_NAME is not configured")

    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    lambda_client = session.client(
        "lambda",
        config=Config(read_timeout=120),
    )

    event = {
        "tool": tool_name,
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "params": params,
    }

    response = lambda_client.invoke(
        FunctionName=lambda_name,
        Payload=json.dumps(event),
    )
    payload = json.loads(response["Payload"].read())
    if isinstance(payload, dict) and payload.get("errorMessage"):
        raise RuntimeError(payload["errorMessage"])
    return payload


def _pop_approval_id(action_key: str) -> str:
    """Pop the next approval ID for this vault action from NUMA_REQUEST_ID_MAP."""
    raw = os.environ.get("NUMA_REQUEST_ID_MAP", "")
    if raw:
        try:
            id_map = json.loads(raw)
            ids = id_map.get(action_key, [])
            if ids:
                approval_id = ids.pop(0)
                if not ids:
                    id_map.pop(action_key, None)
                else:
                    id_map[action_key] = ids
                os.environ["NUMA_REQUEST_ID_MAP"] = json.dumps(id_map)
                return approval_id
        except (json.JSONDecodeError, TypeError):
            pass
    return os.environ.get("NUMA_REQUEST_ID", "")


# ═════════════════════════════════════════════════════════════════════════════
# Operation handlers
# ═════════════════════════════════════════════════════════════════════════════


async def _handle_list_secrets(params: dict[str, Any]) -> dict[str, Any]:
    """List vault secret metadata (no values)."""
    result = _invoke_workspace_tool("vault_list_secrets", {})

    if isinstance(result, dict) and result.get("error"):
        return {
            "content": [{"type": "text", "text": f"Error: {result['error']}"}],
            "is_error": True,
            "isError": True,
        }

    items = result.get("items", []) if isinstance(result, dict) else []
    if not items:
        return {
            "content": [
                {
                    "type": "text",
                    "text": "The user's vault is empty. No secrets are stored.",
                }
            ],
        }

    lines = ["Available vault secrets:\n"]
    for item in items:
        name = item.get("name", "?")
        secret_type = item.get("type", "custom")
        category = item.get("category", "General")
        danger = " [DANGER MODE]" if item.get("danger_mode") else ""
        lines.append(f"- {name} ({secret_type}, {category}){danger}")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
    }


async def _handle_request_secret(params: dict[str, Any]) -> dict[str, Any]:
    """Request a vault secret with approval flow."""
    secret_name = params.get("secret_name", "")
    purpose = params.get("purpose", "")

    if not secret_name:
        return {
            "content": [{"type": "text", "text": "Error: secret_name is required"}],
            "is_error": True,
            "isError": True,
        }
    if not purpose:
        return {
            "content": [{"type": "text", "text": "Error: purpose is required"}],
            "is_error": True,
            "isError": True,
        }

    result = _invoke_workspace_tool(
        "vault_request_secret",
        {
            "secret_name": secret_name,
            "purpose": purpose,
            "request_id": _pop_approval_id(f"vault:{secret_name}"),
            "auto_approved": os.environ.get("NUMA_APPROVAL_MODE") == "auto",
        },
    )

    if isinstance(result, dict):
        status = result.get("status", "")

        if status == "denied":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Access to secret '{secret_name}' was denied by the user.",
                    }
                ],
            }

        if status == "timeout":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Approval timed out for secret '{secret_name}'. "
                            "The user did not respond before the approval window expired. "
                            "You can offer to try again if the user is ready to approve."
                        ),
                    }
                ],
            }

        if status == "not_found":
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Secret '{secret_name}' not found in the user's vault.",
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        if status == "success":
            # Secret fields are returned — available for this tool call only
            fields = result.get("fields", {})
            secret_type = result.get("type", "custom")
            field_summary = ", ".join(fields.keys())
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Secret '{secret_name}' retrieved successfully.\n"
                            f"Type: {secret_type}\n"
                            f"Fields: {field_summary}\n\n"
                            "IMPORTANT: Do not display these values to the user. "
                            "Use them directly in API calls or configuration."
                        ),
                    },
                    {
                        "type": "text",
                        "text": json.dumps(fields),
                    },
                ],
            }

        if result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

    return {
        "content": [
            {"type": "text", "text": f"Unexpected response from vault: {result}"}
        ],
        "is_error": True,
        "isError": True,
    }


# ═════════════════════════════════════════════════════════════════════════════
# Vault operation dispatch map + MCP tool definition
# ═════════════════════════════════════════════════════════════════════════════

VAULT_HANDLERS = {
    "list_secrets": _handle_list_secrets,
    "request_secret": _handle_request_secret,
}

VAULT_OPERATIONS = list(VAULT_HANDLERS.keys())


@tool(
    name="vault",
    description=(
        "Access the user's secrets vault. List available secrets (names and metadata "
        "only) or request a specific secret with user approval. Secret values are "
        "returned for one-time use only — never log, display, or persist them."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "enum": VAULT_OPERATIONS,
                "description": "The vault operation to execute",
            },
            "params": {
                "type": "object",
                "description": (
                    "Operation-specific parameters. list_secrets takes no params. "
                    "request_secret needs 'secret_name' and 'purpose'."
                ),
            },
            "description": {
                "type": "string",
                "description": (
                    "Human-readable description of what this tool call does (shown to the user)"
                ),
            },
        },
        "required": ["name", "params", "description"],
    },
)
async def vault(args: dict[str, Any]) -> dict[str, Any]:
    """Unified vault tool dispatcher.

    Routes to the appropriate handler based on the `name` parameter.
    """
    name = args.get("name", "")
    params = args.get("params", {})

    # Recover from a known model malformation: when the params payload is large,
    # Claude sometimes inlines it as a JSON-encoded string instead of an object.
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError as e:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Invalid params for '{name}': expected an object, got a "
                            f"string that could not be parsed as JSON ({e}). Pass params "
                            f"as a JSON object, not a stringified blob."
                        ),
                    }
                ],
                "is_error": True,
                "isError": True,
            }
    if not isinstance(params, dict):
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"Invalid params for '{name}': expected object, "
                        f"got {type(params).__name__}."
                    ),
                }
            ],
            "is_error": True,
            "isError": True,
        }

    handler = VAULT_HANDLERS.get(name)
    if not handler:
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"Unknown vault operation: '{name}'. "
                        f"Valid: {', '.join(VAULT_OPERATIONS)}"
                    ),
                }
            ],
            "is_error": True,
            "isError": True,
        }

    try:
        return await handler(params)
    except Exception as e:
        logger.exception("vault handler failed", operation=name)
        return {
            "content": [{"type": "text", "text": f"Error in vault.{name}: {e}"}],
            "is_error": True,
            "isError": True,
        }
