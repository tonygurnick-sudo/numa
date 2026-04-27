"""
Numa Ops tool handlers for workspace-chat-tools Lambda.

Routes ops operations to the appropriate ops Lambda (numa-ops-api,
numa-ops-config-api, numa-ops-crm-api) by constructing API Gateway-like
events and invoking the Lambdas directly.

Auth context is forwarded via a `userContext` field on the event payload.
The ops Lambdas check for this field first (direct invocation path)
before falling back to JWT parsing (API Gateway path). The security
boundary is IAM — only callers with lambda:InvokeFunction permission
can reach the ops Lambdas directly.
"""

import json
import os
from typing import Any, Dict

import structlog

from prm import client as prm_client
from tools.approval import create_approval_request, poll_approval

logger = structlog.get_logger()

# Environment variables for ops Lambda names (set conditionally when NUMA_OPS is enabled)
OPS_API_LAMBDA = os.environ.get("OPS_API_LAMBDA_NAME", "")
OPS_CONFIG_API_LAMBDA = os.environ.get("OPS_CONFIG_API_LAMBDA_NAME", "")
OPS_CRM_API_LAMBDA = os.environ.get("OPS_CRM_API_LAMBDA_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")

# Per-container cache of {user_sub: [group, ...]} so admin checks for the
# same user don't re-hit Cognito on every tool call. Lifetime is the Lambda
# container; long enough to batch a conversation, short enough to pick up
# group changes on a cold start.
_USER_GROUPS_CACHE: dict[str, list[str]] = {}


def _get_lambda_client():
    """Get Lambda client with PRM tracking."""
    return prm_client("lambda", region=AWS_REGION)


def _resolve_user_groups(user_sub: str, hint: list | None) -> list[str]:
    """Return the user's Cognito groups, looking them up if not supplied.

    The workspace agent currently does not forward `user_groups`, so the
    incoming hint is usually empty for ops tool calls. Without groups the
    ops Lambdas treat the caller as non-admin and reject every write to
    config/CRM settings. Resolve from Cognito directly when needed so admin
    users get admin access through chat.
    """
    if hint:
        return [str(g) for g in hint]
    if not user_sub or not USER_POOL_ID:
        return []
    cached = _USER_GROUPS_CACHE.get(user_sub)
    if cached is not None:
        return cached
    try:
        cognito = prm_client("cognito-idp", region=AWS_REGION)
        response = cognito.admin_list_groups_for_user(
            UserPoolId=USER_POOL_ID,
            Username=user_sub,
        )
        groups = [g["GroupName"] for g in response.get("Groups", [])]
    except Exception as e:  # noqa: BLE001 — fail closed, never block on Cognito
        logger.warning(
            "Failed to resolve user groups from Cognito",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        groups = []
    _USER_GROUPS_CACHE[user_sub] = groups
    logger.info(
        "Resolved user groups",
        user_sub=user_sub[:8] + "...",
        groups=groups,
        is_admin="admin" in groups,
    )
    return groups


def _build_apigw_event(
    method: str,
    path: str,
    body: dict | None = None,
    query_params: dict | None = None,
    user_sub: str = "",
    user_email: str = "",
    user_name: str = "",
    user_groups: list | None = None,
) -> dict:
    """Build a minimal API Gateway V2 event for direct Lambda invocation.

    Auth context is passed via ``userContext`` — the ops Lambdas check this
    field first (direct invocation path) before falling back to JWT parsing
    (API Gateway path).  IAM controls who can invoke the Lambda directly.
    """
    event = {
        "requestContext": {
            "http": {
                "method": method,
                "path": f"/api/{path}",
            },
        },
        "rawPath": f"/api/{path}",
        "headers": {
            "content-type": "application/json",
        },
        "queryStringParameters": query_params or {},
        "userContext": {
            "sub": user_sub,
            "email": user_email,
            "name": user_name,
            "groups": user_groups or [],
        },
    }
    if body is not None:
        event["body"] = json.dumps(body)
    return event


def _invoke_ops_lambda(
    lambda_name: str,
    method: str,
    path: str,
    body: dict | None = None,
    query_params: dict | None = None,
    user_sub: str = "",
    user_email: str = "",
    user_name: str = "",
    user_groups: list | None = None,
) -> Dict[str, Any]:
    """Invoke an ops Lambda and return the parsed response body."""
    if not lambda_name:
        raise ValueError(f"Ops Lambda not configured for path: {path}")

    event = _build_apigw_event(
        method,
        path,
        body,
        query_params,
        user_sub=user_sub,
        user_email=user_email,
        user_name=user_name,
        user_groups=user_groups,
    )

    lambda_client = _get_lambda_client()

    logger.info(
        "Invoking ops Lambda",
        lambda_name=lambda_name,
        method=method,
        path=path,
        user_sub=user_sub[:8] + "..." if user_sub else "unknown",
    )

    response = lambda_client.invoke(
        FunctionName=lambda_name,
        Payload=json.dumps(event),
        InvocationType="RequestResponse",
    )

    response_payload = json.loads(response["Payload"].read())

    if response.get("FunctionError"):
        logger.error(
            "Ops Lambda execution failed",
            function_error=response["FunctionError"],
            response_payload=str(response_payload)[:500],
        )
        raise RuntimeError(f"Ops Lambda failed: {response_payload}")

    # The ops Lambdas return { statusCode, headers, body }
    status_code = response_payload.get("statusCode", 500)
    body_str = response_payload.get("body", "{}")

    try:
        result = json.loads(body_str)
    except (json.JSONDecodeError, TypeError):
        result = {"raw": body_str}

    if status_code >= 400:
        error_msg = result.get("error", f"HTTP {status_code}")
        raise RuntimeError(f"Ops API error ({status_code}): {error_msg}")

    return result


# ── Operation-to-Lambda routing ───────────────────────────────────────────────

# Operations that route to numa-ops-api
OPS_API_OPERATIONS = {
    "list_teams",
    "get_team",
    "create_team",
    "update_team",
    "update_zones",
    "update_stages",
    "list_tickets",
    "get_ticket",
    "search_tickets",
    "create_ticket",
    "update_ticket",
    "delete_ticket",
    "bulk_update_tickets",
    "add_comment",
    "list_comments",
    "get_audit",
    "upload_attachment",
    "get_metrics",
    "list_work_units",
    "create_work_unit",
    "update_work_unit",
    "delete_work_unit",
    "create_link",
    "delete_link",
}

# Operations that route to numa-ops-config-api
OPS_CONFIG_OPERATIONS = {
    "get_config",
    "list_projects",
    "create_project",
    "update_project",
    "delete_project",
    # Config management (admin-only, backend-enforced)
    "create_field",
    "update_field",
    "delete_field",
    "create_ticket_type",
    "update_ticket_type",
    "delete_ticket_type",
    "create_status",
    "update_status",
    "update_crm_config",
    "update_supplier_config",
}

# Operations that route to numa-ops-crm-api
OPS_CRM_OPERATIONS = {
    "list_customers",
    "get_customer",
    "create_customer",
    "update_customer",
    "delete_customer",
    "create_customer_activity",
    "update_customer_activity",
    "delete_customer_activity",
    "list_suppliers",
    "get_supplier",
    "create_supplier",
    "update_supplier",
    "delete_supplier",
    "create_supplier_activity",
    "update_supplier_activity",
    "delete_supplier_activity",
}


def _resolve_ticket_by_display_id(
    display_id: str,
    user_sub: str = "",
    user_email: str = "",
    user_name: str = "",
    user_groups: list | None = None,
) -> tuple[str, str]:
    """Resolve a display ID (e.g. 'BUG-002') to (ticket_id, team_id).

    Calls the get_ticket by-display-id endpoint internally.
    Raises ValueError if the display ID is not found.
    """
    result = _invoke_ops_lambda(
        lambda_name=OPS_API_LAMBDA,
        method="GET",
        path=f"ops/tickets/by-display-id/{display_id}",
        user_sub=user_sub,
        user_email=user_email,
        user_name=user_name,
        user_groups=user_groups,
    )
    ticket = result.get("ticket", result)
    ticket_id = ticket.get("id", "")
    team_id = ticket.get("teamId", "")
    if not ticket_id:
        raise ValueError(
            f"Could not resolve display ID '{display_id}' to a ticket. "
            "Check that the display ID is correct (e.g. 'BUG-002')."
        )
    return ticket_id, team_id


def _p(params: dict, *keys: str) -> Any:
    """Resolve a parameter by checking multiple key variants.

    Checks keys in order: first match wins. Use to accept both camelCase
    (primary, matches the API) and snake_case (legacy fallback).
    Returns None if no key is found.
    """
    for k in keys:
        v = params.get(k)
        if v is not None:
            return v
    return None


def _build_body(params: dict, mapping: list[tuple[str, ...]]) -> dict:
    """Build a request body from params using a key-mapping list.

    Each entry is a tuple of (output_key, primary_key, *fallback_keys).
    The output_key is the camelCase key expected by the API.
    Primary key is checked first (camelCase), then fallbacks (snake_case).
    """
    body: dict = {}
    for entry in mapping:
        out_key = entry[0]
        lookup_keys = entry[1:]
        val = _p(params, *lookup_keys)
        if val is not None:
            body[out_key] = val
    return body


def _build_qp(params: dict, mapping: list[tuple[str, ...]]) -> dict | None:
    """Build query params dict from params using a key-mapping list.

    Same format as _build_body. Returns None if empty.
    """
    qp: dict = {}
    for entry in mapping:
        out_key = entry[0]
        lookup_keys = entry[1:]
        val = _p(params, *lookup_keys)
        if val:
            qp[out_key] = val
    return qp or None


def _resolve_lambda_and_request(
    operation: str,
    params: dict,
) -> tuple:
    """Resolve the Lambda name, HTTP method, path, body, and query params for an operation.

    Returns: (lambda_name, method, path, body, query_params)
    """
    # ── Config operations → numa-ops-config-api ──
    if operation == "get_config":
        return (OPS_CONFIG_API_LAMBDA, "GET", "ops/config", None, None)

    if operation == "list_projects":
        return (OPS_CONFIG_API_LAMBDA, "GET", "ops/config/projects", None, None)

    if operation == "create_project":
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("description", "description"),
                ("color", "color"),
                ("status", "status"),
                ("ownerId", "ownerId", "owner_id"),
                ("ownerName", "ownerName", "owner_name"),
                ("goals", "goals"),
                ("startDate", "startDate", "start_date"),
                ("endDate", "endDate", "end_date"),
                ("boardIds", "boardIds", "board_ids"),
            ],
        )
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/projects", body, None)

    if operation == "update_project":
        project_id = _p(params, "projectId", "project_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("description", "description"),
                ("color", "color"),
                ("isActive", "isActive", "is_active"),
                ("status", "status"),
                ("ownerId", "ownerId", "owner_id"),
                ("ownerName", "ownerName", "owner_name"),
                ("goals", "goals"),
                ("startDate", "startDate", "start_date"),
                ("endDate", "endDate", "end_date"),
                ("boardIds", "boardIds", "board_ids"),
            ],
        )
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/projects/{project_id}",
            body,
            None,
        )

    if operation == "delete_project":
        project_id = _p(params, "projectId", "project_id") or ""
        return (
            OPS_CONFIG_API_LAMBDA,
            "DELETE",
            f"ops/config/projects/{project_id}",
            None,
            None,
        )

    # ── Custom fields (admin-only backend) ──
    if operation == "create_field":
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("fieldType", "fieldType", "field_type"),
                ("category", "category"),
                ("required", "required"),
                ("helpText", "helpText", "help_text"),
                ("defaultValue", "defaultValue", "default_value"),
                ("options", "options"),
            ],
        )
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/fields", body, None)

    if operation == "update_field":
        field_id = _p(params, "fieldId", "field_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("fieldType", "fieldType", "field_type"),
                ("category", "category"),
                ("required", "required"),
                ("helpText", "helpText", "help_text"),
                ("defaultValue", "defaultValue", "default_value"),
                ("options", "options"),
            ],
        )
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/fields/{field_id}",
            body,
            None,
        )

    if operation == "delete_field":
        field_id = _p(params, "fieldId", "field_id") or ""
        return (
            OPS_CONFIG_API_LAMBDA,
            "DELETE",
            f"ops/config/fields/{field_id}",
            None,
            None,
        )

    # ── Ticket types (admin-only backend) ──
    if operation == "create_ticket_type":
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("prefix", "prefix"),
                ("icon", "icon"),
                ("color", "color"),
                ("defaultFields", "defaultFields", "default_fields"),
            ],
        )
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/ticket-types", body, None)

    if operation == "update_ticket_type":
        ticket_type_id = _p(params, "ticketTypeId", "ticket_type_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("icon", "icon"),
                ("color", "color"),
                ("defaultFields", "defaultFields", "default_fields"),
            ],
        )
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/ticket-types/{ticket_type_id}",
            body,
            None,
        )

    if operation == "delete_ticket_type":
        ticket_type_id = _p(params, "ticketTypeId", "ticket_type_id") or ""
        return (
            OPS_CONFIG_API_LAMBDA,
            "DELETE",
            f"ops/config/ticket-types/{ticket_type_id}",
            None,
            None,
        )

    # ── Statuses (admin-only backend) ──
    if operation == "create_status":
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("type", "type"),
                ("color", "color"),
                ("icon", "icon"),
            ],
        )
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/statuses", body, None)

    if operation == "update_status":
        status_id = _p(params, "statusId", "status_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("type", "type"),
                ("color", "color"),
                ("icon", "icon"),
            ],
        )
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/statuses/{status_id}",
            body,
            None,
        )

    # ── CRM / Supplier config (admin-only backend, shallow merge server-side) ──
    # The backend merges the request body into the existing CRM_CONFIG item, so
    # callers can send only the keys they want to change. customerRecord /
    # customerRecord.sections and layout are nested objects on the CRM config.
    if operation == "update_crm_config":
        body = _build_body(
            params,
            [
                ("lifecycleStages", "lifecycleStages", "lifecycle_stages"),
                ("customerFlags", "customerFlags", "customer_flags"),
                ("documentTypes", "documentTypes", "document_types"),
                ("territories", "territories"),
                ("industries", "industries"),
                ("defaultStage", "defaultStage", "default_stage"),
                ("customerRecord", "customerRecord", "customer_record"),
                ("layout", "layout"),
            ],
        )
        return (OPS_CONFIG_API_LAMBDA, "PUT", "ops/config/crm-settings", body, None)

    if operation == "update_supplier_config":
        body = _build_body(
            params,
            [
                ("lifecycleStages", "lifecycleStages", "lifecycle_stages"),
                ("supplierFlags", "supplierFlags", "supplier_flags"),
                ("documentTypes", "documentTypes", "document_types"),
                ("defaultStage", "defaultStage", "default_stage"),
            ],
        )
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            "ops/config/supplier-settings",
            body,
            None,
        )

    # ── CRM operations → numa-ops-crm-api ──
    if operation == "list_customers":
        qp = _build_qp(
            params,
            [
                ("search", "search"),
                ("stage", "stage"),
                ("ownerId", "ownerId", "owner_id"),
                ("territory", "territory"),
                ("industry", "industry"),
                ("flags", "flags"),
                ("limit", "limit"),
                ("cursor", "cursor"),
            ],
        )
        return (OPS_CRM_API_LAMBDA, "GET", "ops/customers", None, qp)

    if operation == "get_customer":
        customer_id = _p(params, "customerId", "customer_id") or ""
        return (OPS_CRM_API_LAMBDA, "GET", f"ops/customers/{customer_id}", None, None)

    _CUSTOMER_FIELDS = [
        ("companyName", "companyName", "company_name"),
        ("industry", "industry"),
        ("lifecycleStage", "lifecycleStage", "lifecycle_stage"),
        ("ownerId", "ownerId", "owner_id"),
        ("ownerName", "ownerName", "owner_name"),
        ("companySize", "companySize", "company_size"),
        ("website", "website"),
        ("territory", "territory"),
        ("flags", "flags"),
        ("source", "source"),
        ("contractStartDate", "contractStartDate", "contract_start_date"),
        ("contractTerm", "contractTerm", "contract_term"),
        ("renewalDate", "renewalDate", "renewal_date"),
        ("contractValue", "contractValue", "contract_value"),
        ("products", "products"),
        ("productNotes", "productNotes", "product_notes"),
        ("notes", "notes"),
        ("contacts", "contacts"),
        ("customFields", "customFields", "custom_fields"),
    ]

    if operation == "create_customer":
        body = _build_body(params, _CUSTOMER_FIELDS)
        return (OPS_CRM_API_LAMBDA, "POST", "ops/customers", body, None)

    if operation == "update_customer":
        customer_id = _p(params, "customerId", "customer_id") or ""
        body = _build_body(params, _CUSTOMER_FIELDS)
        return (OPS_CRM_API_LAMBDA, "PUT", f"ops/customers/{customer_id}", body, None)

    if operation == "delete_customer":
        customer_id = _p(params, "customerId", "customer_id") or ""
        return (
            OPS_CRM_API_LAMBDA,
            "DELETE",
            f"ops/customers/{customer_id}",
            None,
            None,
        )

    _ACTIVITY_FIELDS = [
        ("type", "type"),
        ("summary", "summary"),
        ("date", "date"),
        ("direction", "direction"),
        ("duration", "duration"),
        ("outcome", "outcome"),
        ("nextActionDate", "nextActionDate", "next_action_date"),
        ("nextActionType", "nextActionType", "next_action_type"),
    ]

    if operation == "create_customer_activity":
        customer_id = _p(params, "customerId", "customer_id") or ""
        body = _build_body(params, _ACTIVITY_FIELDS)
        return (
            OPS_CRM_API_LAMBDA,
            "POST",
            f"ops/customers/{customer_id}/activities",
            body,
            None,
        )

    if operation == "update_customer_activity":
        customer_id = _p(params, "customerId", "customer_id") or ""
        activity_id = _p(params, "activityId", "activity_id") or ""
        body = _build_body(params, _ACTIVITY_FIELDS)
        return (
            OPS_CRM_API_LAMBDA,
            "PUT",
            f"ops/customers/{customer_id}/activities/{activity_id}",
            body,
            None,
        )

    if operation == "delete_customer_activity":
        customer_id = _p(params, "customerId", "customer_id") or ""
        activity_id = _p(params, "activityId", "activity_id") or ""
        return (
            OPS_CRM_API_LAMBDA,
            "DELETE",
            f"ops/customers/{customer_id}/activities/{activity_id}",
            None,
            None,
        )

    if operation == "list_suppliers":
        qp = _build_qp(
            params,
            [
                ("search", "search"),
                ("stage", "stage"),
                ("ownerId", "ownerId", "owner_id"),
                ("territory", "territory"),
                ("industry", "industry"),
                ("flags", "flags"),
                ("limit", "limit"),
                ("cursor", "cursor"),
            ],
        )
        return (OPS_CRM_API_LAMBDA, "GET", "ops/suppliers", None, qp)

    if operation == "get_supplier":
        supplier_id = _p(params, "supplierId", "supplier_id") or ""
        return (OPS_CRM_API_LAMBDA, "GET", f"ops/suppliers/{supplier_id}", None, None)

    _SUPPLIER_FIELDS = [
        ("companyName", "companyName", "company_name"),
        ("industry", "industry"),
        ("lifecycleStage", "lifecycleStage", "lifecycle_stage"),
        ("ownerId", "ownerId", "owner_id"),
        ("ownerName", "ownerName", "owner_name"),
        ("companySize", "companySize", "company_size"),
        ("website", "website"),
        ("territory", "territory"),
        ("flags", "flags"),
        ("source", "source"),
        ("annualSpend", "annualSpend", "annual_spend"),
        ("paymentTerms", "paymentTerms", "payment_terms"),
        ("notes", "notes"),
        ("contacts", "contacts"),
        ("customFields", "customFields", "custom_fields"),
    ]

    if operation == "create_supplier":
        body = _build_body(params, _SUPPLIER_FIELDS)
        return (OPS_CRM_API_LAMBDA, "POST", "ops/suppliers", body, None)

    if operation == "update_supplier":
        supplier_id = _p(params, "supplierId", "supplier_id") or ""
        body = _build_body(params, _SUPPLIER_FIELDS)
        return (OPS_CRM_API_LAMBDA, "PUT", f"ops/suppliers/{supplier_id}", body, None)

    if operation == "delete_supplier":
        supplier_id = _p(params, "supplierId", "supplier_id") or ""
        return (
            OPS_CRM_API_LAMBDA,
            "DELETE",
            f"ops/suppliers/{supplier_id}",
            None,
            None,
        )

    if operation == "create_supplier_activity":
        supplier_id = _p(params, "supplierId", "supplier_id") or ""
        body = _build_body(params, _ACTIVITY_FIELDS)
        return (
            OPS_CRM_API_LAMBDA,
            "POST",
            f"ops/suppliers/{supplier_id}/activities",
            body,
            None,
        )

    if operation == "update_supplier_activity":
        supplier_id = _p(params, "supplierId", "supplier_id") or ""
        activity_id = _p(params, "activityId", "activity_id") or ""
        body = _build_body(params, _ACTIVITY_FIELDS)
        return (
            OPS_CRM_API_LAMBDA,
            "PUT",
            f"ops/suppliers/{supplier_id}/activities/{activity_id}",
            body,
            None,
        )

    if operation == "delete_supplier_activity":
        supplier_id = _p(params, "supplierId", "supplier_id") or ""
        activity_id = _p(params, "activityId", "activity_id") or ""
        return (
            OPS_CRM_API_LAMBDA,
            "DELETE",
            f"ops/suppliers/{supplier_id}/activities/{activity_id}",
            None,
            None,
        )

    # ── Core ops operations → numa-ops-api ──
    if operation == "list_teams":
        return (OPS_API_LAMBDA, "GET", "ops/teams", None, None)

    if operation == "get_team":
        team_id = _p(params, "teamId", "team_id") or ""
        return (OPS_API_LAMBDA, "GET", f"ops/teams/{team_id}", None, None)

    if operation == "create_team":
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("description", "description"),
                ("color", "color"),
                ("ticketTypeId", "ticketTypeId", "ticket_type_id"),
                ("allowedTicketTypes", "allowedTicketTypes", "allowed_ticket_types"),
                ("fieldOverrides", "fieldOverrides", "field_overrides"),
                ("addedFields", "addedFields", "added_fields"),
                ("accessControl", "accessControl", "access_control"),
                ("workUnitSeries", "workUnitSeries", "work_unit_series"),
                ("preset", "preset"),
                ("announcement", "announcement"),
                ("customStages", "customStages", "custom_stages"),
                ("zones", "zones"),
            ],
        )
        return (OPS_API_LAMBDA, "POST", "ops/teams", body, None)

    if operation == "update_team":
        team_id = _p(params, "teamId", "team_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("description", "description"),
                ("color", "color"),
                ("ticketTypeId", "ticketTypeId", "ticket_type_id"),
                ("allowedTicketTypes", "allowedTicketTypes", "allowed_ticket_types"),
                ("fieldOverrides", "fieldOverrides", "field_overrides"),
                ("addedFields", "addedFields", "added_fields"),
                ("accessControl", "accessControl", "access_control"),
                ("workUnitSeries", "workUnitSeries", "work_unit_series"),
                ("announcement", "announcement"),
            ],
        )
        return (OPS_API_LAMBDA, "PUT", f"ops/teams/{team_id}", body, None)

    if operation == "update_zones":
        team_id = _p(params, "teamId", "team_id") or ""
        zones = params.get("zones", [])
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/teams/{team_id}/zones",
            {"zones": zones},
            None,
        )

    if operation == "update_stages":
        team_id = _p(params, "teamId", "team_id") or ""
        stages = params.get("stages", [])
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/teams/{team_id}/stages",
            {"stages": stages},
            None,
        )

    if operation == "list_tickets":
        qp = _build_qp(
            params,
            [
                ("teamId", "teamId", "team_id"),
                ("stageId", "stageId", "stage_id"),
                ("statusType", "statusType", "status_type"),
                ("assigneeId", "assigneeId", "assignee_id"),
                ("customerId", "customerId", "customer_id"),
                ("workUnitId", "workUnitId", "work_unit_id"),
                ("projectId", "projectId", "project_id"),
                ("priority", "priority"),
                ("includeArchived", "includeArchived", "include_archived"),
                ("limit", "limit"),
                ("cursor", "cursor"),
            ],
        )
        return (OPS_API_LAMBDA, "GET", "ops/tickets", None, qp)

    if operation == "get_ticket":
        display_id = _p(params, "displayId", "display_id")
        if display_id:
            return (
                OPS_API_LAMBDA,
                "GET",
                f"ops/tickets/by-display-id/{display_id}",
                None,
                None,
            )
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        qp = _build_qp(params, [("teamId", "teamId", "team_id")])
        return (
            OPS_API_LAMBDA,
            "GET",
            f"ops/tickets/{ticket_id}",
            None,
            qp,
        )

    if operation == "search_tickets":
        qp = {"search": _p(params, "query", "search") or ""}
        team_id = _p(params, "teamId", "team_id")
        if team_id:
            qp["teamId"] = team_id
        return (OPS_API_LAMBDA, "GET", "ops/tickets", None, qp)

    if operation == "create_ticket":
        body = _build_body(
            params,
            [
                ("teamId", "teamId", "team_id"),
                ("title", "title", "name"),  # accept "name" as alias for "title"
                ("ticketTypeId", "ticketTypeId", "ticket_type_id"),
                ("description", "description"),
                ("stageId", "stageId", "stage_id"),
                ("zoneId", "zoneId", "zone_id"),
                ("priority", "priority"),
                ("assigneeId", "assigneeId", "assignee_id"),
                ("assigneeName", "assigneeName", "assignee_name"),
                ("reporterId", "reporterId", "reporter_id"),
                ("reporterName", "reporterName", "reporter_name"),
                ("dueDate", "dueDate", "due_date"),
                ("customerId", "customerId", "customer_id"),
                ("customerName", "customerName", "customer_name"),
                ("supplierId", "supplierId", "supplier_id"),
                ("supplierName", "supplierName", "supplier_name"),
                ("workUnitId", "workUnitId", "work_unit_id"),
                ("projectId", "projectId", "project_id"),
                ("tags", "tags"),
                ("fields", "fields"),
                ("effortPoints", "effortPoints", "effort_points"),
                ("sourceType", "sourceType", "source_type"),
                ("sourceId", "sourceId", "source_id"),
                ("sourceAppType", "sourceAppType", "source_app_type"),
            ],
        )
        return (OPS_API_LAMBDA, "POST", "ops/tickets", body, None)

    if operation == "update_ticket":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        body = _build_body(
            params,
            [
                ("teamId", "teamId", "team_id"),
                ("currentTeamId", "currentTeamId", "current_team_id"),
                ("title", "title", "name"),
                ("description", "description"),
                ("stageId", "stageId", "stage_id"),
                ("zoneId", "zoneId", "zone_id"),
                ("priority", "priority"),
                ("assigneeId", "assigneeId", "assignee_id"),
                ("assigneeName", "assigneeName", "assignee_name"),
                ("reporterId", "reporterId", "reporter_id"),
                ("reporterName", "reporterName", "reporter_name"),
                ("dueDate", "dueDate", "due_date"),
                ("customerId", "customerId", "customer_id"),
                ("customerName", "customerName", "customer_name"),
                ("supplierId", "supplierId", "supplier_id"),
                ("supplierName", "supplierName", "supplier_name"),
                ("workUnitId", "workUnitId", "work_unit_id"),
                ("projectId", "projectId", "project_id"),
                ("tags", "tags"),
                ("fields", "fields"),
                ("effortPoints", "effortPoints", "effort_points"),
                ("order", "order"),
                ("version", "version"),
                ("archived", "archived"),
            ],
        )
        return (OPS_API_LAMBDA, "PUT", f"ops/tickets/{ticket_id}", body, None)

    if operation == "delete_ticket":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        qp = _build_qp(params, [("teamId", "teamId", "team_id")])
        return (OPS_API_LAMBDA, "DELETE", f"ops/tickets/{ticket_id}", None, qp)

    if operation == "bulk_update_tickets":
        changes = dict(params.get("changes", {}))
        team_id = _p(params, "teamId", "team_id")
        if team_id and "teamId" not in changes:
            changes["teamId"] = team_id
        body = {
            "ticketIds": _p(params, "ticketIds", "ticket_ids") or [],
            "changes": changes,
        }
        return (OPS_API_LAMBDA, "POST", "ops/tickets/bulk", body, None)

    if operation == "add_comment":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        body = {
            "content": params.get("content", ""),
            "teamId": _p(params, "teamId", "team_id"),
            "displayId": _p(params, "displayId", "display_id"),
        }
        if "attachments" in params:
            body["attachments"] = params["attachments"]
        return (OPS_API_LAMBDA, "POST", f"ops/tickets/{ticket_id}/comments", body, None)

    if operation == "list_comments":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        return (OPS_API_LAMBDA, "GET", f"ops/tickets/{ticket_id}/comments", None, None)

    if operation == "get_audit":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        return (OPS_API_LAMBDA, "GET", f"ops/tickets/{ticket_id}/audit", None, None)

    if operation == "upload_attachment":
        body = {
            "fileName": _p(params, "fileName", "file_name") or "",
            "contentType": _p(params, "contentType", "content_type")
            or "application/octet-stream",
            "contextId": _p(params, "ticketId", "ticket_id", "contextId"),
        }
        return (OPS_API_LAMBDA, "POST", "ops/uploads/presigned-url", body, None)

    if operation == "list_work_units":
        team_id = _p(params, "teamId", "team_id") or ""
        return (OPS_API_LAMBDA, "GET", f"ops/teams/{team_id}/work-units", None, None)

    if operation == "create_work_unit":
        team_id = _p(params, "teamId", "team_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("goal", "goal"),
                ("startDate", "startDate", "start_date"),
                ("endDate", "endDate", "end_date"),
                ("status", "status"),
                ("capacity", "capacity"),
            ],
        )
        return (OPS_API_LAMBDA, "POST", f"ops/teams/{team_id}/work-units", body, None)

    if operation == "update_work_unit":
        team_id = _p(params, "teamId", "team_id") or ""
        work_unit_id = _p(params, "workUnitId", "work_unit_id") or ""
        body = _build_body(
            params,
            [
                ("name", "name"),
                ("goal", "goal"),
                ("startDate", "startDate", "start_date"),
                ("endDate", "endDate", "end_date"),
                ("status", "status"),
                ("capacity", "capacity"),
            ],
        )
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/teams/{team_id}/work-units/{work_unit_id}",
            body,
            None,
        )

    if operation == "delete_work_unit":
        team_id = _p(params, "teamId", "team_id") or ""
        work_unit_id = _p(params, "workUnitId", "work_unit_id") or ""
        return (
            OPS_API_LAMBDA,
            "DELETE",
            f"ops/teams/{team_id}/work-units/{work_unit_id}",
            None,
            None,
        )

    if operation == "create_link":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        body = {
            "linkedTicketId": _p(params, "linkedTicketId", "linked_ticket_id") or "",
            "linkedTicketDisplayId": _p(
                params, "linkedTicketDisplayId", "linked_ticket_display_id"
            )
            or "",
            "linkedTicketTitle": _p(params, "linkedTicketTitle", "linked_ticket_title"),
            "linkType": _p(params, "linkType", "link_type") or "",
            "teamId": _p(params, "teamId", "team_id"),
            "linkedTeamId": _p(params, "linkedTeamId", "linked_team_id"),
        }
        return (OPS_API_LAMBDA, "POST", f"ops/tickets/{ticket_id}/links", body, None)

    if operation == "delete_link":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        link_type = _p(params, "linkType", "link_type") or ""
        linked_ticket_id = _p(params, "linkedTicketId", "linked_ticket_id") or ""
        return (
            OPS_API_LAMBDA,
            "DELETE",
            f"ops/tickets/{ticket_id}/links/{link_type}/{linked_ticket_id}",
            None,
            None,
        )

    if operation == "get_metrics":
        qp = {}
        team_ids = _p(params, "teamIds", "team_ids")
        if team_ids:
            qp["teamIds"] = team_ids
        else:
            team_id = _p(params, "teamId", "team_id")
            if team_id:
                qp["teamIds"] = team_id
        return (OPS_API_LAMBDA, "GET", "ops/metrics", None, qp or None)

    raise ValueError(f"Unknown ops operation: {operation}")


def _filter_projects_by_access(
    result: Dict[str, Any],
    operation: str,
    user_sub: str,
    user_email: str,
    user_name: str,
    user_groups: list | None,
) -> Dict[str, Any]:
    """Filter projects in list_projects / get_config results by board access.

    Projects with no boardIds (all-boards) pass through. Projects with
    boardIds are only included if at least one board is accessible to the user.
    """
    # Fetch the user's accessible teams (list_teams already filters by access)
    try:
        teams_result = _invoke_ops_lambda(
            lambda_name=OPS_API_LAMBDA,
            method="GET",
            path="ops/teams",
            body=None,
            query_params=None,
            user_sub=user_sub,
            user_email=user_email,
            user_name=user_name,
            user_groups=user_groups,
        )
        accessible_team_ids = {
            t["id"] for t in teams_result.get("teams", []) if "id" in t
        }
    except Exception:
        # If team lookup fails, don't block — return unfiltered
        logger.warning("Failed to fetch teams for project access filtering")
        return result

    def is_accessible(project: dict) -> bool:
        board_ids = project.get("boardIds")
        if not board_ids:
            return True  # No boards = visible to all
        return bool(set(board_ids) & accessible_team_ids)

    if operation == "list_projects":
        projects = result.get("projects", [])
        result["projects"] = [p for p in projects if is_accessible(p)]
    elif operation == "get_config":
        projects = result.get("projects", [])
        result["projects"] = [p for p in projects if is_accessible(p)]

    return result


def handle_ops_operation(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a generic ops operation.

    Called with params dict (not full event) from lambda_function.py dispatch.
    The dispatcher injects user_sub/user_email/user_groups into params.

    Expected params format:
    {
        "operation": "list_tickets",
        "params": { ... },
        "description": "...",
        "auto_approved": true/false,
        "request_id": "uuid",
        "user_sub": "...",
        "user_email": "...",
        "user_groups": [...]
    }
    """
    operation = event.get("operation", "")
    op_params = event.get("params", {})
    user_sub = event.get("user_sub", "")
    user_email = event.get("user_email", "")
    user_name = event.get("user_name", "")
    # The workspace agent doesn't forward Cognito groups today, so resolve
    # them here (cached per-container) to keep admin checks on ops/CRM
    # config writes working through chat.
    user_groups = _resolve_user_groups(user_sub, event.get("user_groups"))
    # Default to False (fail-closed) — matches integrations handler.
    # If auto_approved is missing or unexpected, require approval.
    auto_approved = event.get("auto_approved", False)
    request_id = event.get("request_id", "")
    description = event.get("description", "")

    # Make a copy of params to avoid mutating the original
    op_params = dict(op_params)

    logger.info(
        "Ops approval gate check",
        operation=operation,
        auto_approved=auto_approved,
        auto_approved_type=type(auto_approved).__name__,
        has_request_id=bool(request_id),
        request_id_preview=request_id[:8] if request_id else "",
    )

    # Approval gate: for write operations that are not auto-approved,
    # create a DynamoDB approval record and poll until the user approves,
    # denies, or the 90-second timeout expires.
    if not auto_approved and request_id:
        try:
            action_key = f"ops-{operation.replace('_', '-')}"
            approval_id = create_approval_request(
                user_sub=user_sub,
                action_key=action_key,
                description=description,
                props_preview=op_params,
                approval_id=request_id,
            )
            decision, deny_reason = poll_approval(approval_id)

            if decision == "denied":
                msg = "The user denied this action."
                if deny_reason:
                    msg += f' The user said: "{deny_reason}"'
                return {
                    "status": "denied",
                    "message": msg,
                    "deny_reason": deny_reason,
                    "approval_id": approval_id,
                }
            if decision == "timeout":
                return {
                    "status": "timeout",
                    "message": "Approval timed out (90 seconds)",
                    "approval_id": approval_id,
                }

            logger.info(
                "Ops operation approved",
                operation=operation,
                approval_id=approval_id,
            )
        except ValueError as e:
            # INTEGRATIONS_APPROVAL_TABLE not configured — execute without approval
            logger.warning(
                "Approval table not configured, executing without approval",
                error=str(e),
            )

    # ── Resolve display IDs for mutation operations ─────────────────────
    # If the caller provided a displayId (e.g. 'BUG-002') instead of a
    # ticketId UUID, resolve it before routing to the Lambda.
    _ticket_mutations = {
        "update_ticket",
        "delete_ticket",
        "add_comment",
        "list_comments",
        "get_audit",
    }
    if operation in _ticket_mutations:
        has_ticket_id = bool(op_params.get("ticketId") or op_params.get("ticket_id"))
        has_display_id = bool(op_params.get("displayId") or op_params.get("display_id"))
        if not has_ticket_id and not has_display_id:
            raise ValueError(
                f"Missing required parameter for {operation}: "
                "ticketId (UUID) or displayId (e.g. 'BUG-002')"
            )
        if has_display_id and not has_ticket_id:
            display_id_val = op_params.get("displayId") or op_params.get("display_id")
            resolved_id, resolved_team_id = _resolve_ticket_by_display_id(
                display_id_val,
                user_sub=user_sub,
                user_email=user_email,
                user_name=user_name,
                user_groups=user_groups,
            )
            op_params["ticketId"] = resolved_id
            if (
                not (op_params.get("teamId") or op_params.get("team_id"))
                and resolved_team_id
            ):
                op_params["teamId"] = resolved_team_id

    try:
        lambda_name, method, path, body, query_params = _resolve_lambda_and_request(
            operation, op_params
        )

        result = _invoke_ops_lambda(
            lambda_name=lambda_name,
            method=method,
            path=path,
            body=body,
            query_params=query_params,
            user_sub=user_sub,
            user_email=user_email,
            user_name=user_name,
            user_groups=user_groups,
        )

        # Filter projects by board access: only show projects whose boardIds
        # overlap with the user's accessible teams (or have no boardIds = all).
        if operation in ("list_projects", "get_config") and isinstance(result, dict):
            result = _filter_projects_by_access(
                result, operation, user_sub, user_email, user_name, user_groups
            )

        return result

    except Exception as e:
        logger.error(
            "Ops operation failed",
            operation=operation,
            error=str(e),
        )
        raise
