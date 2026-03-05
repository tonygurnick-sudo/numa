"""Template validation and management engine for vault secrets."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from uuid import uuid4

import structlog

from consolidated_storage import (
    COMPANY_USER_ID,
    add_template_to_company_vault,
    get_available_templates,
    get_consolidated_vault,
    get_template,
    remove_template_from_company_vault,
)

logger = structlog.get_logger()


class TemplateValidator:
    """Validates secrets against templates with unlimited flexibility."""

    def __init__(self, client_name: str = None):
        self.client_name = client_name

    def validate_required_fields(
        self, template: Dict[str, Any], fields: Dict[str, Any]
    ) -> List[str]:
        """Validate all required fields are present and valid."""
        errors = []
        required_fields = template.get("required_fields", [])

        for field_def in required_fields:
            field_name = field_def.get("name")
            if not field_name:
                continue

            if field_name not in fields:
                errors.append(f"Required field '{field_name}' is missing")
                continue

            field_value = fields[field_name]
            if field_value is None or field_value == "":
                errors.append(f"Required field '{field_name}' cannot be empty")

        return errors

    def validate_field_types(
        self, template: Dict[str, Any], fields: Dict[str, Any]
    ) -> List[str]:
        """Validate field types match template definitions."""
        errors = []
        all_fields = template.get("required_fields", []) + template.get(
            "optional_fields", []
        )

        for field_def in all_fields:
            field_name = field_def.get("name")
            field_type = field_def.get("type", "string")

            if field_name not in fields:
                continue

            field_value = fields[field_name]
            if field_value is None:
                continue

            type_errors = self._validate_single_field_type(
                field_name, field_value, field_type
            )
            errors.extend(type_errors)

        return errors

    def _validate_single_field_type(
        self, field_name: str, field_value: Any, field_type: str
    ) -> List[str]:
        """Validate a single field's type."""
        errors = []

        if field_type == "string":
            if not isinstance(field_value, str):
                errors.append(f"Field '{field_name}' must be a string")
        elif field_type == "number":
            if not isinstance(field_value, (int, float)):
                errors.append(f"Field '{field_name}' must be a number")
        elif field_type == "integer":
            if not isinstance(field_value, int):
                errors.append(f"Field '{field_name}' must be an integer")
        elif field_type == "boolean":
            if not isinstance(field_value, bool):
                errors.append(f"Field '{field_name}' must be a boolean")
        elif field_type == "object":
            if not isinstance(field_value, dict):
                errors.append(f"Field '{field_name}' must be an object")
        elif field_type == "array":
            if not isinstance(field_value, list):
                errors.append(f"Field '{field_name}' must be an array")
        elif field_type == "datetime":
            if isinstance(field_value, str):
                try:
                    # Try to parse ISO format datetime
                    datetime.fromisoformat(field_value.replace("Z", "+00:00"))
                except ValueError:
                    errors.append(
                        f"Field '{field_name}' must be a valid ISO datetime string"
                    )
            else:
                errors.append(f"Field '{field_name}' must be a datetime string")
        elif field_type == "email":
            if not isinstance(field_value, str) or not self._is_valid_email(
                field_value
            ):
                errors.append(f"Field '{field_name}' must be a valid email address")
        elif field_type == "url":
            if not isinstance(field_value, str) or not self._is_valid_url(field_value):
                errors.append(f"Field '{field_name}' must be a valid URL")
        elif field_type == "json":
            # Validate that it's JSON serializable
            try:
                json.dumps(field_value)
            except (TypeError, ValueError):
                errors.append(f"Field '{field_name}' must be JSON serializable")

        return errors

    def validate_field_constraints(
        self, template: Dict[str, Any], fields: Dict[str, Any]
    ) -> List[str]:
        """Apply validation rules (min/max length, regex, etc)."""
        errors = []
        all_fields = template.get("required_fields", []) + template.get(
            "optional_fields", []
        )

        for field_def in all_fields:
            field_name = field_def.get("name")
            validation = field_def.get("validation", "")

            if field_name not in fields or not validation:
                continue

            field_value = fields[field_name]
            if field_value is None:
                continue

            constraint_errors = self._validate_field_constraints(
                field_name, field_value, validation
            )
            errors.extend(constraint_errors)

        return errors

    def _validate_field_constraints(
        self, field_name: str, field_value: Any, validation: str
    ) -> List[str]:
        """Validate field against constraint rules."""
        errors = []
        constraints = [c.strip() for c in validation.split("|") if c.strip()]

        for constraint in constraints:
            if constraint == "required":
                if not field_value:
                    errors.append(f"Field '{field_name}' is required")

            elif constraint.startswith("min:"):
                try:
                    min_val = int(constraint.split(":", 1)[1])
                    if isinstance(field_value, str) and len(field_value) < min_val:
                        errors.append(
                            f"Field '{field_name}' must be at least {min_val} characters"
                        )
                    elif (
                        isinstance(field_value, (int, float)) and field_value < min_val
                    ):
                        errors.append(
                            f"Field '{field_name}' must be at least {min_val}"
                        )
                    elif isinstance(field_value, list) and len(field_value) < min_val:
                        errors.append(
                            f"Field '{field_name}' must have at least {min_val} items"
                        )
                except (ValueError, IndexError):
                    logger.warning("Invalid min constraint", constraint=constraint)

            elif constraint.startswith("max:"):
                try:
                    max_val = int(constraint.split(":", 1)[1])
                    if isinstance(field_value, str) and len(field_value) > max_val:
                        errors.append(
                            f"Field '{field_name}' must be at most {max_val} characters"
                        )
                    elif (
                        isinstance(field_value, (int, float)) and field_value > max_val
                    ):
                        errors.append(f"Field '{field_name}' must be at most {max_val}")
                    elif isinstance(field_value, list) and len(field_value) > max_val:
                        errors.append(
                            f"Field '{field_name}' must have at most {max_val} items"
                        )
                except (ValueError, IndexError):
                    logger.warning("Invalid max constraint", constraint=constraint)

            elif constraint == "email":
                if not isinstance(field_value, str) or not self._is_valid_email(
                    field_value
                ):
                    errors.append(f"Field '{field_name}' must be a valid email address")

            elif constraint == "url":
                if not isinstance(field_value, str) or not self._is_valid_url(
                    field_value
                ):
                    errors.append(f"Field '{field_name}' must be a valid URL")

            elif constraint.startswith("in:"):
                try:
                    allowed_values = constraint.split(":", 1)[1].split(",")
                    allowed_values = [v.strip() for v in allowed_values]
                    if str(field_value) not in allowed_values:
                        errors.append(
                            f"Field '{field_name}' must be one of: {', '.join(allowed_values)}"
                        )
                except IndexError:
                    logger.warning("Invalid in constraint", constraint=constraint)

            elif constraint.startswith("regex:"):
                try:
                    pattern = constraint.split(":", 1)[1]
                    if isinstance(field_value, str) and not re.match(
                        pattern, field_value
                    ):
                        errors.append(
                            f"Field '{field_name}' does not match required pattern"
                        )
                except (IndexError, re.error):
                    logger.warning("Invalid regex constraint", constraint=constraint)

            elif constraint.startswith("unique_in:"):
                # For unique constraints within arrays of objects
                try:
                    path = constraint.split(":", 1)[1]
                    if isinstance(field_value, list):
                        values = [
                            self._get_nested_value(item, path) for item in field_value
                        ]
                        if len(values) != len(
                            set(str(v) for v in values if v is not None)
                        ):
                            errors.append(
                                f"Field '{field_name}' must have unique values for '{path}'"
                            )
                except IndexError:
                    logger.warning(
                        "Invalid unique_in constraint", constraint=constraint
                    )

        return errors

    def apply_default_values(
        self, template: Dict[str, Any], fields: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Apply template default values for missing optional fields."""
        result_fields = fields.copy()

        # Apply global defaults from template
        template_defaults = template.get("default_values", {})
        for key, value in template_defaults.items():
            if key not in result_fields:
                result_fields[key] = value

        # Apply field-specific defaults
        optional_fields = template.get("optional_fields", [])
        for field_def in optional_fields:
            field_name = field_def.get("name")
            if (
                field_name
                and field_name not in result_fields
                and "default" in field_def
            ):
                result_fields[field_name] = field_def["default"]

        return result_fields

    def validate_unlimited_fields(self, fields: Dict[str, Any]) -> bool:
        """Validate that unlimited field content is valid JSON/serializable."""
        try:
            json.dumps(fields)
            return True
        except (TypeError, ValueError) as e:
            logger.warning("Fields are not JSON serializable", error=str(e))
            return False

    def validate_complete_secret(
        self, template_name: str, secret_data: Dict[str, Any]
    ) -> Tuple[bool, List[str]]:
        """Complete validation of secret against template."""
        template = get_template(template_name, self.client_name)
        if not template:
            return False, [f"Template '{template_name}' not found"]

        fields = secret_data.get("fields", {})
        all_errors = []

        # Validate required fields
        all_errors.extend(self.validate_required_fields(template, fields))

        # Validate field types
        all_errors.extend(self.validate_field_types(template, fields))

        # Validate constraints
        all_errors.extend(self.validate_field_constraints(template, fields))

        # Validate JSON serializability
        if not self.validate_unlimited_fields(fields):
            all_errors.append("Secret fields must be JSON serializable")

        return len(all_errors) == 0, all_errors

    def _is_valid_email(self, email: str) -> bool:
        """Basic email validation."""
        email_pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
        return bool(re.match(email_pattern, email))

    def _is_valid_url(self, url: str) -> bool:
        """Basic URL validation."""
        url_pattern = r"^https?://[a-zA-Z0-9.-]+(?:\.[a-zA-Z]{2,})?(?:[/?#][^\s]*)?$"
        return bool(re.match(url_pattern, url))

    def _get_nested_value(self, obj: Any, path: str) -> Any:
        """Get nested value from object using dot notation."""
        keys = path.split(".")
        current = obj

        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None

        return current


class FreeFormValidator:
    """Minimal validation for free-form secrets."""

    def validate_json_serializable(self, fields: Dict[str, Any]) -> Tuple[bool, str]:
        """Ensure content can be stored in JSON format."""
        try:
            json.dumps(fields)
            return True, ""
        except (TypeError, ValueError) as e:
            return False, f"Fields must be JSON serializable: {e}"

    def validate_size_limits(self, fields: Dict[str, Any]) -> Tuple[bool, str]:
        """Check reasonable size limits for storage."""
        try:
            json_str = json.dumps(fields)
            size_bytes = len(json_str.encode("utf-8"))

            # AWS Secrets Manager limit is 64KB, but we allow larger with compression
            # Warn at 1MB uncompressed
            if size_bytes > 1024 * 1024:  # 1MB
                return (
                    False,
                    f"Secret size ({size_bytes} bytes) exceeds recommended limit",
                )

            return True, ""
        except Exception as e:
            return False, f"Unable to calculate secret size: {e}"

    def sanitize_content(self, fields: Dict[str, Any]) -> Dict[str, Any]:
        """Basic sanitization while preserving unlimited flexibility."""
        # For free-form secrets, we do minimal sanitization
        # Just ensure it's a proper dictionary
        if not isinstance(fields, dict):
            return {}

        return fields

    def validate_complete_freeform(
        self, secret_data: Dict[str, Any]
    ) -> Tuple[bool, List[str]]:
        """Complete validation of free-form secret."""
        errors = []
        fields = secret_data.get("fields", {})

        # Check JSON serializability
        is_serializable, error = self.validate_json_serializable(fields)
        if not is_serializable:
            errors.append(error)

        # Check size limits
        size_ok, size_error = self.validate_size_limits(fields)
        if not size_ok:
            errors.append(size_error)

        return len(errors) == 0, errors


class TemplateManager:
    """Manager for template CRUD operations."""

    def __init__(self, client_name: str = None):
        self.client_name = client_name
        self.validator = TemplateValidator(client_name)

    def create_initial_templates(self) -> Dict[str, Any]:
        """Create the initial 3 templates for common use cases."""
        templates = {
            "googledrive-oauth": {
                "id": "template-googledrive-oauth",
                "name": "Google Drive OAuth",
                "description": "Template for Google Drive OAuth connections",
                "category": "OAuth Clients",
                "version": "1.0",
                "required_fields": [
                    {
                        "name": "access_token",
                        "type": "string",
                        "description": "OAuth access token",
                        "validation": "required|min:10",
                    },
                    {
                        "name": "refresh_token",
                        "type": "string",
                        "description": "OAuth refresh token",
                        "validation": "required|min:10",
                    },
                    {
                        "name": "user_email",
                        "type": "email",
                        "description": "Connected Google account email",
                        "validation": "required|email",
                    },
                ],
                "optional_fields": [
                    {
                        "name": "expires_at",
                        "type": "datetime",
                        "description": "Token expiration time",
                    },
                    {
                        "name": "scope",
                        "type": "string",
                        "description": "OAuth scopes granted",
                    },
                    {
                        "name": "token_type",
                        "type": "string",
                        "description": "Token type (usually 'Bearer')",
                        "default": "Bearer",
                    },
                ],
                "default_values": {
                    "category": "OAuth Clients",
                    "help_url": "https://developers.google.com/drive/api/v3/about-auth",
                },
                "created_by": "system",
            },
            "api-key": {
                "id": "template-api-key",
                "name": "API Key",
                "description": "Template for API key based authentication",
                "category": "API Keys",
                "version": "1.0",
                "required_fields": [
                    {
                        "name": "api_key",
                        "type": "string",
                        "description": "API key value",
                        "validation": "required|min:8",
                    },
                    {
                        "name": "endpoint",
                        "type": "url",
                        "description": "API endpoint URL",
                        "validation": "required|url",
                    },
                ],
                "optional_fields": [
                    {
                        "name": "api_secret",
                        "type": "string",
                        "description": "API secret if required",
                    },
                    {
                        "name": "headers",
                        "type": "object",
                        "description": "Additional headers to send",
                    },
                    {
                        "name": "rate_limit",
                        "type": "integer",
                        "description": "Requests per minute limit",
                    },
                ],
                "default_values": {"category": "API Keys"},
                "created_by": "system",
            },
            "database-connection": {
                "id": "template-database-connection",
                "name": "Database Connection",
                "description": "Template for database connection strings",
                "category": "Databases",
                "version": "1.0",
                "required_fields": [
                    {
                        "name": "connection_string",
                        "type": "string",
                        "description": "Database connection string",
                        "validation": "required|min:10",
                    },
                    {
                        "name": "database_type",
                        "type": "string",
                        "description": "Database type",
                        "validation": "required|in:mysql,postgresql,mongodb,redis,sqlite,mssql,oracle",
                    },
                ],
                "optional_fields": [
                    {
                        "name": "username",
                        "type": "string",
                        "description": "Database username",
                    },
                    {
                        "name": "password",
                        "type": "string",
                        "description": "Database password",
                    },
                    {
                        "name": "ssl_config",
                        "type": "object",
                        "description": "SSL configuration options",
                    },
                    {
                        "name": "pool_size",
                        "type": "integer",
                        "description": "Connection pool size",
                        "default": 10,
                    },
                ],
                "default_values": {"category": "Databases"},
                "created_by": "system",
            },
        }

        results = {}
        for template_name, template_def in templates.items():
            try:
                result = add_template_to_company_vault(
                    template_name, template_def, self.client_name
                )
                results[template_name] = {"status": "created", "template": result}
            except Exception as e:
                logger.error(
                    "Failed to create template",
                    template_name=template_name,
                    error=str(e),
                )
                results[template_name] = {"status": "error", "error": str(e)}

        return results

    def list_templates(self) -> List[Dict[str, Any]]:
        """List all available templates with metadata."""
        templates = get_available_templates(self.client_name)
        template_list = []

        for name, template in templates.items():
            template_info = {
                "name": name,
                "id": template.get("id"),
                "display_name": template.get("name", name),
                "description": template.get("description", ""),
                "category": template.get("category", "General"),
                "version": template.get("version", "1.0"),
                "required_field_count": len(template.get("required_fields", [])),
                "optional_field_count": len(template.get("optional_fields", [])),
                "created_at": template.get("metadata", {}).get("created_at"),
                "created_by": template.get("metadata", {}).get("created_by"),
                "usage_count": template.get("metadata", {}).get("usage_count", 0),
            }
            template_list.append(template_info)

        return sorted(template_list, key=lambda x: x["name"])

    def get_template_usage_stats(self) -> Dict[str, Any]:
        """Get template usage statistics."""
        templates = get_available_templates(self.client_name)

        stats = {
            "total_templates": len(templates),
            "templates_by_category": {},
            "most_used_templates": [],
            "template_details": {},
        }

        for name, template in templates.items():
            category = template.get("category", "General")
            usage_count = template.get("metadata", {}).get("usage_count", 0)

            # Count by category
            if category not in stats["templates_by_category"]:
                stats["templates_by_category"][category] = 0
            stats["templates_by_category"][category] += 1

            # Track usage
            stats["template_details"][name] = {
                "usage_count": usage_count,
                "category": category,
                "version": template.get("version", "1.0"),
            }

        # Sort by usage for most used
        sorted_usage = sorted(
            stats["template_details"].items(),
            key=lambda x: x[1]["usage_count"],
            reverse=True,
        )
        stats["most_used_templates"] = [
            {"name": name, "usage_count": details["usage_count"]}
            for name, details in sorted_usage[:10]
        ]

        return stats

    def track_template_usage(self, template_name: str, user_id: str) -> None:
        """Track template usage for analytics."""
        try:
            company_vault = get_consolidated_vault(COMPANY_USER_ID, self.client_name)
            if template_name in company_vault.get("templates", {}):
                template = company_vault["templates"][template_name]
                template.setdefault("metadata", {})
                template["metadata"]["usage_count"] = (
                    template["metadata"].get("usage_count", 0) + 1
                )

                # Save updated vault
                from consolidated_storage import update_consolidated_vault

                update_consolidated_vault(
                    COMPANY_USER_ID, company_vault, self.client_name
                )

        except Exception as e:
            logger.error(
                "Failed to track template usage",
                template_name=template_name,
                user_id=user_id,
                error=str(e),
            )

    def validate_template_definition(
        self, template_def: Dict[str, Any]
    ) -> Tuple[bool, List[str]]:
        """Validate a template definition structure."""
        errors = []

        # Required fields in template definition
        required_template_fields = ["name", "description", "required_fields"]
        for field in required_template_fields:
            if field not in template_def:
                errors.append(f"Template must have '{field}' field")

        # Validate required_fields structure
        if "required_fields" in template_def:
            required_fields = template_def["required_fields"]
            if not isinstance(required_fields, list):
                errors.append("Template 'required_fields' must be an array")
            else:
                for i, field_def in enumerate(required_fields):
                    if not isinstance(field_def, dict):
                        errors.append(f"Required field {i} must be an object")
                        continue

                    if "name" not in field_def:
                        errors.append(f"Required field {i} must have 'name'")

                    if "type" not in field_def:
                        errors.append(f"Required field {i} must have 'type'")

        # Validate optional_fields structure if present
        if "optional_fields" in template_def:
            optional_fields = template_def["optional_fields"]
            if not isinstance(optional_fields, list):
                errors.append("Template 'optional_fields' must be an array")

        return len(errors) == 0, errors
