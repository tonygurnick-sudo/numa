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
    "list_suppliers",
    "get_supplier",
    "create_supplier",
    "update_supplier",
    "delete_supplier",
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
        body = {}
        mapping = {
            "name": "name",
            "description": "description",
            "color": "color",
            "status": "status",
            "owner_id": "ownerId",
            "owner_name": "ownerName",
            "goals": "goals",
            "start_date": "startDate",
            "end_date": "endDate",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        # board_ids is a list, pass through directly
        if params.get("board_ids") is not None:
            body["boardIds"] = params["board_ids"]
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/projects", body, None)

    if operation == "update_project":
        project_id = params.pop("project_id", "")
        body = {}
        mapping = {
            "name": "name",
            "description": "description",
            "color": "color",
            "is_active": "isActive",
            "status": "status",
            "owner_id": "ownerId",
            "owner_name": "ownerName",
            "goals": "goals",
            "start_date": "startDate",
            "end_date": "endDate",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        # board_ids is a list, pass through directly
        if params.get("board_ids") is not None:
            body["boardIds"] = params["board_ids"]
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/projects/{project_id}",
            body,
            None,
        )

    if operation == "delete_project":
        project_id = params.get("project_id", "")
        return (
            OPS_CONFIG_API_LAMBDA,
            "DELETE",
            f"ops/config/projects/{project_id}",
            None,
            None,
        )

    # ── Custom fields (admin-only backend) ──
    if operation == "create_field":
        body = {}
        mapping = {
            "name": "name",
            "field_type": "fieldType",
            "category": "category",
            "required": "required",
            "help_text": "helpText",
            "default_value": "defaultValue",
            "options": "options",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/fields", body, None)

    if operation == "update_field":
        field_id = params.get("field_id", "")
        body = {}
        mapping = {
            "name": "name",
            "field_type": "fieldType",
            "category": "category",
            "required": "required",
            "help_text": "helpText",
            "default_value": "defaultValue",
            "options": "options",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/fields/{field_id}",
            body,
            None,
        )

    if operation == "delete_field":
        field_id = params.get("field_id", "")
        return (
            OPS_CONFIG_API_LAMBDA,
            "DELETE",
            f"ops/config/fields/{field_id}",
            None,
            None,
        )

    # ── Ticket types (admin-only backend) ──
    if operation == "create_ticket_type":
        body = {}
        mapping = {
            "name": "name",
            "prefix": "prefix",
            "icon": "icon",
            "color": "color",
            "default_fields": "defaultFields",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/ticket-types", body, None)

    if operation == "update_ticket_type":
        ticket_type_id = params.get("ticket_type_id", "")
        body = {}
        mapping = {
            "name": "name",
            "icon": "icon",
            "color": "color",
            "default_fields": "defaultFields",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/ticket-types/{ticket_type_id}",
            body,
            None,
        )

    if operation == "delete_ticket_type":
        ticket_type_id = params.get("ticket_type_id", "")
        return (
            OPS_CONFIG_API_LAMBDA,
            "DELETE",
            f"ops/config/ticket-types/{ticket_type_id}",
            None,
            None,
        )

    # ── Statuses (admin-only backend) ──
    if operation == "create_status":
        body = {}
        mapping = {
            "name": "name",
            "type": "type",
            "color": "color",
            "icon": "icon",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/statuses", body, None)

    if operation == "update_status":
        status_id = params.get("status_id", "")
        body = {}
        mapping = {
            "name": "name",
            "type": "type",
            "color": "color",
            "icon": "icon",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
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
        body = {}
        mapping = {
            "lifecycle_stages": "lifecycleStages",
            "customer_flags": "customerFlags",
            "document_types": "documentTypes",
            "territories": "territories",
            "industries": "industries",
            "default_stage": "defaultStage",
            "customer_record": "customerRecord",
            "layout": "layout",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CONFIG_API_LAMBDA, "PUT", "ops/config/crm-settings", body, None)

    if operation == "update_supplier_config":
        body = {}
        mapping = {
            "lifecycle_stages": "lifecycleStages",
            "supplier_flags": "supplierFlags",
            "document_types": "documentTypes",
            "default_stage": "defaultStage",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            "ops/config/supplier-settings",
            body,
            None,
        )

    # ── CRM operations → numa-ops-crm-api ──
    if operation == "list_customers":
        qp = {}
        param_map = {
            "search": "search",
            "stage": "stage",
            "owner_id": "ownerId",
            "territory": "territory",
            "industry": "industry",
            "flags": "flags",
            "limit": "limit",
            "cursor": "cursor",
        }
        for snake, camel in param_map.items():
            if params.get(snake):
                qp[camel] = params[snake]
        return (OPS_CRM_API_LAMBDA, "GET", "ops/customers", None, qp or None)

    if operation == "get_customer":
        return (
            OPS_CRM_API_LAMBDA,
            "GET",
            f"ops/customers/{params.get('customer_id', '')}",
            None,
            None,
        )

    if operation == "create_customer":
        body = {}
        mapping = {
            "company_name": "companyName",
            "industry": "industry",
            "lifecycle_stage": "lifecycleStage",
            "owner_id": "ownerId",
            "owner_name": "ownerName",
            "company_size": "companySize",
            "website": "website",
            "territory": "territory",
            "flags": "flags",
            "source": "source",
            "contract_start_date": "contractStartDate",
            "contract_term": "contractTerm",
            "renewal_date": "renewalDate",
            "contract_value": "contractValue",
            "products": "products",
            "product_notes": "productNotes",
            "notes": "notes",
            "contacts": "contacts",
            "custom_fields": "customFields",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CRM_API_LAMBDA, "POST", "ops/customers", body, None)

    if operation == "update_customer":
        customer_id = params.pop("customer_id", "")
        body = {}
        mapping = {
            "company_name": "companyName",
            "industry": "industry",
            "lifecycle_stage": "lifecycleStage",
            "owner_id": "ownerId",
            "owner_name": "ownerName",
            "company_size": "companySize",
            "website": "website",
            "territory": "territory",
            "flags": "flags",
            "source": "source",
            "contract_start_date": "contractStartDate",
            "contract_term": "contractTerm",
            "renewal_date": "renewalDate",
            "contract_value": "contractValue",
            "products": "products",
            "product_notes": "productNotes",
            "notes": "notes",
            "contacts": "contacts",
            "custom_fields": "customFields",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CRM_API_LAMBDA, "PUT", f"ops/customers/{customer_id}", body, None)

    if operation == "delete_customer":
        return (
            OPS_CRM_API_LAMBDA,
            "DELETE",
            f"ops/customers/{params.get('customer_id', '')}",
            None,
            None,
        )

    if operation == "list_suppliers":
        qp = {}
        param_map = {
            "search": "search",
            "stage": "stage",
            "owner_id": "ownerId",
            "territory": "territory",
            "industry": "industry",
            "flags": "flags",
            "limit": "limit",
            "cursor": "cursor",
        }
        for snake, camel in param_map.items():
            if params.get(snake):
                qp[camel] = params[snake]
        return (OPS_CRM_API_LAMBDA, "GET", "ops/suppliers", None, qp or None)

    if operation == "get_supplier":
        return (
            OPS_CRM_API_LAMBDA,
            "GET",
            f"ops/suppliers/{params.get('supplier_id', '')}",
            None,
            None,
        )

    if operation == "create_supplier":
        body = {}
        mapping = {
            "company_name": "companyName",
            "industry": "industry",
            "lifecycle_stage": "lifecycleStage",
            "owner_id": "ownerId",
            "owner_name": "ownerName",
            "company_size": "companySize",
            "website": "website",
            "territory": "territory",
            "flags": "flags",
            "source": "source",
            "annual_spend": "annualSpend",
            "payment_terms": "paymentTerms",
            "notes": "notes",
            "contacts": "contacts",
            "custom_fields": "customFields",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CRM_API_LAMBDA, "POST", "ops/suppliers", body, None)

    if operation == "update_supplier":
        supplier_id = params.pop("supplier_id", "")
        body = {}
        mapping = {
            "company_name": "companyName",
            "industry": "industry",
            "lifecycle_stage": "lifecycleStage",
            "owner_id": "ownerId",
            "owner_name": "ownerName",
            "company_size": "companySize",
            "website": "website",
            "territory": "territory",
            "flags": "flags",
            "source": "source",
            "annual_spend": "annualSpend",
            "payment_terms": "paymentTerms",
            "notes": "notes",
            "contacts": "contacts",
            "custom_fields": "customFields",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_CRM_API_LAMBDA, "PUT", f"ops/suppliers/{supplier_id}", body, None)

    if operation == "delete_supplier":
        return (
            OPS_CRM_API_LAMBDA,
            "DELETE",
            f"ops/suppliers/{params.get('supplier_id', '')}",
            None,
            None,
        )

    # ── Core ops operations → numa-ops-api ──
    if operation == "list_teams":
        return (OPS_API_LAMBDA, "GET", "ops/teams", None, None)

    if operation == "get_team":
        return (
            OPS_API_LAMBDA,
            "GET",
            f"ops/teams/{params.get('team_id', '')}",
            None,
            None,
        )

    if operation == "create_team":
        body = {}
        mapping = {
            "name": "name",
            "description": "description",
            "color": "color",
            "ticket_type_id": "ticketTypeId",
            "allowed_ticket_types": "allowedTicketTypes",
            "field_overrides": "fieldOverrides",
            "added_fields": "addedFields",
            "access_control": "accessControl",
            "work_unit_series": "workUnitSeries",
            "preset": "preset",
            "announcement": "announcement",
            "custom_stages": "customStages",
            "zones": "zones",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_API_LAMBDA, "POST", "ops/teams", body, None)

    if operation == "update_team":
        team_id = params.pop("team_id", "")
        body = {}
        mapping = {
            "name": "name",
            "description": "description",
            "color": "color",
            "ticket_type_id": "ticketTypeId",
            "allowed_ticket_types": "allowedTicketTypes",
            "field_overrides": "fieldOverrides",
            "added_fields": "addedFields",
            "access_control": "accessControl",
            "work_unit_series": "workUnitSeries",
            "announcement": "announcement",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_API_LAMBDA, "PUT", f"ops/teams/{team_id}", body, None)

    if operation == "update_zones":
        team_id = params.get("team_id", "")
        zones = params.get("zones", [])
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/teams/{team_id}/zones",
            {"zones": zones},
            None,
        )

    if operation == "update_stages":
        team_id = params.get("team_id", "")
        stages = params.get("stages", [])
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/teams/{team_id}/stages",
            {"stages": stages},
            None,
        )

    if operation == "list_tickets":
        qp = {}
        param_map = {
            "team_id": "teamId",
            "stage_id": "stageId",
            "status_type": "statusType",
            "assignee_id": "assigneeId",
            "customer_id": "customerId",
            "work_unit_id": "workUnitId",
            "project_id": "projectId",
            "priority": "priority",
            "include_archived": "includeArchived",
            "limit": "limit",
            "cursor": "cursor",
        }
        for snake, camel in param_map.items():
            if params.get(snake):
                qp[camel] = params[snake]
        return (OPS_API_LAMBDA, "GET", "ops/tickets", None, qp or None)

    if operation == "get_ticket":
        if params.get("display_id"):
            return (
                OPS_API_LAMBDA,
                "GET",
                f"ops/tickets/by-display-id/{params['display_id']}",
                None,
                None,
            )
        qp = {}
        if params.get("team_id"):
            qp["teamId"] = params["team_id"]
        return (
            OPS_API_LAMBDA,
            "GET",
            f"ops/tickets/{params.get('ticket_id', '')}",
            None,
            qp or None,
        )

    if operation == "search_tickets":
        qp = {"search": params.get("query", "")}
        if params.get("team_id"):
            qp["teamId"] = params["team_id"]
        return (OPS_API_LAMBDA, "GET", "ops/tickets", None, qp)

    if operation == "create_ticket":
        # Map snake_case params to camelCase expected by the API
        body = {}
        mapping = {
            "team_id": "teamId",
            "title": "title",
            "ticket_type_id": "ticketTypeId",
            "description": "description",
            "stage_id": "stageId",
            "zone_id": "zoneId",
            "priority": "priority",
            "assignee_id": "assigneeId",
            "assignee_name": "assigneeName",
            "reporter_id": "reporterId",
            "reporter_name": "reporterName",
            "due_date": "dueDate",
            "customer_id": "customerId",
            "customer_name": "customerName",
            "supplier_id": "supplierId",
            "supplier_name": "supplierName",
            "work_unit_id": "workUnitId",
            "project_id": "projectId",
            "tags": "tags",
            "fields": "fields",
            "effort_points": "effortPoints",
            "source_type": "sourceType",
            "source_id": "sourceId",
            "source_app_type": "sourceAppType",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_API_LAMBDA, "POST", "ops/tickets", body, None)

    if operation == "update_ticket":
        ticket_id = params.pop("ticket_id", "")
        body = {}
        mapping = {
            "team_id": "teamId",
            "current_team_id": "currentTeamId",
            "title": "title",
            "description": "description",
            "stage_id": "stageId",
            "zone_id": "zoneId",
            "priority": "priority",
            "assignee_id": "assigneeId",
            "assignee_name": "assigneeName",
            "reporter_id": "reporterId",
            "reporter_name": "reporterName",
            "due_date": "dueDate",
            "customer_id": "customerId",
            "customer_name": "customerName",
            "supplier_id": "supplierId",
            "supplier_name": "supplierName",
            "work_unit_id": "workUnitId",
            "project_id": "projectId",
            "tags": "tags",
            "fields": "fields",
            "effort_points": "effortPoints",
            "order": "order",
            "version": "version",
            "archived": "archived",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_API_LAMBDA, "PUT", f"ops/tickets/{ticket_id}", body, None)

    if operation == "delete_ticket":
        ticket_id = params.get("ticket_id", "")
        qp = {}
        if params.get("team_id"):
            qp["teamId"] = params["team_id"]
        return (OPS_API_LAMBDA, "DELETE", f"ops/tickets/{ticket_id}", None, qp or None)

    if operation == "bulk_update_tickets":
        changes = dict(params.get("changes", {}))
        # Backend requires teamId in changes for ticket lookup
        if params.get("team_id") and "teamId" not in changes:
            changes["teamId"] = params["team_id"]
        body = {
            "ticketIds": params.get("ticket_ids", []),
            "changes": changes,
        }
        return (OPS_API_LAMBDA, "POST", "ops/tickets/bulk", body, None)

    if operation == "add_comment":
        ticket_id = params.get("ticket_id", "")
        body = {
            "content": params.get("content", ""),
            "teamId": params.get("team_id"),
            "displayId": params.get("display_id"),
        }
        if "attachments" in params:
            body["attachments"] = params["attachments"]
        return (OPS_API_LAMBDA, "POST", f"ops/tickets/{ticket_id}/comments", body, None)

    if operation == "list_comments":
        ticket_id = params.get("ticket_id", "")
        return (OPS_API_LAMBDA, "GET", f"ops/tickets/{ticket_id}/comments", None, None)

    if operation == "get_audit":
        ticket_id = params.get("ticket_id", "")
        return (OPS_API_LAMBDA, "GET", f"ops/tickets/{ticket_id}/audit", None, None)

    if operation == "upload_attachment":
        body = {
            "fileName": params.get("file_name", ""),
            "contentType": params.get("content_type", "application/octet-stream"),
            "contextId": params.get("ticket_id"),
        }
        return (OPS_API_LAMBDA, "POST", "ops/uploads/presigned-url", body, None)

    if operation == "list_work_units":
        team_id = params.get("team_id", "")
        return (OPS_API_LAMBDA, "GET", f"ops/teams/{team_id}/work-units", None, None)

    if operation == "create_work_unit":
        team_id = params.get("team_id", "")
        body = {}
        mapping = {
            "name": "name",
            "goal": "goal",
            "start_date": "startDate",
            "end_date": "endDate",
            "status": "status",
            "capacity": "capacity",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_API_LAMBDA, "POST", f"ops/teams/{team_id}/work-units", body, None)

    if operation == "update_work_unit":
        team_id = params.get("team_id", "")
        work_unit_id = params.get("work_unit_id", "")
        body = {}
        mapping = {
            "name": "name",
            "goal": "goal",
            "start_date": "startDate",
            "end_date": "endDate",
            "status": "status",
            "capacity": "capacity",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/teams/{team_id}/work-units/{work_unit_id}",
            body,
            None,
        )

    if operation == "delete_work_unit":
        team_id = params.get("team_id", "")
        work_unit_id = params.get("work_unit_id", "")
        return (
            OPS_API_LAMBDA,
            "DELETE",
            f"ops/teams/{team_id}/work-units/{work_unit_id}",
            None,
            None,
        )

    if operation == "create_link":
        ticket_id = params.get("ticket_id", "")
        body = {
            "linkedTicketId": params.get("linked_ticket_id", ""),
            "linkedTicketDisplayId": params.get("linked_ticket_display_id", ""),
            "linkedTicketTitle": params.get("linked_ticket_title"),
            "linkType": params.get("link_type", ""),
            "teamId": params.get("team_id"),
            "linkedTeamId": params.get("linked_team_id"),
        }
        return (OPS_API_LAMBDA, "POST", f"ops/tickets/{ticket_id}/links", body, None)

    if operation == "delete_link":
        ticket_id = params.get("ticket_id", "")
        link_type = params.get("link_type", "")
        linked_ticket_id = params.get("linked_ticket_id", "")
        return (
            OPS_API_LAMBDA,
            "DELETE",
            f"ops/tickets/{ticket_id}/links/{link_type}/{linked_ticket_id}",
            None,
            None,
        )

    if operation == "get_metrics":
        qp = {}
        if params.get("team_ids"):
            qp["teamIds"] = params["team_ids"]
        elif params.get("team_id"):
            qp["teamIds"] = params["team_id"]
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
    # If the caller provided a display_id (e.g. 'BUG-002') instead of a
    # ticket_id UUID, resolve it before routing to the Lambda.
    _ticket_mutations = {
        "update_ticket",
        "delete_ticket",
        "add_comment",
        "list_comments",
        "get_audit",
    }
    if operation in _ticket_mutations:
        has_ticket_id = bool(op_params.get("ticket_id"))
        has_display_id = bool(op_params.get("display_id"))
        if not has_ticket_id and not has_display_id:
            raise ValueError(
                f"Missing required parameter for {operation}: "
                "ticket_id (UUID) or display_id (e.g. 'BUG-002')"
            )
        if has_display_id and not has_ticket_id:
            resolved_id, resolved_team_id = _resolve_ticket_by_display_id(
                op_params["display_id"],
                user_sub=user_sub,
                user_email=user_email,
                user_name=user_name,
                user_groups=user_groups,
            )
            op_params["ticket_id"] = resolved_id
            if not op_params.get("team_id") and resolved_team_id:
                op_params["team_id"] = resolved_team_id

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
