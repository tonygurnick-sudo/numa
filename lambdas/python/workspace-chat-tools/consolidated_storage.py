"""Consolidated storage system for vault secrets with unlimited flexibility and template support."""

from __future__ import annotations

import base64
import gzip
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

COMPANY_USER_ID = "COMPANY"
VAULT_VERSION = "2.0"

# AWS Secrets Manager has a 64KB limit per secret
# We'll compress large vaults to stay within limits
MAX_UNCOMPRESSED_SIZE = 60 * 1024  # 60KB to leave room for metadata


def _generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid4())


def _get_current_timestamp() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat()


def _compress_vault_data(vault_data: Dict[str, Any]) -> str:
    """Compress vault data if it's large to fit within AWS limits."""
    json_str = json.dumps(vault_data, separators=(",", ":"))

    if len(json_str.encode("utf-8")) <= MAX_UNCOMPRESSED_SIZE:
        # Small enough, return as-is
        return json_str

    # Compress large vaults
    compressed = gzip.compress(json_str.encode("utf-8"))
    compressed_b64 = base64.b64encode(compressed).decode("utf-8")

    # Wrap compressed data with metadata
    return json.dumps(
        {"_compressed": True, "_version": VAULT_VERSION, "_data": compressed_b64},
        separators=(",", ":"),
    )


def _decompress_vault_data(raw_data: str) -> Dict[str, Any]:
    """Decompress vault data if it was compressed."""
    try:
        data = json.loads(raw_data)

        # Check if it's compressed
        if isinstance(data, dict) and data.get("_compressed"):
            compressed_b64 = data.get("_data", "")
            compressed_bytes = base64.b64decode(compressed_b64)
            decompressed_str = gzip.decompress(compressed_bytes).decode("utf-8")
            return json.loads(decompressed_str)

        # Not compressed, return as-is
        return data
    except Exception as e:
        logger.error("Failed to decompress vault data", error=str(e))
        # Return empty vault structure if decompression fails
        return {
            "secrets": {},
            "metadata": {
                "version": VAULT_VERSION,
                "created_at": _get_current_timestamp(),
                "updated_at": _get_current_timestamp(),
                "secret_count": 0,
                "total_size": 0,
            },
        }


def _get_secret_name_for_user(client_name: str, user_id: str) -> str:
    """Generate AWS Secrets Manager secret name for user vault."""
    return f"{client_name}/vault/users/{user_id}"


def _get_secret_name_for_company(client_name: str) -> str:
    """Generate AWS Secrets Manager secret name for company vault."""
    return f"{client_name}/vault/company"


def _create_empty_vault() -> Dict[str, Any]:
    """Create empty vault structure."""
    now = _get_current_timestamp()
    return {
        "secrets": {},
        "metadata": {
            "version": VAULT_VERSION,
            "created_at": now,
            "updated_at": now,
            "secret_count": 0,
            "total_size": 0,
        },
    }


def _create_empty_company_vault() -> Dict[str, Any]:
    """Create empty company vault structure with templates section."""
    now = _get_current_timestamp()
    return {
        "secrets": {},
        "templates": {},
        "metadata": {
            "version": VAULT_VERSION,
            "created_at": now,
            "updated_at": now,
            "secret_count": 0,
            "template_count": 0,
            "total_size": 0,
        },
    }


def _update_vault_metadata(vault_data: Dict[str, Any]) -> None:
    """Update vault metadata (secret count, size, timestamps)."""
    vault_data["metadata"]["updated_at"] = _get_current_timestamp()
    vault_data["metadata"]["secret_count"] = len(vault_data.get("secrets", {}))

    # Estimate total size
    try:
        estimated_size = len(
            json.dumps(vault_data, separators=(",", ":")).encode("utf-8")
        )
        vault_data["metadata"]["total_size"] = estimated_size
    except Exception:
        vault_data["metadata"]["total_size"] = 0


def _generate_secret_name(
    user_id: str,
    secret_type: str,
    naming_strategy: str = "user_provided",
    base_name: Optional[str] = None,
) -> str:
    """Generate appropriate secret name based on strategy."""
    if naming_strategy == "user_provided" and base_name:
        return base_name
    elif naming_strategy == "auto_generated":
        # Find existing secrets of same type to generate sequential number
        vault = get_consolidated_vault(user_id)
        same_type_count = 0
        for secret in vault.get("secrets", {}).values():
            if secret.get("type") == secret_type:
                same_type_count += 1
        return f"{secret_type}-{same_type_count + 1}"
    elif naming_strategy == "uuid_based":
        return _generate_uuid()
    else:
        # Fallback to UUID
        return _generate_uuid()


# ---------------------------------------------------------------------------
# Core Vault Operations
# ---------------------------------------------------------------------------


def get_consolidated_vault(
    user_id: str, client_name: Optional[str] = None
) -> Dict[str, Any]:
    """Get user's complete consolidated vault from Secrets Manager (unlimited size)."""
    if not client_name:
        client_name = os.environ.get("CLIENT_NAME")
        if not client_name:
            raise ValueError("client_name is required")

    secrets_client = prm_client("secretsmanager")

    if user_id == COMPANY_USER_ID:
        secret_name = _get_secret_name_for_company(client_name)
    else:
        secret_name = _get_secret_name_for_user(client_name, user_id)

    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        secret_string = response.get("SecretString", "{}")
        vault_data = _decompress_vault_data(secret_string)

        # Ensure proper structure
        if user_id == COMPANY_USER_ID:
            if "templates" not in vault_data:
                vault_data["templates"] = {}
            if "secret_count" not in vault_data.get("metadata", {}):
                vault_data["metadata"]["secret_count"] = len(
                    vault_data.get("secrets", {})
                )
            if "template_count" not in vault_data.get("metadata", {}):
                vault_data["metadata"]["template_count"] = len(
                    vault_data.get("templates", {})
                )

        return vault_data
    except secrets_client.exceptions.ResourceNotFoundException:
        # Secret doesn't exist, return empty vault
        if user_id == COMPANY_USER_ID:
            return _create_empty_company_vault()
        else:
            return _create_empty_vault()
    except Exception as e:
        logger.error(
            "Failed to retrieve consolidated vault",
            user_id=user_id,
            secret_name=secret_name,
            error=str(e),
        )
        # Return empty vault on error
        if user_id == COMPANY_USER_ID:
            return _create_empty_company_vault()
        else:
            return _create_empty_vault()


def update_consolidated_vault(
    user_id: str, vault_data: Dict[str, Any], client_name: Optional[str] = None
) -> None:
    """Save user's complete consolidated vault (handles any size with compression)."""
    if not client_name:
        client_name = os.environ.get("CLIENT_NAME")
        if not client_name:
            raise ValueError("client_name is required")

    secrets_client = prm_client("secretsmanager")

    if user_id == COMPANY_USER_ID:
        secret_name = _get_secret_name_for_company(client_name)
    else:
        secret_name = _get_secret_name_for_user(client_name, user_id)

    # Update metadata
    _update_vault_metadata(vault_data)

    # Compress if necessary
    secret_string = _compress_vault_data(vault_data)

    try:
        # Try to update existing secret
        secrets_client.put_secret_value(
            SecretId=secret_name, SecretString=secret_string
        )
    except secrets_client.exceptions.ResourceNotFoundException:
        # Secret doesn't exist, create it
        secrets_client.create_secret(
            Name=secret_name,
            SecretString=secret_string,
            Description=f"Consolidated vault for {'company' if user_id == COMPANY_USER_ID else 'user'}",
        )
    except Exception as e:
        logger.error(
            "Failed to update consolidated vault",
            user_id=user_id,
            secret_name=secret_name,
            error=str(e),
        )
        raise


def list_vault_secrets(
    user_id: str, client_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """List all secrets for user (metadata only, no field values)."""
    vault = get_consolidated_vault(user_id, client_name)
    secrets_list = []

    for name, secret in vault.get("secrets", {}).items():
        # Return metadata only, exclude sensitive fields
        secret_meta = {
            "id": secret.get("id"),
            "name": name,
            "display_name": secret.get("display_name", name),
            "type": secret.get("type"),
            "template": secret.get("template"),
            "category": secret.get("category"),
            "description": secret.get("description"),
            "danger_mode": secret.get("danger_mode", False),
            "favorite": secret.get("favorite", False),
            "help_url": secret.get("help_url", ""),
            "created_at": secret.get("metadata", {}).get("created_at"),
            "updated_at": secret.get("metadata", {}).get("updated_at"),
            "last_accessed_at": secret.get("metadata", {}).get("last_accessed_at"),
            "template_version": secret.get("metadata", {}).get("template_version"),
            "validation_passed": secret.get("metadata", {}).get(
                "validation_passed", True
            ),
        }
        secrets_list.append(secret_meta)

    return secrets_list


def get_vault_secret(
    user_id: str, secret_name: str, client_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Get a single secret with full field values."""
    vault = get_consolidated_vault(user_id, client_name)
    secret = vault.get("secrets", {}).get(secret_name)

    if not secret:
        return None

    # Update last_accessed_at
    secret["metadata"]["last_accessed_at"] = _get_current_timestamp()

    # Save updated vault
    update_consolidated_vault(user_id, vault, client_name)

    return secret


def add_secret_to_vault(
    user_id: str,
    secret_name: str,
    secret_data: Dict[str, Any],
    template: Optional[str] = None,
    client_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Add or update a single secret in user's consolidated vault."""
    vault = get_consolidated_vault(user_id, client_name)

    now = _get_current_timestamp()

    # Check if secret already exists
    existing_secret = vault.get("secrets", {}).get(secret_name)
    secret_id = existing_secret.get("id") if existing_secret else _generate_uuid()
    created_at = (
        existing_secret.get("metadata", {}).get("created_at")
        if existing_secret
        else now
    )

    # Create secret structure
    secret = {
        "id": secret_id,
        "name": secret_name,
        "display_name": secret_data.get("display_name", secret_name),
        "type": secret_data.get("type", "custom"),
        "template": template,
        "category": secret_data.get("category", "General"),
        "description": secret_data.get("description", ""),
        "danger_mode": secret_data.get("danger_mode", False),
        "favorite": secret_data.get("favorite", False),
        "help_url": secret_data.get("help_url", ""),
        "fields": secret_data.get("fields", {}),
        "metadata": {
            "template_version": secret_data.get("template_version"),
            "validation_passed": secret_data.get("validation_passed", True),
            "created_at": created_at,
            "updated_at": now,
            "last_accessed_at": now,
        },
    }

    # Add to vault
    vault["secrets"][secret_name] = secret

    # Save vault
    update_consolidated_vault(user_id, vault, client_name)

    return secret


def remove_secret_from_vault(
    user_id: str, secret_name: str, client_name: Optional[str] = None
) -> bool:
    """Remove a secret from user's consolidated vault."""
    vault = get_consolidated_vault(user_id, client_name)

    if secret_name not in vault.get("secrets", {}):
        return False

    # Remove secret
    del vault["secrets"][secret_name]

    # Save vault
    update_consolidated_vault(user_id, vault, client_name)

    return True


def bulk_import_secrets(
    user_id: str,
    secrets_data: List[Dict[str, Any]],
    conflict_resolution: str = "overwrite",
    client_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Import unlimited number of secrets in batch operation."""
    vault = get_consolidated_vault(user_id, client_name)
    results = []

    for secret_data in secrets_data:
        secret_name = secret_data.get("name")
        if not secret_name:
            # Generate name if not provided
            secret_name = _generate_secret_name(
                user_id,
                secret_data.get("type", "custom"),
                secret_data.get("naming_strategy", "uuid_based"),
            )

        # Handle conflicts
        if secret_name in vault.get("secrets", {}):
            if conflict_resolution == "skip":
                results.append(
                    {
                        "name": secret_name,
                        "status": "skipped",
                        "reason": "already_exists",
                    }
                )
                continue
            if conflict_resolution == "error":
                results.append(
                    {"name": secret_name, "status": "error", "reason": "already_exists"}
                )
                continue
            # conflict_resolution == "overwrite" - proceed to overwrite

        try:
            # Add secret to vault (in memory)
            now = _get_current_timestamp()
            secret_id = _generate_uuid()

            secret = {
                "id": secret_id,
                "name": secret_name,
                "display_name": secret_data.get("display_name", secret_name),
                "type": secret_data.get("type", "custom"),
                "template": secret_data.get("template"),
                "category": secret_data.get("category", "General"),
                "description": secret_data.get("description", ""),
                "danger_mode": secret_data.get("danger_mode", False),
                "favorite": secret_data.get("favorite", False),
                "help_url": secret_data.get("help_url", ""),
                "fields": secret_data.get("fields", {}),
                "metadata": {
                    "template_version": secret_data.get("template_version"),
                    "validation_passed": secret_data.get("validation_passed", True),
                    "created_at": now,
                    "updated_at": now,
                    "last_accessed_at": now,
                },
            }

            vault["secrets"][secret_name] = secret
            results.append({"name": secret_name, "status": "success", "id": secret_id})

        except Exception as e:
            logger.error(
                "Failed to import secret", secret_name=secret_name, error=str(e)
            )
            results.append({"name": secret_name, "status": "error", "reason": str(e)})

    # Save entire vault once
    update_consolidated_vault(user_id, vault, client_name)

    return results


# ---------------------------------------------------------------------------
# Template Management
# ---------------------------------------------------------------------------


def get_available_templates(client_name: Optional[str] = None) -> Dict[str, Any]:
    """Get all available templates from company vault."""
    company_vault = get_consolidated_vault(COMPANY_USER_ID, client_name)
    return company_vault.get("templates", {})


def get_template(
    template_name: str, client_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Get specific template definition."""
    templates = get_available_templates(client_name)
    return templates.get(template_name)


def validate_against_template(
    template_name: str, secret_data: Dict[str, Any], client_name: Optional[str] = None
) -> Tuple[bool, List[str]]:
    """Validate secret data against template. Returns (is_valid, errors)."""
    template = get_template(template_name, client_name)
    if not template:
        return False, [f"Template '{template_name}' not found"]

    errors = []
    fields = secret_data.get("fields", {})

    # Validate required fields
    for required_field in template.get("required_fields", []):
        field_name = required_field.get("name")
        if field_name not in fields or not fields[field_name]:
            errors.append(f"Required field '{field_name}' is missing")
            continue

        # Validate field type
        field_type = required_field.get("type")
        field_value = fields[field_name]

        if field_type == "string" and not isinstance(field_value, str):
            errors.append(f"Field '{field_name}' must be a string")
        elif field_type == "number" and not isinstance(field_value, (int, float)):
            errors.append(f"Field '{field_name}' must be a number")
        elif field_type == "boolean" and not isinstance(field_value, bool):
            errors.append(f"Field '{field_name}' must be a boolean")
        elif field_type == "object" and not isinstance(field_value, dict):
            errors.append(f"Field '{field_name}' must be an object")
        elif field_type == "datetime":
            # Basic datetime validation (ISO format)
            try:
                datetime.fromisoformat(str(field_value).replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                errors.append(f"Field '{field_name}' must be a valid ISO datetime")

        # Validate constraints
        validation = required_field.get("validation", "")
        if validation:
            field_errors = _validate_field_constraints(
                field_name, field_value, validation
            )
            errors.extend(field_errors)

    return len(errors) == 0, errors


def _validate_field_constraints(
    field_name: str, field_value: Any, validation: str
) -> List[str]:
    """Validate field against constraint rules."""
    errors = []
    constraints = [c.strip() for c in validation.split("|")]

    for constraint in constraints:
        if constraint == "required":
            if not field_value:
                errors.append(f"Field '{field_name}' is required")
        elif constraint.startswith("min:"):
            try:
                min_val = int(constraint.split(":")[1])
                if isinstance(field_value, str) and len(field_value) < min_val:
                    errors.append(
                        f"Field '{field_name}' must be at least {min_val} characters"
                    )
                elif isinstance(field_value, (int, float)) and field_value < min_val:
                    errors.append(f"Field '{field_name}' must be at least {min_val}")
            except (ValueError, IndexError):
                pass
        elif constraint.startswith("max:"):
            try:
                max_val = int(constraint.split(":")[1])
                if isinstance(field_value, str) and len(field_value) > max_val:
                    errors.append(
                        f"Field '{field_name}' must be at most {max_val} characters"
                    )
                elif isinstance(field_value, (int, float)) and field_value > max_val:
                    errors.append(f"Field '{field_name}' must be at most {max_val}")
            except (ValueError, IndexError):
                pass
        elif constraint == "email":
            if isinstance(field_value, str) and "@" not in field_value:
                errors.append(f"Field '{field_name}' must be a valid email address")
        elif constraint == "url":
            if isinstance(field_value, str) and not field_value.startswith(
                ("http://", "https://")
            ):
                errors.append(f"Field '{field_name}' must be a valid URL")
        elif constraint.startswith("in:"):
            try:
                allowed_values = constraint.split(":", 1)[1].split(",")
                if field_value not in allowed_values:
                    errors.append(
                        f"Field '{field_name}' must be one of: {', '.join(allowed_values)}"
                    )
            except IndexError:
                pass

    return errors


def create_secret_from_template(
    template_name: str, user_values: Dict[str, Any], client_name: Optional[str] = None
) -> Dict[str, Any]:
    """Create secret using template with user-provided values."""
    template = get_template(template_name, client_name)
    if not template:
        raise ValueError(f"Template '{template_name}' not found")

    # Apply default values from template
    secret_data = {
        "type": template_name.split("-")[0] if "-" in template_name else "custom",
        "template": template_name,
        **template.get("default_values", {}),
        **user_values,  # User values override defaults
    }

    # Validate against template
    is_valid, errors = validate_against_template(
        template_name, secret_data, client_name
    )
    if not is_valid:
        raise ValueError(f"Template validation failed: {', '.join(errors)}")

    secret_data["validation_passed"] = True
    secret_data["template_version"] = template.get("version", "1.0")

    return secret_data


def create_freeform_secret(secret_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create completely free-form secret with no template constraints."""
    # Minimal validation - ensure it's JSON serializable
    try:
        json.dumps(secret_data.get("fields", {}))
    except TypeError as e:
        raise ValueError(f"Secret fields must be JSON serializable: {e}")

    # Set free-form indicators
    secret_data["template"] = None
    secret_data["validation_passed"] = True
    secret_data["template_version"] = None

    return secret_data


# ---------------------------------------------------------------------------
# Template Management (Admin Operations)
# ---------------------------------------------------------------------------


def add_template_to_company_vault(
    template_name: str,
    template_definition: Dict[str, Any],
    client_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Add new template to company vault (admin only)."""
    company_vault = get_consolidated_vault(COMPANY_USER_ID, client_name)

    now = _get_current_timestamp()

    # Ensure template has required structure
    template = {
        "id": template_definition.get("id", f"template-{template_name}"),
        "name": template_definition.get("name", template_name),
        "description": template_definition.get("description", ""),
        "category": template_definition.get("category", "General"),
        "version": template_definition.get("version", "1.0"),
        "required_fields": template_definition.get("required_fields", []),
        "optional_fields": template_definition.get("optional_fields", []),
        "default_values": template_definition.get("default_values", {}),
        "metadata": {
            "created_at": now,
            "created_by": template_definition.get("created_by", "admin"),
            "usage_count": 0,
        },
    }

    # Add to company vault
    company_vault["templates"][template_name] = template

    # Update template count
    company_vault["metadata"]["template_count"] = len(company_vault["templates"])

    # Save company vault
    update_consolidated_vault(COMPANY_USER_ID, company_vault, client_name)

    return template


def remove_template_from_company_vault(
    template_name: str, client_name: Optional[str] = None
) -> bool:
    """Remove template from company vault (admin only)."""
    company_vault = get_consolidated_vault(COMPANY_USER_ID, client_name)

    if template_name not in company_vault.get("templates", {}):
        return False

    # Remove template
    del company_vault["templates"][template_name]

    # Update template count
    company_vault["metadata"]["template_count"] = len(company_vault["templates"])

    # Save company vault
    update_consolidated_vault(COMPANY_USER_ID, company_vault, client_name)

    return True
