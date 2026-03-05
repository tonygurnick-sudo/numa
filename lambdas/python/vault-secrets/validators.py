"""Input validation for vault secret types."""

from __future__ import annotations

from typing import Any, Dict, Optional

VALID_SECRET_TYPES = {"login", "api_key", "bearer_token", "secure_note", "custom"}

# Required fields per secret type (the 'fields' dict inside the secret value)
TYPE_REQUIRED_FIELDS: Dict[str, list[str]] = {
    "login": ["username", "password"],
    "api_key": ["key"],
    "bearer_token": ["token"],
    "secure_note": ["content"],
    "custom": [],  # Custom type allows any key/value pairs
}

TYPE_OPTIONAL_FIELDS: Dict[str, list[str]] = {
    "login": ["url", "totp_seed"],
    "api_key": ["secret", "endpoint"],
    "bearer_token": ["endpoint", "prefix"],
    "secure_note": [],
    "custom": [],
}


def validate_secret_type(secret_type: str) -> Optional[str]:
    """Return an error message if the secret type is invalid."""
    if secret_type not in VALID_SECRET_TYPES:
        return f"Invalid secret type: {secret_type}. Must be one of: {', '.join(sorted(VALID_SECRET_TYPES))}"
    return None


def validate_secret_fields(secret_type: str, fields: Dict[str, Any]) -> Optional[str]:
    """Validate that required fields are present for the given type."""
    if not isinstance(fields, dict):
        return "fields must be a dictionary"

    required = TYPE_REQUIRED_FIELDS.get(secret_type, [])
    missing = [f for f in required if not fields.get(f)]
    if missing:
        return f"Missing required fields for type '{secret_type}': {', '.join(missing)}"

    return None


def validate_create_payload(body: Dict[str, Any]) -> Optional[str]:
    """Validate the full create-secret request body. Returns error message or None."""
    name = body.get("name")
    if not name or not isinstance(name, str) or not name.strip():
        return "name is required"

    secret_type = body.get("type", "custom")
    err = validate_secret_type(secret_type)
    if err:
        return err

    fields = body.get("fields")
    if not fields:
        return "fields is required"

    err = validate_secret_fields(secret_type, fields)
    if err:
        return err

    return None
