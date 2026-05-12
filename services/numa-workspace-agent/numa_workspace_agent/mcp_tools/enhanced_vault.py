"""
Enhanced vault secrets MCP tools for the consolidated workspace agent.

Provides tools for requesting secrets from the user's consolidated vault,
managing multiple OAuth connectors, and creating template-based connections.

SECURITY:
- Secret values are NEVER logged or included in text output to the user.
- Secrets are returned as tool results only and must not be persisted.
- The agent should use secrets for one-time operations only.
- Multiple connectors allow users to have several accounts of the same type.
"""

import json
import os
from typing import Any, Dict, List

import structlog
from claude_agent_sdk import tool

logger = structlog.get_logger()


def _invoke_workspace_tool(tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
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


@tool(
    name="list_vault_secrets",
    description=(
        "List the names and metadata of secrets stored in the user's consolidated vault. "
        "Returns secret names, types, categories, templates, and connector info — NOT the actual secret values. "
        "Use this to discover what credentials are available, including multiple connectors of the same type."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "Optional: Filter by provider type (e.g., 'googledrive', 'gmail', 'slack')",
            },
            "category": {
                "type": "string",
                "description": "Optional: Filter by category (e.g., 'OAuth Clients', 'API Keys')",
            },
        },
    },
)
async def list_vault_secrets(args: Dict[str, Any]) -> Dict[str, Any]:
    """List vault secret metadata from consolidated vault."""
    try:
        provider = args.get("provider")
        category = args.get("category")

        result = _invoke_workspace_tool(
            "vault_list_consolidated_secrets",
            {"provider": provider, "category": category},
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        vault_info = result.get("vault_info", {})
        secrets = result.get("secrets", [])

        if not secrets:
            filter_text = ""
            if provider:
                filter_text += f" for provider '{provider}'"
            if category:
                filter_text += f" in category '{category}'"

            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"The user's vault is empty{filter_text}. No secrets are stored.",
                    }
                ],
            }

        # Group by provider for better organization
        by_provider = {}
        for secret in secrets:
            secret_type = secret.get("type", "custom")
            template = secret.get("template", "")

            # Determine provider for grouping
            if template and template.endswith("-oauth"):
                provider_key = template.replace("-oauth", "")
            elif secret_type in [
                "googledrive",
                "gmail",
                "slack",
                "onedrive",
                "dropbox",
            ]:
                provider_key = secret_type
            else:
                provider_key = "other"

            if provider_key not in by_provider:
                by_provider[provider_key] = []
            by_provider[provider_key].append(secret)

        lines = [
            f"Available vault secrets ({vault_info.get('secret_count', len(secrets))} total):\n"
        ]

        for provider_key, provider_secrets in by_provider.items():
            if provider_key != "other":
                lines.append(f"\n{provider_key.upper()} Connectors:")

            for secret in provider_secrets:
                name = secret.get("name", "?")
                secret_type = secret.get("type", "custom")
                category = secret.get("category", "General")
                template = secret.get("template")

                template_info = f" [Template: {template}]" if template else " [Custom]"
                danger_info = " [DANGER MODE]" if secret.get("danger_mode") else ""
                valid_info = (
                    " [INVALID]" if secret.get("validation_passed") is False else ""
                )

                lines.append(
                    f"  - {name} ({secret_type}, {category}){template_info}{danger_info}{valid_info}"
                )

        vault_meta = vault_info.get("vault_metadata", {})
        if vault_meta:
            lines.append(
                f"\nVault Info: Version {vault_meta.get('version', '2.0')}, Last Updated: {vault_meta.get('updated_at', 'Unknown')}"
            )

        return {
            "content": [{"type": "text", "text": "\n".join(lines)}],
        }

    except Exception as e:
        logger.exception("Error in list_vault_secrets")
        return {
            "content": [{"type": "text", "text": f"Error listing vault secrets: {e}"}],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="request_vault_secret",
    description=(
        "Request a specific secret from the user's consolidated vault by name. "
        "The user will be shown an approval card unless the secret has danger mode enabled. "
        "IMPORTANT: Never log, print, echo, or include the secret value in your text responses. "
        "Use the returned credentials directly in API calls or configurations, then discard them. "
        "Never write secret values to files. For multiple connectors, specify the exact connector name."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "secret_name": {
                "type": "string",
                "description": "The exact name of the secret/connector to retrieve (must match a secret in the vault)",
            },
            "purpose": {
                "type": "string",
                "description": "Brief description of why you need this secret (shown to user for approval)",
            },
        },
        "required": ["secret_name", "purpose"],
    },
)
async def request_vault_secret(args: Dict[str, Any]) -> Dict[str, Any]:
    """Request a specific secret from consolidated vault with approval."""
    try:
        secret_name = args.get("secret_name", "")
        purpose = args.get("purpose", "AI assistant usage")

        if not secret_name:
            return {
                "content": [{"type": "text", "text": "Error: secret_name is required"}],
                "is_error": True,
                "isError": True,
            }

        # Get approval ID for this request
        approval_id = _pop_approval_id("vault_access")

        result = _invoke_workspace_tool(
            "vault_request_consolidated_secret",
            {
                "secret_name": secret_name,
                "purpose": purpose,
                "request_id": approval_id,
            },
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        # Check for approval required
        if result.get("approval_required"):
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Requesting approval for secret '{secret_name}' (Purpose: {purpose}). Please check your approval card.",
                    }
                ],
            }

        # Extract secret fields (this is sensitive data - handle carefully)
        secret_fields = result.get("secret", {}).get("fields", {})
        secret_metadata = result.get("secret", {})

        if not secret_fields:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Secret '{secret_name}' was found but contains no credential fields.",
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        # Return the secret for use (DO NOT include in text output)
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"✓ Successfully retrieved secret '{secret_name}'. The credentials are now available for use.",
                }
            ],
            "secret_fields": secret_fields,
            "secret_metadata": {
                "name": secret_name,
                "type": secret_metadata.get("type"),
                "template": secret_metadata.get("template"),
                "category": secret_metadata.get("category"),
            },
        }

    except Exception as e:
        logger.exception("Error in request_vault_secret")
        return {
            "content": [
                {"type": "text", "text": f"Error requesting vault secret: {e}"}
            ],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="list_oauth_connectors",
    description=(
        "List OAuth connectors for a specific provider, showing multiple accounts/connections. "
        "This helps identify which connector to use when a user has multiple accounts of the same type."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "OAuth provider name (e.g., 'googledrive', 'gmail', 'slack', 'onedrive')",
            },
        },
        "required": ["provider"],
    },
)
async def list_oauth_connectors(args: Dict[str, Any]) -> Dict[str, Any]:
    """List OAuth connectors for a specific provider."""
    try:
        provider = args.get("provider", "")
        if not provider:
            return {
                "content": [{"type": "text", "text": "Error: provider is required"}],
                "is_error": True,
                "isError": True,
            }

        result = _invoke_workspace_tool(
            "oauth_list_connectors",
            {
                "provider": provider,
            },
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        connectors = result.get("connectors", [])

        if not connectors:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"No {provider} connectors found. User may need to connect their {provider} account first.",
                    }
                ],
            }

        lines = [f"{provider.upper()} Connectors:\n"]

        for connector in connectors:
            name = connector.get("name", "?")
            display_name = connector.get("display_name", name)
            user_email = connector.get("user_email", "")
            is_valid = connector.get("is_valid", False)
            template = connector.get("template")

            status = "✓ Valid" if is_valid else "⚠ Invalid/Expired"
            email_info = f" ({user_email})" if user_email else ""
            template_info = f" [Template: {template}]" if template else " [Custom]"

            lines.append(f"  - {display_name}{email_info} - {status}{template_info}")
            lines.append(f"    Connector Name: '{name}'")

        lines.append(
            f"\nUse 'request_vault_secret' with the exact connector name to access credentials."
        )

        return {
            "content": [{"type": "text", "text": "\n".join(lines)}],
        }

    except Exception as e:
        logger.exception("Error in list_oauth_connectors")
        return {
            "content": [
                {"type": "text", "text": f"Error listing OAuth connectors: {e}"}
            ],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="create_oauth_connector",
    description=(
        "Create a new OAuth connector from a template for a specific provider. "
        "This allows users to connect multiple accounts of the same type (e.g., personal and work Google Drive). "
        "Requires user approval and OAuth flow completion."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "OAuth provider name (e.g., 'googledrive', 'gmail', 'slack')",
            },
            "connector_name": {
                "type": "string",
                "description": "Custom name for this connector (e.g., 'work-gmail', 'personal-googledrive')",
            },
            "display_name": {
                "type": "string",
                "description": "User-friendly display name for this connector",
            },
            "description": {
                "type": "string",
                "description": "Optional description of this connector's purpose",
            },
        },
        "required": ["provider", "connector_name"],
    },
)
async def create_oauth_connector(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new OAuth connector using templates."""
    try:
        provider = args.get("provider", "")
        connector_name = args.get("connector_name", "")
        display_name = args.get("display_name", "")
        description = args.get("description", "")

        if not provider or not connector_name:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "Error: provider and connector_name are required",
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        result = _invoke_workspace_tool(
            "oauth_create_connector",
            {
                "provider": provider,
                "connector_name": connector_name,
                "display_name": display_name,
                "description": description,
            },
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        auth_url = result.get("auth_url")
        if auth_url:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"✓ OAuth connector '{connector_name}' created for {provider}.\n\n"
                        f"Please complete the OAuth flow by visiting:\n{auth_url}\n\n"
                        f"After authorization, the connector will be ready for use.",
                    }
                ],
            }
        else:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"✓ OAuth connector '{connector_name}' created for {provider}.",
                    }
                ],
            }

    except Exception as e:
        logger.exception("Error in create_oauth_connector")
        return {
            "content": [
                {"type": "text", "text": f"Error creating OAuth connector: {e}"}
            ],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="list_available_templates",
    description=(
        "List all available secret templates that can be used to create structured secrets. "
        "Templates provide validation and consistency for common secret types like OAuth, API keys, and database connections."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "Optional: Filter by category (e.g., 'OAuth Clients', 'API Keys', 'Databases')",
            },
        },
    },
)
async def list_available_templates(args: Dict[str, Any]) -> Dict[str, Any]:
    """List available templates for creating structured secrets."""
    try:
        category = args.get("category")

        result = _invoke_workspace_tool(
            "vault_list_templates",
            {
                "category": category,
            },
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        templates = result.get("templates", [])

        if not templates:
            filter_text = f" in category '{category}'" if category else ""
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"No templates found{filter_text}.",
                    }
                ],
            }

        # Group by category
        by_category = {}
        for template in templates:
            cat = template.get("category", "General")
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(template)

        lines = ["Available Secret Templates:\n"]

        for category, cat_templates in by_category.items():
            lines.append(f"\n{category}:")

            for template in cat_templates:
                name = template.get("name", "")
                display_name = template.get("display_name", name)
                description = template.get("description", "")
                version = template.get("version", "1.0")
                req_fields = template.get("required_field_count", 0)
                opt_fields = template.get("optional_field_count", 0)

                lines.append(f"  - {display_name} (v{version})")
                lines.append(f"    Template Name: '{name}'")
                lines.append(f"    Description: {description}")
                lines.append(
                    f"    Fields: {req_fields} required, {opt_fields} optional"
                )

        lines.append(
            "\nUse templates when creating secrets for validation and consistency."
        )

        return {
            "content": [{"type": "text", "text": "\n".join(lines)}],
        }

    except Exception as e:
        logger.exception("Error in list_available_templates")
        return {
            "content": [{"type": "text", "text": f"Error listing templates: {e}"}],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="create_custom_secret",
    description=(
        "Create a completely custom secret without template constraints. "
        "This allows storing any type of credential or configuration data with unlimited flexibility. "
        "Use this for non-standard secrets that don't fit existing templates."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "secret_name": {
                "type": "string",
                "description": "Name for the new secret",
            },
            "display_name": {
                "type": "string",
                "description": "User-friendly display name",
            },
            "secret_type": {
                "type": "string",
                "description": "Type of secret (e.g., 'api_key', 'database', 'custom')",
            },
            "category": {
                "type": "string",
                "description": "Category for organization (e.g., 'API Keys', 'Databases', 'Custom')",
            },
            "description": {
                "type": "string",
                "description": "Description of the secret's purpose",
            },
            "fields": {
                "type": "object",
                "description": "Secret field data as key-value pairs (any structure allowed)",
            },
        },
        "required": ["secret_name", "fields"],
    },
)
async def create_custom_secret(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a custom secret without template constraints."""
    try:
        secret_name = args.get("secret_name", "")
        display_name = args.get("display_name", secret_name)
        secret_type = args.get("secret_type", "custom")
        category = args.get("category", "Custom")
        description = args.get("description", "")
        fields = args.get("fields", {})

        if not secret_name or not fields:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "Error: secret_name and fields are required",
                    }
                ],
                "is_error": True,
                "isError": True,
            }

        result = _invoke_workspace_tool(
            "vault_create_custom_secret",
            {
                "secret_name": secret_name,
                "display_name": display_name,
                "secret_type": secret_type,
                "category": category,
                "description": description,
                "fields": fields,
            },
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"✓ Custom secret '{secret_name}' created successfully.\n"
                    f"Type: {secret_type}, Category: {category}\n"
                    f"The secret is now available in your vault.",
                }
            ],
        }

    except Exception as e:
        logger.exception("Error in create_custom_secret")
        return {
            "content": [{"type": "text", "text": f"Error creating custom secret: {e}"}],
            "is_error": True,
            "isError": True,
        }


@tool(
    name="delete_vault_secret",
    description=(
        "Delete a secret from the user's vault. This action requires user confirmation "
        "and permanently removes the secret and all its data."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "secret_name": {
                "type": "string",
                "description": "Name of the secret to delete",
            },
            "confirm": {
                "type": "boolean",
                "description": "Confirmation that the user wants to delete this secret",
            },
        },
        "required": ["secret_name", "confirm"],
    },
)
async def delete_vault_secret(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a secret from the vault with confirmation."""
    try:
        secret_name = args.get("secret_name", "")
        confirm = args.get("confirm", False)

        if not secret_name:
            return {
                "content": [{"type": "text", "text": "Error: secret_name is required"}],
                "is_error": True,
                "isError": True,
            }

        if not confirm:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Deletion cancelled. To delete '{secret_name}', call this tool with confirm=true.",
                    }
                ],
            }

        # Get approval ID for this request
        approval_id = _pop_approval_id("vault_delete")

        result = _invoke_workspace_tool(
            "vault_delete_secret",
            {
                "secret_name": secret_name,
                "request_id": approval_id,
            },
        )

        if isinstance(result, dict) and result.get("error"):
            return {
                "content": [{"type": "text", "text": f"Error: {result['error']}"}],
                "is_error": True,
                "isError": True,
            }

        # Check for approval required
        if result.get("approval_required"):
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Requesting approval to delete secret '{secret_name}'. Please check your approval card.",
                    }
                ],
            }

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"✓ Secret '{secret_name}' has been permanently deleted from your vault.",
                }
            ],
        }

    except Exception as e:
        logger.exception("Error in delete_vault_secret")
        return {
            "content": [{"type": "text", "text": f"Error deleting vault secret: {e}"}],
            "is_error": True,
            "isError": True,
        }
