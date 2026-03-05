"""Lambda handlers for consolidated vault secrets endpoints with template support."""

from __future__ import annotations

import base64
import binascii
import json
import os
from typing import Any, Dict, List, Optional, Union

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from consolidated_storage import (
    COMPANY_USER_ID,
    add_secret_to_vault,
    add_template_to_company_vault,
    bulk_import_secrets,
    create_freeform_secret,
    create_secret_from_template,
    get_available_templates,
    get_consolidated_vault,
    get_template,
    get_vault_secret,
    list_vault_secrets,
    remove_secret_from_vault,
    remove_template_from_company_vault,
    update_consolidated_vault,
    validate_against_template,
)
from storage import (  # Keep audit logging from old system
    list_audit_logs,
    write_audit_log,
)
from template_engine import FreeFormValidator, TemplateManager, TemplateValidator

logger = structlog.get_logger()

# Environment variables
AUDIT_TABLE_NAME = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME")
CLIENT_NAME = os.environ.get("CLIENT_NAME")

# Constants
VAULT_VERSION = "2.0"


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Return a JSON API response with CORS headers."""
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }


def _get_user_id(event: Dict[str, Any]) -> Optional[str]:
    """Extract a user id from the request context or JWT token."""
    auth = event.get("requestContext", {}).get("authorizer", {})
    jwt = auth.get("jwt", {})
    claims = jwt.get("claims", {}) or {}
    if isinstance(claims, dict) and claims.get("sub"):
        return claims.get("sub")

    headers = event.get("headers") or {}
    token = headers.get("authorization") or headers.get("Authorization")
    if not token:
        return None
    try:
        payload = token.split(".")[1]
        decoded = json.loads(base64.b64decode(payload + "===").decode("utf-8"))
        return decoded.get("sub")
    except (
        IndexError,
        ValueError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        binascii.Error,
    ):
        return None


def _get_path(event: Dict[str, Any]) -> str:
    """Return the request path from the event."""
    return event.get("requestContext", {}).get("http", {}).get("path", "")


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """Parse JSON request body, handling optional base64 encoding."""
    body = event.get("body") or ""
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        logger.warning("Failed to parse JSON body", body=body[:200])
        return {}


def _extract_path_segment(path: str, segment_index: int = -1) -> Optional[str]:
    """Extract a path segment by index (default: last segment)."""
    parts = [p for p in path.strip("/").split("/") if p]
    try:
        return parts[segment_index] if parts else None
    except IndexError:
        return None


def _is_admin(event: Dict[str, Any]) -> bool:
    """Check if the caller belongs to the admin Cognito group."""
    auth = event.get("requestContext", {}).get("authorizer", {})

    # JWT authorizer path
    claims = auth.get("jwt", {}).get("claims", {}) or {}
    groups = claims.get("cognito:groups", "")

    # Lambda authorizer path
    if not groups:
        lambda_ctx = auth.get("lambda", {})
        jwt_str = lambda_ctx.get("jwt", "")
        if jwt_str and isinstance(jwt_str, str):
            try:
                jwt_obj = json.loads(jwt_str)
                groups = jwt_obj.get("claims", {}).get("cognito:groups", "")
            except (json.JSONDecodeError, AttributeError):
                pass

    if isinstance(groups, str):
        groups = [g.strip() for g in groups.split(",") if g.strip()]
    if isinstance(groups, list):
        return "admin" in groups
    return False


def _write_audit_log(
    user_id: str,
    secret_name: str,
    action: str,
    accessor: str = "user",
    purpose: str = "",
    conversation_id: str = "",
) -> None:
    """Write audit log entry if audit table is configured."""
    if not AUDIT_TABLE_NAME:
        return

    try:
        write_audit_log(
            AUDIT_TABLE_NAME,
            user_id,
            secret_name,  # Using secret name as secret_id for consolidated system
            secret_name,
            action,
            accessor,
            purpose,
            conversation_id,
            approved_by="user",
        )
    except Exception as e:
        logger.error("Failed to write audit log", error=str(e))


def _validate_request_body(
    body: Dict[str, Any], required_fields: List[str] = None
) -> Optional[str]:
    """Validate request body has required fields."""
    required_fields = required_fields or []

    for field in required_fields:
        if field not in body:
            return f"Missing required field: {field}"

        if body[field] is None or (
            isinstance(body[field], str) and not body[field].strip()
        ):
            return f"Field '{field}' cannot be empty"

    return None


# ---------------------------------------------------------------------------
# User Secret Handlers (Consolidated Vault)
# ---------------------------------------------------------------------------


def _handle_list_secrets(user_id: str) -> Dict[str, Any]:
    """List all vault secrets for the user (metadata only)."""
    try:
        secrets_list = list_vault_secrets(user_id, CLIENT_NAME)
        vault_meta = get_consolidated_vault(user_id, CLIENT_NAME).get("metadata", {})

        return _response(
            200,
            {
                "secrets": secrets_list,
                "total_count": len(secrets_list),
                "vault_metadata": {
                    "version": vault_meta.get("version", VAULT_VERSION),
                    "created_at": vault_meta.get("created_at"),
                    "updated_at": vault_meta.get("updated_at"),
                    "secret_count": vault_meta.get("secret_count", len(secrets_list)),
                    "total_size": vault_meta.get("total_size", 0),
                },
            },
        )
    except Exception as e:
        logger.error("Failed to list secrets", user_id=user_id, error=str(e))
        return _response(500, {"error": "Failed to retrieve secrets"})


def _handle_get_secret(user_id: str, secret_name: str) -> Dict[str, Any]:
    """Get a single secret with full field values."""
    try:
        secret = get_vault_secret(user_id, secret_name, CLIENT_NAME)
        if not secret:
            return _response(404, {"error": "Secret not found"})

        # Write audit log
        _write_audit_log(user_id, secret_name, "user_view")

        return _response(200, {"secret": secret})
    except Exception as e:
        logger.error(
            "Failed to get secret",
            user_id=user_id,
            secret_name=secret_name,
            error=str(e),
        )
        return _response(500, {"error": "Failed to retrieve secret"})


def _handle_create_secret(event: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    """Create a new vault secret (template-based or free-form)."""
    try:
        body = _parse_body(event)

        # Validate basic required fields
        error = _validate_request_body(body, ["fields"])
        if error:
            return _response(400, {"error": error})

        # Check if using template
        template_name = body.get("template")
        secret_name = body.get("name")
        naming_strategy = body.get("naming_strategy", "user_provided")

        if template_name:
            # Template-based secret creation
            validator = TemplateValidator(CLIENT_NAME)
            template_manager = TemplateManager(CLIENT_NAME)

            # Validate against template
            is_valid, errors = validator.validate_complete_secret(template_name, body)
            if not is_valid:
                return _response(
                    400, {"error": "Template validation failed", "details": errors}
                )

            # Create secret from template
            secret_data = create_secret_from_template(template_name, body, CLIENT_NAME)

            # Track template usage
            template_manager.track_template_usage(template_name, user_id)
        else:
            # Free-form secret creation
            validator = FreeFormValidator()
            is_valid, errors = validator.validate_complete_freeform(body)
            if not is_valid:
                return _response(
                    400, {"error": "Free-form validation failed", "details": errors}
                )

            secret_data = create_freeform_secret(body)

        # Generate secret name if not provided
        if not secret_name:
            from consolidated_storage import _generate_secret_name

            secret_name = _generate_secret_name(
                user_id,
                secret_data.get("type", "custom"),
                naming_strategy,
                body.get("display_name"),
            )

        # Add to vault
        created_secret = add_secret_to_vault(
            user_id, secret_name, secret_data, template_name, CLIENT_NAME
        )

        # Write audit log
        _write_audit_log(user_id, secret_name, "user_create")

        return _response(201, {"secret": created_secret})

    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error("Failed to create secret", user_id=user_id, error=str(e))
        return _response(500, {"error": "Failed to create secret"})


def _handle_update_secret(
    event: Dict[str, Any], user_id: str, secret_name: str
) -> Dict[str, Any]:
    """Update an existing vault secret."""
    try:
        body = _parse_body(event)

        # Get existing secret
        existing_secret = get_vault_secret(user_id, secret_name, CLIENT_NAME)
        if not existing_secret:
            return _response(404, {"error": "Secret not found"})

        # Merge with existing data
        updated_data = {
            **existing_secret,
            **body,
            "fields": {**existing_secret.get("fields", {}), **body.get("fields", {})},
        }

        # If template is specified, validate against it
        template_name = updated_data.get("template")
        if template_name:
            validator = TemplateValidator(CLIENT_NAME)
            is_valid, errors = validator.validate_complete_secret(
                template_name, updated_data
            )
            if not is_valid:
                return _response(
                    400, {"error": "Template validation failed", "details": errors}
                )
        else:
            # Free-form validation
            validator = FreeFormValidator()
            is_valid, errors = validator.validate_complete_freeform(updated_data)
            if not is_valid:
                return _response(
                    400, {"error": "Free-form validation failed", "details": errors}
                )

        # Update secret
        updated_secret = add_secret_to_vault(
            user_id, secret_name, updated_data, template_name, CLIENT_NAME
        )

        # Write audit log
        _write_audit_log(user_id, secret_name, "user_update")

        return _response(200, {"secret": updated_secret})

    except Exception as e:
        logger.error(
            "Failed to update secret",
            user_id=user_id,
            secret_name=secret_name,
            error=str(e),
        )
        return _response(500, {"error": "Failed to update secret"})


def _handle_delete_secret(user_id: str, secret_name: str) -> Dict[str, Any]:
    """Delete a vault secret."""
    try:
        success = remove_secret_from_vault(user_id, secret_name, CLIENT_NAME)
        if not success:
            return _response(404, {"error": "Secret not found"})

        # Write audit log
        _write_audit_log(user_id, secret_name, "user_delete")

        return _response(
            200, {"success": True, "message": f"Secret '{secret_name}' deleted"}
        )
    except Exception as e:
        logger.error(
            "Failed to delete secret",
            user_id=user_id,
            secret_name=secret_name,
            error=str(e),
        )
        return _response(500, {"error": "Failed to delete secret"})


def _handle_bulk_create_secrets(event: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    """Bulk create/import multiple secrets."""
    try:
        body = _parse_body(event)

        error = _validate_request_body(body, ["secrets"])
        if error:
            return _response(400, {"error": error})

        secrets_data = body["secrets"]
        if not isinstance(secrets_data, list):
            return _response(400, {"error": "Field 'secrets' must be an array"})

        conflict_resolution = body.get("conflict_resolution", "overwrite")
        validation_mode = body.get("validation_mode", "strict")

        # Pre-validate if strict mode
        if validation_mode == "strict":
            template_validator = TemplateValidator(CLIENT_NAME)
            freeform_validator = FreeFormValidator()
            validation_errors = []

            for i, secret_data in enumerate(secrets_data):
                template_name = secret_data.get("template")
                if template_name:
                    is_valid, errors = template_validator.validate_complete_secret(
                        template_name, secret_data
                    )
                    if not is_valid:
                        validation_errors.extend(
                            [f"Secret {i}: {error}" for error in errors]
                        )
                else:
                    is_valid, errors = freeform_validator.validate_complete_freeform(
                        secret_data
                    )
                    if not is_valid:
                        validation_errors.extend(
                            [f"Secret {i}: {error}" for error in errors]
                        )

            if validation_errors:
                return _response(
                    400,
                    {"error": "Bulk validation failed", "details": validation_errors},
                )

        # Perform bulk import
        results = bulk_import_secrets(
            user_id, secrets_data, conflict_resolution, CLIENT_NAME
        )

        # Write audit log for successful imports
        for result in results:
            if result.get("status") == "success":
                _write_audit_log(user_id, result["name"], "user_bulk_create")

        return _response(
            200,
            {
                "results": results,
                "summary": {
                    "total": len(results),
                    "successful": len([r for r in results if r["status"] == "success"]),
                    "failed": len([r for r in results if r["status"] == "error"]),
                    "skipped": len([r for r in results if r["status"] == "skipped"]),
                },
            },
        )

    except Exception as e:
        logger.error("Failed to bulk create secrets", user_id=user_id, error=str(e))
        return _response(500, {"error": "Failed to bulk create secrets"})


def _handle_list_categories(user_id: str) -> Dict[str, Any]:
    """List distinct categories for the user's vault secrets."""
    try:
        secrets_list = list_vault_secrets(user_id, CLIENT_NAME)
        categories = sorted(
            {secret.get("category") or "General" for secret in secrets_list}
        )
        return _response(200, {"categories": categories})
    except Exception as e:
        logger.error("Failed to list categories", user_id=user_id, error=str(e))
        return _response(500, {"error": "Failed to retrieve categories"})


def _handle_list_audit_log(user_id: str, is_admin: bool = False) -> Dict[str, Any]:
    """List recent audit log entries for the user.

    Admins also see company-secret audit entries (stored under COMPANY_USER_ID).
    """
    try:
        if not AUDIT_TABLE_NAME:
            return _response(200, {"items": []})
        entries = list_audit_logs(AUDIT_TABLE_NAME, user_id)
        if is_admin:
            company_entries = list_audit_logs(AUDIT_TABLE_NAME, COMPANY_USER_ID)
            entries = sorted(
                entries + company_entries,
                key=lambda e: e.get("created_at", ""),
                reverse=True,
            )
        return _response(200, {"items": entries})
    except Exception as e:
        logger.error("Failed to list audit log", user_id=user_id, error=str(e))
        return _response(500, {"error": "Failed to retrieve audit log"})


# ---------------------------------------------------------------------------
# Template Management Handlers
# ---------------------------------------------------------------------------


def _handle_list_templates() -> Dict[str, Any]:
    """List all available templates."""
    try:
        template_manager = TemplateManager(CLIENT_NAME)
        templates = template_manager.list_templates()
        return _response(200, {"templates": templates})
    except Exception as e:
        logger.error("Failed to list templates", error=str(e))
        return _response(500, {"error": "Failed to retrieve templates"})


def _handle_get_template(template_name: str) -> Dict[str, Any]:
    """Get a specific template definition."""
    try:
        template = get_template(template_name, CLIENT_NAME)
        if not template:
            return _response(404, {"error": "Template not found"})

        return _response(200, {"template": template})
    except Exception as e:
        logger.error(
            "Failed to get template", template_name=template_name, error=str(e)
        )
        return _response(500, {"error": "Failed to retrieve template"})


def _handle_create_template(
    event: Dict[str, Any], admin_user_id: str
) -> Dict[str, Any]:
    """Create a new template (admin only)."""
    try:
        body = _parse_body(event)
        template_name = body.get("name")

        if not template_name:
            return _response(400, {"error": "Template name is required"})

        # Validate template definition
        template_manager = TemplateManager(CLIENT_NAME)
        is_valid, errors = template_manager.validate_template_definition(body)
        if not is_valid:
            return _response(
                400, {"error": "Invalid template definition", "details": errors}
            )

        # Add created_by info
        body["created_by"] = admin_user_id

        # Create template
        template = add_template_to_company_vault(template_name, body, CLIENT_NAME)

        return _response(201, {"template": template})
    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error(
            "Failed to create template", admin_user_id=admin_user_id, error=str(e)
        )
        return _response(500, {"error": "Failed to create template"})


def _handle_delete_template(template_name: str, admin_user_id: str) -> Dict[str, Any]:
    """Delete a template (admin only)."""
    try:
        success = remove_template_from_company_vault(template_name, CLIENT_NAME)
        if not success:
            return _response(404, {"error": "Template not found"})

        return _response(
            200, {"success": True, "message": f"Template '{template_name}' deleted"}
        )
    except Exception as e:
        logger.error(
            "Failed to delete template",
            template_name=template_name,
            admin_user_id=admin_user_id,
            error=str(e),
        )
        return _response(500, {"error": "Failed to delete template"})


def _handle_validate_secret(event: Dict[str, Any]) -> Dict[str, Any]:
    """Validate secret data against template without saving."""
    try:
        body = _parse_body(event)
        template_name = body.get("template")

        if not template_name:
            return _response(400, {"error": "Template name required for validation"})

        validator = TemplateValidator(CLIENT_NAME)
        is_valid, errors = validator.validate_complete_secret(template_name, body)

        return _response(
            200, {"valid": is_valid, "errors": errors, "template_name": template_name}
        )
    except Exception as e:
        logger.error("Failed to validate secret", error=str(e))
        return _response(500, {"error": "Failed to validate secret"})


def _handle_template_stats() -> Dict[str, Any]:
    """Get template usage statistics (admin only)."""
    try:
        template_manager = TemplateManager(CLIENT_NAME)
        stats = template_manager.get_template_usage_stats()
        return _response(200, {"stats": stats})
    except Exception as e:
        logger.error("Failed to get template stats", error=str(e))
        return _response(500, {"error": "Failed to retrieve template statistics"})


# ---------------------------------------------------------------------------
# Company Secret Handlers
# ---------------------------------------------------------------------------


def _handle_list_company_secrets() -> Dict[str, Any]:
    """List all company secrets (metadata only). Any authenticated user can call."""
    try:
        secrets_list = list_vault_secrets(COMPANY_USER_ID, CLIENT_NAME)

        # Filter out templates from the response (company vault has both secrets and templates)
        company_vault = get_consolidated_vault(COMPANY_USER_ID, CLIENT_NAME)
        vault_meta = company_vault.get("metadata", {})

        return _response(
            200,
            {
                "secrets": secrets_list,
                "total_count": len(secrets_list),
                "vault_metadata": {
                    "version": vault_meta.get("version", VAULT_VERSION),
                    "secret_count": vault_meta.get("secret_count", len(secrets_list)),
                    "template_count": vault_meta.get("template_count", 0),
                    "updated_at": vault_meta.get("updated_at"),
                },
            },
        )
    except Exception as e:
        logger.error("Failed to list company secrets", error=str(e))
        return _response(500, {"error": "Failed to retrieve company secrets"})


def _handle_get_company_secret(secret_name: str, admin_user_id: str) -> Dict[str, Any]:
    """Get a company secret with decrypted fields. Admin only."""
    try:
        secret = get_vault_secret(COMPANY_USER_ID, secret_name, CLIENT_NAME)
        if not secret:
            return _response(404, {"error": "Company secret not found"})

        # Write audit log
        _write_audit_log(
            COMPANY_USER_ID, secret_name, "admin_view", accessor=admin_user_id
        )

        return _response(200, {"secret": secret})
    except Exception as e:
        logger.error(
            "Failed to get company secret",
            secret_name=secret_name,
            admin_user_id=admin_user_id,
            error=str(e),
        )
        return _response(500, {"error": "Failed to retrieve company secret"})


def _handle_create_company_secret(
    event: Dict[str, Any], admin_user_id: str
) -> Dict[str, Any]:
    """Create a company-level vault secret. Admin only."""
    try:
        body = _parse_body(event)

        error = _validate_request_body(body, ["fields"])
        if error:
            return _response(400, {"error": error})

        secret_name = body.get("name")
        if not secret_name:
            return _response(
                400, {"error": "Secret name is required for company secrets"}
            )

        # Company secrets are typically free-form (OAuth client configs, etc.)
        secret_data = create_freeform_secret(body)

        # Add to company vault
        created_secret = add_secret_to_vault(
            COMPANY_USER_ID, secret_name, secret_data, None, CLIENT_NAME
        )

        # Write audit log
        _write_audit_log(
            COMPANY_USER_ID, secret_name, "admin_create", accessor=admin_user_id
        )

        return _response(201, {"secret": created_secret})

    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error(
            "Failed to create company secret", admin_user_id=admin_user_id, error=str(e)
        )
        return _response(500, {"error": "Failed to create company secret"})


def _handle_update_company_secret(
    event: Dict[str, Any], secret_name: str, admin_user_id: str
) -> Dict[str, Any]:
    """Update a company-level vault secret. Admin only."""
    try:
        body = _parse_body(event)

        # Get existing secret
        existing_secret = get_vault_secret(COMPANY_USER_ID, secret_name, CLIENT_NAME)
        if not existing_secret:
            return _response(404, {"error": "Company secret not found"})

        # Merge with existing data
        updated_data = {
            **existing_secret,
            **body,
            "fields": {**existing_secret.get("fields", {}), **body.get("fields", {})},
        }

        # Update secret
        updated_secret = add_secret_to_vault(
            COMPANY_USER_ID, secret_name, updated_data, None, CLIENT_NAME
        )

        # Write audit log
        _write_audit_log(
            COMPANY_USER_ID, secret_name, "admin_update", accessor=admin_user_id
        )

        return _response(200, {"secret": updated_secret})

    except Exception as e:
        logger.error(
            "Failed to update company secret",
            secret_name=secret_name,
            admin_user_id=admin_user_id,
            error=str(e),
        )
        return _response(500, {"error": "Failed to update company secret"})


def _handle_delete_company_secret(
    secret_name: str, admin_user_id: str
) -> Dict[str, Any]:
    """Delete a company-level vault secret. Admin only."""
    try:
        success = remove_secret_from_vault(COMPANY_USER_ID, secret_name, CLIENT_NAME)
        if not success:
            return _response(404, {"error": "Company secret not found"})

        # Write audit log
        _write_audit_log(
            COMPANY_USER_ID, secret_name, "admin_delete", accessor=admin_user_id
        )

        return _response(
            200, {"success": True, "message": f"Company secret '{secret_name}' deleted"}
        )
    except Exception as e:
        logger.error(
            "Failed to delete company secret",
            secret_name=secret_name,
            admin_user_id=admin_user_id,
            error=str(e),
        )
        return _response(500, {"error": "Failed to delete company secret"})


# ---------------------------------------------------------------------------
# Main Handler and Routing
# ---------------------------------------------------------------------------


def _route(
    method: str, path: str, event: Dict[str, Any], user_id: str
) -> Dict[str, Any]:
    """Route requests to appropriate handlers."""
    # Clean and normalize path
    path = path.strip("/")
    # Strip the /api prefix added by API Gateway route keys
    if path.startswith("api/"):
        path = path[4:]
    path_segments = [p for p in path.split("/") if p]

    is_admin = _is_admin(event)

    # User secrets endpoints
    if (
        len(path_segments) >= 2
        and path_segments[0] == "vault"
        and path_segments[1] == "secrets"
    ):

        # GET /vault/secrets - list all user secrets
        if method == "GET" and len(path_segments) == 2:
            return _handle_list_secrets(user_id)

        # GET /vault/secrets/{secret_name} - get specific secret
        if method == "GET" and len(path_segments) == 3:
            secret_name = path_segments[2]
            return _handle_get_secret(user_id, secret_name)

        # POST /vault/secrets - create new secret
        if method == "POST" and len(path_segments) == 2:
            return _handle_create_secret(event, user_id)

        # PUT /vault/secrets/{secret_name} - update secret
        if method == "PUT" and len(path_segments) == 3:
            secret_name = path_segments[2]
            return _handle_update_secret(event, user_id, secret_name)

        # DELETE /vault/secrets/{secret_name} - delete secret
        if method == "DELETE" and len(path_segments) == 3:
            secret_name = path_segments[2]
            return _handle_delete_secret(user_id, secret_name)

        # POST /vault/secrets/bulk - bulk create secrets
        if method == "POST" and len(path_segments) == 3 and path_segments[2] == "bulk":
            return _handle_bulk_create_secrets(event, user_id)

        # POST /vault/secrets/validate - validate against template
        if (
            method == "POST"
            and len(path_segments) == 3
            and path_segments[2] == "validate"
        ):
            return _handle_validate_secret(event)

    # Categories endpoint
    elif path_segments == ["vault", "categories"] and method == "GET":
        return _handle_list_categories(user_id)

    # Audit log endpoint
    elif path_segments == ["vault", "audit-log"] and method == "GET":
        return _handle_list_audit_log(user_id, is_admin=is_admin)

    # Template management endpoints
    elif (
        len(path_segments) >= 2
        and path_segments[0] == "vault"
        and path_segments[1] == "templates"
    ):

        # GET /vault/templates - list all templates
        if method == "GET" and len(path_segments) == 2:
            return _handle_list_templates()

        # GET /vault/templates/{template_name} - get specific template
        if method == "GET" and len(path_segments) == 3:
            template_name = path_segments[2]
            return _handle_get_template(template_name)

        # POST /vault/templates - create template (admin only)
        if method == "POST" and len(path_segments) == 2:
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            return _handle_create_template(event, user_id)

        # DELETE /vault/templates/{template_name} - delete template (admin only)
        if method == "DELETE" and len(path_segments) == 3:
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            template_name = path_segments[2]
            return _handle_delete_template(template_name, user_id)

        # GET /vault/templates/stats - template statistics (admin only)
        if method == "GET" and len(path_segments) == 3 and path_segments[2] == "stats":
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            return _handle_template_stats()

    # Company secrets endpoints
    elif (
        len(path_segments) >= 2
        and path_segments[0] == "vault"
        and path_segments[1] == "company-secrets"
    ):

        # GET /vault/company-secrets - list company secrets (any user)
        if method == "GET" and len(path_segments) == 2:
            return _handle_list_company_secrets()

        # GET /vault/company-secrets/{secret_name} - get company secret (admin only)
        if method == "GET" and len(path_segments) == 3:
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            secret_name = path_segments[2]
            return _handle_get_company_secret(secret_name, user_id)

        # POST /vault/company-secrets - create company secret (admin only)
        if method == "POST" and len(path_segments) == 2:
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            return _handle_create_company_secret(event, user_id)

        # PUT /vault/company-secrets/{secret_name} - update company secret (admin only)
        if method == "PUT" and len(path_segments) == 3:
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            secret_name = path_segments[2]
            return _handle_update_company_secret(event, secret_name, user_id)

        # DELETE /vault/company-secrets/{secret_name} - delete company secret (admin only)
        if method == "DELETE" and len(path_segments) == 3:
            if not is_admin:
                return _response(403, {"error": "Admin access required"})
            secret_name = path_segments[2]
            return _handle_delete_company_secret(secret_name, user_id)

    # No matching route
    return _response(404, {"error": "Endpoint not found"})


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """Main Lambda handler for consolidated vault API."""
    try:
        method = event.get("requestContext", {}).get("http", {}).get("method")
        path = _get_path(event)

        # Handle preflight requests
        if method == "OPTIONS":
            return _response(200, {})

        # Validate environment
        if not CLIENT_NAME:
            logger.error("Missing CLIENT_NAME environment variable")
            return _response(500, {"error": "Server configuration error"})

        # Extract and validate user
        user_id = _get_user_id(event)
        if not user_id:
            return _response(401, {"error": "Authentication required"})

        # Route request
        return _route(method, path, event, user_id)

    except Exception as e:
        logger.exception(
            "Unhandled error in vault handler",
            path=_get_path(event),
            method=event.get("requestContext", {}).get("http", {}).get("method"),
        )
        return _response(500, {"error": "Internal server error"})


# Initialize templates on first deployment
def _initialize_templates():
    """Initialize default templates if they don't exist."""
    try:
        template_manager = TemplateManager(CLIENT_NAME)
        existing_templates = get_available_templates(CLIENT_NAME)

        if not existing_templates:
            logger.info("Initializing default templates")
            results = template_manager.create_initial_templates()
            logger.info("Template initialization complete", results=results)
    except Exception as e:
        logger.error("Failed to initialize templates", error=str(e))


# Initialize on module load
if CLIENT_NAME:
    _initialize_templates()
