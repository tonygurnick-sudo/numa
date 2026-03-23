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

logger = structlog.get_logger()

# Environment variables for ops Lambda names (set conditionally when NUMA_OPS is enabled)
OPS_API_LAMBDA = os.environ.get("OPS_API_LAMBDA_NAME", "")
OPS_CONFIG_API_LAMBDA = os.environ.get("OPS_CONFIG_API_LAMBDA_NAME", "")
OPS_CRM_API_LAMBDA = os.environ.get("OPS_CRM_API_LAMBDA_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def _get_lambda_client():
    """Get Lambda client with PRM tracking."""
    return prm_client("lambda", region=AWS_REGION)


def _build_apigw_event(
    method: str,
    path: str,
    body: dict | None = None,
    query_params: dict | None = None,
    user_sub: str = "",
    user_email: str = "",
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
    "list_tickets",
    "get_ticket",
    "search_tickets",
    "create_ticket",
    "update_ticket",
    "delete_ticket",
    "add_comment",
    "list_comments",
    "upload_attachment",
    "get_metrics",
}

# Operations that route to numa-ops-config-api
OPS_CONFIG_OPERATIONS = {
    "get_config",
    "list_projects",
    "create_project",
    "update_project",
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
        return (OPS_CONFIG_API_LAMBDA, "POST", "ops/config/projects", params, None)

    if operation == "update_project":
        project_id = params.pop("project_id", "")
        return (
            OPS_CONFIG_API_LAMBDA,
            "PUT",
            f"ops/config/projects/{project_id}",
            params,
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
            "access_control": "accessControl",
            "work_unit_series": "workUnitSeries",
            "preset": "preset",
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
            "access_control": "accessControl",
            "work_unit_series": "workUnitSeries",
        }
        for snake, camel in mapping.items():
            if params.get(snake) is not None:
                body[camel] = params[snake]
        return (OPS_API_LAMBDA, "PUT", f"ops/teams/{team_id}", body, None)

    if operation == "list_tickets":
        qp = {}
        param_map = {
            "team_id": "teamId",
            "stage_id": "stageId",
            "status_type": "statusType",
            "assignee_id": "assigneeId",
            "customer_id": "customerId",
            "work_unit_id": "workUnitId",
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
            "tags": "tags",
            "fields": "fields",
            "effort_points": "effortPoints",
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

    if operation == "add_comment":
        ticket_id = params.get("ticket_id", "")
        body = {
            "content": params.get("content", ""),
            "teamId": params.get("team_id"),
            "displayId": params.get("display_id"),
        }
        return (OPS_API_LAMBDA, "POST", f"ops/tickets/{ticket_id}/comments", body, None)

    if operation == "list_comments":
        ticket_id = params.get("ticket_id", "")
        return (OPS_API_LAMBDA, "GET", f"ops/tickets/{ticket_id}/comments", None, None)

    if operation == "upload_attachment":
        body = {
            "fileName": params.get("file_name", ""),
            "contentType": params.get("content_type", "application/octet-stream"),
            "contextId": params.get("ticket_id"),
        }
        return (OPS_API_LAMBDA, "POST", "ops/uploads/presigned-url", body, None)

    if operation == "get_metrics":
        qp = {}
        if params.get("team_ids"):
            qp["teamIds"] = params["team_ids"]
        elif params.get("team_id"):
            qp["teamIds"] = params["team_id"]
        return (OPS_API_LAMBDA, "GET", "ops/metrics", None, qp or None)

    raise ValueError(f"Unknown ops operation: {operation}")


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
        "user_sub": "...",
        "user_email": "...",
        "user_groups": [...]
    }
    """
    operation = event.get("operation", "")
    op_params = event.get("params", {})
    user_sub = event.get("user_sub", "")
    user_email = event.get("user_email", "")
    user_groups = event.get("user_groups", [])

    # Make a copy of params to avoid mutating the original
    op_params = dict(op_params)

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
            user_groups=user_groups,
        )

        return result

    except Exception as e:
        logger.error(
            "Ops operation failed",
            operation=operation,
            error=str(e),
        )
        raise
