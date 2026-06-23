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
    "list_boards",
    "get_board",
    "create_board",
    "update_board",
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
    """Resolve a display ID (e.g. 'BUG-002') to (ticket_id, board_id).

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
    board_id = ticket.get("boardId", "")
    if not ticket_id:
        raise ValueError(
            f"Could not resolve display ID '{display_id}' to a ticket. "
            "Check that the display ID is correct (e.g. 'BUG-002')."
        )
    return ticket_id, board_id


# ── Name → ID resolution ──────────────────────────────────────────────
# Models work naturally with names ("the Funnel stage", "Acme Corp"), but
# the ops API requires internal IDs. Rather than forcing the model to
# dance through get_board / get_config / list_customers to find IDs --
# which it gets wrong (BUG-081) -- the bridge accepts name-based fields
# alongside ID fields and resolves them before calling the API. ID wins
# when both are provided. Lookups are cached per tool invocation.


class _LookupCache:  # pylint: disable=too-many-instance-attributes
    """Per-invocation cache for name→ID lookups so multiple resolutions on
    a single request don't repeat get_board / get_config / list_* calls.
    """

    def __init__(
        self,
        *,
        user_sub: str,
        user_email: str,
        user_name: str,
        user_groups: list | None,
    ) -> None:
        self.user_sub = user_sub
        self.user_email = user_email
        self.user_name = user_name
        self.user_groups = user_groups
        self._boards: list | None = None
        self._board_details: dict[str, dict] = {}
        self._config: dict | None = None
        self._customers_by_search: dict[str, list] = {}
        self._suppliers_by_search: dict[str, list] = {}
        self._work_units_by_board: dict[str, list] = {}

    def _invoke(
        self,
        lambda_name: str,
        method: str,
        path: str,
        body: dict | None = None,
        qp: dict | None = None,
    ) -> dict:
        return _invoke_ops_lambda(
            lambda_name=lambda_name,
            method=method,
            path=path,
            body=body,
            query_params=qp,
            user_sub=self.user_sub,
            user_email=self.user_email,
            user_name=self.user_name,
            user_groups=self.user_groups,
        )

    def boards(self) -> list[dict]:
        if self._boards is None:
            r = self._invoke(OPS_API_LAMBDA, "GET", "ops/boards")
            self._boards = r.get("boards", []) or []
        return self._boards

    def board_details(self, board_id: str) -> dict:
        if board_id not in self._board_details:
            self._board_details[board_id] = (
                self._invoke(OPS_API_LAMBDA, "GET", f"ops/boards/{board_id}") or {}
            )
        return self._board_details[board_id]

    def config(self) -> dict:
        if self._config is None:
            self._config = (
                self._invoke(OPS_CONFIG_API_LAMBDA, "GET", "ops/config") or {}
            )
        return self._config

    def customers_by_search(self, term: str) -> list[dict]:
        key = term.strip().lower()
        if key not in self._customers_by_search:
            r = self._invoke(
                OPS_CRM_API_LAMBDA, "GET", "ops/customers", qp={"search": term}
            )
            self._customers_by_search[key] = r.get("customers", []) or []
        return self._customers_by_search[key]

    def suppliers_by_search(self, term: str) -> list[dict]:
        key = term.strip().lower()
        if key not in self._suppliers_by_search:
            r = self._invoke(
                OPS_CRM_API_LAMBDA, "GET", "ops/suppliers", qp={"search": term}
            )
            self._suppliers_by_search[key] = r.get("suppliers", []) or []
        return self._suppliers_by_search[key]

    def work_units(self, board_id: str) -> list[dict]:
        if board_id not in self._work_units_by_board:
            r = self._invoke(OPS_API_LAMBDA, "GET", f"ops/boards/{board_id}/work-units")
            self._work_units_by_board[board_id] = r.get("workUnits", []) or []
        return self._work_units_by_board[board_id]


def _ci_eq(a: str | None, b: str | None) -> bool:
    """Case-insensitive whitespace-trimmed equality."""
    if a is None or b is None:
        return False
    return a.strip().lower() == b.strip().lower()


# Keys we rename when an API response leaks a DB-shape attribute. The Node
# API does this translation server-side via its dbToApi serializer; this
# walker is belt-and-braces so the model never sees a stray "teamId".
_DB_TO_API_KEYS: dict[str, str] = {
    "teamId": "boardId",
    "team_id": "board_id",
    "team": "board",
    "teams": "boards",
    "teamIds": "boardIds",
    "team_ids": "board_ids",
    "currentTeamId": "currentBoardId",
    "current_team_id": "current_board_id",
    "linkedTeamId": "linkedBoardId",
    "linked_team_id": "linked_board_id",
    "teamName": "boardName",
}


def _translate_response_keys(value: Any) -> Any:
    """Recursively rename DB-shape keys to API-shape (team -> board) on a
    parsed response payload. Leaves values untouched -- only keys are
    renamed.
    """
    if isinstance(value, list):
        return [_translate_response_keys(v) for v in value]
    if isinstance(value, dict):
        return {
            _DB_TO_API_KEYS.get(k, k): _translate_response_keys(v)
            for k, v in value.items()
        }
    return value


def _resolve_board(cache: _LookupCache, name: str) -> str:
    teams = cache.boards()
    matches = [t for t in teams if _ci_eq(t.get("name"), name)]
    if not matches:
        avail = ", ".join(t.get("name", "") for t in teams) or "(none)"
        raise ValueError(f'No board named "{name}". Available boards: {avail}.')
    if len(matches) > 1:
        raise ValueError(
            f'Multiple boards named "{name}" -- use boardId to disambiguate.'
        )
    return matches[0].get("id", "")


def _resolve_stage(
    cache: _LookupCache,
    board_id: str,
    name: str,
    zone_name: str | None = None,
) -> str:
    details = cache.board_details(board_id)
    stages = details.get("stages", []) or []
    zones = details.get("zones", []) or []
    candidates = [s for s in stages if _ci_eq(s.get("name"), name)]
    if zone_name and candidates:
        zone_ids = {z.get("id") for z in zones if _ci_eq(z.get("name"), zone_name)}
        if not zone_ids:
            avail = ", ".join(z.get("name", "") for z in zones) or "(none)"
            raise ValueError(
                f'No zone named "{zone_name}" on this board. '
                f"Available zones: {avail}."
            )
        candidates = [s for s in candidates if s.get("zoneId") in zone_ids]
    if not candidates:
        avail = (
            ", ".join(sorted({s.get("name", "") for s in stages if s.get("name")}))
            or "(none)"
        )
        raise ValueError(
            f'No stage named "{name}" on this board. Available stages: {avail}.'
        )
    if len(candidates) > 1:
        zone_by_id = {z.get("id"): z.get("name", "?") for z in zones}
        locations = ", ".join(
            f'"{c.get("name", "")}" ({zone_by_id.get(c.get("zoneId", ""), "?")} zone)'
            for c in candidates
        )
        raise ValueError(
            f'Stage name "{name}" matches multiple stages: {locations}. '
            "Specify zoneName or stageId to disambiguate."
        )
    return candidates[0].get("id", "")


def _resolve_zone(cache: _LookupCache, board_id: str, name: str) -> str:
    details = cache.board_details(board_id)
    zones = details.get("zones", []) or []
    matches = [z for z in zones if _ci_eq(z.get("name"), name)]
    if not matches:
        avail = ", ".join(z.get("name", "") for z in zones) or "(none)"
        raise ValueError(
            f'No zone named "{name}" on this board. Available zones: {avail}.'
        )
    if len(matches) > 1:
        raise ValueError(f'Multiple zones named "{name}" on this board -- use zoneId.')
    return matches[0].get("id", "")


def _resolve_staff(cache: _LookupCache, name: str) -> tuple[str, str]:
    """Returns (id, canonicalName). Tries exact name match first, then
    case-insensitive substring against name and email.
    """
    config = cache.config()
    staff = config.get("staff", []) or []

    exact = [s for s in staff if _ci_eq(s.get("name"), name)]
    if exact:
        if len(exact) > 1:
            raise ValueError(
                f'Multiple staff named "{name}" -- use the user sub directly.'
            )
        s = exact[0]
        return (
            s.get("id", "") or s.get("sub", ""),
            s.get("name") or name,
        )

    target = name.strip().lower()
    partial = [
        s
        for s in staff
        if target in (s.get("name") or "").lower()
        or target in (s.get("email") or "").lower()
    ]
    if not partial:
        raise ValueError(
            f'No staff member matching "{name}". Use the full name as it '
            "appears in get_config staff, or pass the user sub directly."
        )
    if len(partial) > 1:
        names = ", ".join((s.get("name") or s.get("email") or "") for s in partial[:5])
        raise ValueError(
            f'Multiple staff match "{name}": {names}. Use the full name or sub.'
        )
    s = partial[0]
    return s.get("id", "") or s.get("sub", ""), s.get("name") or name


def _resolve_project(cache: _LookupCache, name: str) -> str:
    config = cache.config()
    projects = config.get("projects", []) or []
    matches = [p for p in projects if _ci_eq(p.get("name"), name)]
    if not matches:
        active = [p.get("name", "") for p in projects if p.get("isActive", True)]
        avail = ", ".join(active) or "(none)"
        raise ValueError(
            f'No project named "{name}". Available active projects: {avail}.'
        )
    if len(matches) > 1:
        raise ValueError(f'Multiple projects named "{name}" -- use projectId.')
    return matches[0].get("id", "")


def _resolve_customer(cache: _LookupCache, name: str) -> tuple[str, str]:
    """Returns (id, canonicalCompanyName)."""
    customers = cache.customers_by_search(name)
    exact = [c for c in customers if _ci_eq(c.get("companyName"), name)]
    if exact:
        if len(exact) > 1:
            raise ValueError(f'Multiple customers named "{name}" -- use customerId.')
        return exact[0].get("id", ""), exact[0].get("companyName") or name
    if not customers:
        raise ValueError(f'No customer matching "{name}".')
    if len(customers) > 1:
        names = ", ".join(c.get("companyName", "") for c in customers[:5])
        suffix = "" if len(customers) <= 5 else f" (and {len(customers) - 5} more)"
        raise ValueError(
            f'Multiple customers match "{name}": {names}{suffix}. '
            "Use the exact company name or customerId."
        )
    return customers[0].get("id", ""), customers[0].get("companyName") or name


def _resolve_supplier(cache: _LookupCache, name: str) -> tuple[str, str]:
    suppliers = cache.suppliers_by_search(name)
    exact = [s for s in suppliers if _ci_eq(s.get("companyName"), name)]
    if exact:
        if len(exact) > 1:
            raise ValueError(f'Multiple suppliers named "{name}" -- use supplierId.')
        return exact[0].get("id", ""), exact[0].get("companyName") or name
    if not suppliers:
        raise ValueError(f'No supplier matching "{name}".')
    if len(suppliers) > 1:
        names = ", ".join(s.get("companyName", "") for s in suppliers[:5])
        raise ValueError(
            f'Multiple suppliers match "{name}": {names}. '
            "Use the exact name or supplierId."
        )
    return suppliers[0].get("id", ""), suppliers[0].get("companyName") or name


def _resolve_lifecycle_stage(
    cache: _LookupCache, name: str, *, supplier: bool = False
) -> str:
    config = cache.config()
    cfg_key = "supplierConfig" if supplier else "crmConfig"
    stages = (config.get(cfg_key) or {}).get("lifecycleStages", []) or []
    matches = [s for s in stages if _ci_eq(s.get("name"), name)]
    if not matches:
        avail = ", ".join(s.get("name", "") for s in stages) or "(none)"
        kind = "supplier" if supplier else "customer"
        raise ValueError(
            f'No {kind} lifecycle stage named "{name}". Available stages: {avail}.'
        )
    if len(matches) > 1:
        raise ValueError(
            f'Multiple lifecycle stages named "{name}" -- use the stage id directly.'
        )
    return matches[0].get("id", "")


def _resolve_work_unit(cache: _LookupCache, board_id: str, name: str) -> str:
    units = cache.work_units(board_id)
    matches = [u for u in units if _ci_eq(u.get("name"), name)]
    if not matches:
        avail = ", ".join(u.get("name", "") for u in units) or "(none)"
        raise ValueError(
            f'No sprint named "{name}" on this board. Available sprints: {avail}.'
        )
    if len(matches) > 1:
        # Reusing names across cycles is common -- prefer the active sprint.
        active = [u for u in matches if u.get("status") == "active"]
        if len(active) == 1:
            return active[0].get("id", "")
        raise ValueError(f'Multiple sprints named "{name}" -- use workUnitId.')
    return matches[0].get("id", "")


def _resolve_ticket_type(cache: _LookupCache, name: str) -> str:
    config = cache.config()
    types = config.get("ticketTypes", []) or []
    matches = [
        t for t in types if _ci_eq(t.get("name"), name) or _ci_eq(t.get("prefix"), name)
    ]
    if not matches:
        avail = (
            ", ".join(f"{t.get('name', '')} ({t.get('prefix', '')})" for t in types)
            or "(none)"
        )
        raise ValueError(f'No ticket type matching "{name}". Available types: {avail}.')
    if len(matches) > 1:
        raise ValueError(
            f'Multiple ticket types matching "{name}" -- use ticketTypeId.'
        )
    return matches[0].get("id", "")


def _pop_first(params: dict, *keys: str) -> str | None:
    """Pop and return the first non-empty value among `keys`, removing all
    listed keys from `params`. Returns None if none found.
    """
    found: str | None = None
    for k in keys:
        v = params.pop(k, None)
        if found is not None:
            continue
        if isinstance(v, str) and v.strip():
            found = v.strip()
        elif v is not None:
            s = str(v).strip()
            found = s or None
    return found


def _drop_keys(params: dict, *keys: str) -> None:
    for k in keys:
        params.pop(k, None)


_SUPPLIER_OPERATIONS = frozenset(
    {
        "list_suppliers",
        "get_supplier",
        "create_supplier",
        "update_supplier",
        "delete_supplier",
        "create_supplier_activity",
        "update_supplier_activity",
        "delete_supplier_activity",
    }
)


def _resolve_names_in_params(
    params: dict,
    cache: _LookupCache,
    *,
    parent_board_id: str = "",
    is_supplier_context: bool = False,
) -> None:
    """Mutate `params`: replace name-based fields with their resolved IDs.

    Handles both pure-lookup names (popped after resolution) and display-name
    fields like assigneeName/customerName (kept and canonicalized so the API
    stores the canonical spelling).

    `parent_board_id` lets callers pass a boardId from an enclosing scope --
    used by bulk_update_tickets where boardId lives at top level but stage /
    work-unit names live inside the `changes` dict.

    `is_supplier_context` tells lifecycle-stage resolution to look at the
    supplier config rather than the customer (CRM) config.
    """

    def has_id(*ks: str) -> bool:
        return any(params.get(k) for k in ks)

    # ── boardName → boardId (run first; many others need boardId)
    if not has_id("boardId", "board_id"):
        board_name = _pop_first(params, "boardName", "board_name")
        if board_name:
            params["boardId"] = _resolve_board(cache, board_name)
    else:
        _drop_keys(params, "boardName", "board_name")

    board_id = params.get("boardId") or params.get("board_id") or parent_board_id or ""

    # ── zoneName → zoneId (also consumed by stage resolution below)
    zone_name: str | None = None
    if not has_id("zoneId", "zone_id"):
        zone_name = _pop_first(params, "zoneName", "zone_name")
    else:
        _drop_keys(params, "zoneName", "zone_name")

    # ── stageName → stageId (requires boardId; consumes zoneName)
    if not has_id("stageId", "stage_id"):
        stage_name = _pop_first(params, "stageName", "stage_name")
        if stage_name:
            if not board_id:
                raise ValueError(
                    f'Cannot resolve stageName "{stage_name}" without a '
                    "boardId or boardName."
                )
            params["stageId"] = _resolve_stage(cache, board_id, stage_name, zone_name)
            zone_name = None  # consumed
    else:
        _drop_keys(params, "stageName", "stage_name")

    # zoneName left over (no stage) -- resolve standalone
    if zone_name and not has_id("zoneId", "zone_id"):
        if not board_id:
            raise ValueError(
                f'Cannot resolve zoneName "{zone_name}" without a boardId or boardName.'
            )
        params["zoneId"] = _resolve_zone(cache, board_id, zone_name)

    # ── targetZoneName → targetZoneId (sprint activation: which board zone to run in)
    if not has_id("targetZoneId", "target_zone_id"):
        target_zone_name = _pop_first(params, "targetZoneName", "target_zone_name")
        if target_zone_name:
            if not board_id:
                raise ValueError(
                    f'Cannot resolve targetZoneName "{target_zone_name}" without a '
                    "boardId or boardName."
                )
            params["targetZoneId"] = _resolve_zone(cache, board_id, target_zone_name)
    else:
        _drop_keys(params, "targetZoneName", "target_zone_name")

    # ── workUnitName / sprintName → workUnitId
    if not has_id("workUnitId", "work_unit_id"):
        wu_name = _pop_first(
            params,
            "workUnitName",
            "work_unit_name",
            "sprintName",
            "sprint_name",
        )
        if wu_name:
            if not board_id:
                raise ValueError(
                    f'Cannot resolve workUnitName "{wu_name}" without a '
                    "boardId or boardName."
                )
            params["workUnitId"] = _resolve_work_unit(cache, board_id, wu_name)
    else:
        _drop_keys(
            params, "workUnitName", "work_unit_name", "sprintName", "sprint_name"
        )

    # ── projectName → projectId
    if not has_id("projectId", "project_id"):
        project_name = _pop_first(params, "projectName", "project_name")
        if project_name:
            params["projectId"] = _resolve_project(cache, project_name)
    else:
        _drop_keys(params, "projectName", "project_name")

    # ── ticketTypeName → ticketTypeId
    if not has_id("ticketTypeId", "ticket_type_id"):
        tt_name = _pop_first(params, "ticketTypeName", "ticket_type_name")
        if tt_name:
            params["ticketTypeId"] = _resolve_ticket_type(cache, tt_name)
    else:
        _drop_keys(params, "ticketTypeName", "ticket_type_name")

    # ── lifecycleStageName → lifecycleStage
    # Heuristic: presence of supplier-only fields (annualSpend / paymentTerms)
    # or supplierLifecycleStageName routes to the supplier config.
    if not has_id("lifecycleStage", "lifecycle_stage"):
        ls_supplier = _pop_first(
            params, "supplierLifecycleStageName", "supplier_lifecycle_stage_name"
        )
        ls_customer = _pop_first(params, "lifecycleStageName", "lifecycle_stage_name")
        is_supplier = bool(
            ls_supplier
            or is_supplier_context
            or params.get("annualSpend") is not None
            or params.get("annual_spend") is not None
            or params.get("paymentTerms") is not None
            or params.get("payment_terms") is not None
        )
        chosen = ls_supplier or ls_customer
        if chosen:
            params["lifecycleStage"] = _resolve_lifecycle_stage(
                cache, chosen, supplier=is_supplier
            )
    else:
        _drop_keys(
            params,
            "lifecycleStageName",
            "lifecycle_stage_name",
            "supplierLifecycleStageName",
            "supplier_lifecycle_stage_name",
        )

    # ── Display-name fields: resolve to IDs when missing, canonicalize the
    # name for storage. These remain valid API fields so we keep them set.
    if not has_id("assigneeId", "assignee_id"):
        a_name = params.get("assigneeName") or params.get("assignee_name")
        if a_name:
            sub, canonical = _resolve_staff(cache, str(a_name))
            params["assigneeId"] = sub
            params["assigneeName"] = canonical
            params.pop("assignee_name", None)

    if not has_id("reporterId", "reporter_id"):
        r_name = params.get("reporterName") or params.get("reporter_name")
        if r_name:
            sub, canonical = _resolve_staff(cache, str(r_name))
            params["reporterId"] = sub
            params["reporterName"] = canonical
            params.pop("reporter_name", None)

    if not has_id("ownerId", "owner_id"):
        o_name = params.get("ownerName") or params.get("owner_name")
        if o_name:
            sub, canonical = _resolve_staff(cache, str(o_name))
            params["ownerId"] = sub
            params["ownerName"] = canonical
            params.pop("owner_name", None)

    if not has_id("customerId", "customer_id"):
        c_name = params.get("customerName") or params.get("customer_name")
        if c_name:
            cid, canonical = _resolve_customer(cache, str(c_name))
            params["customerId"] = cid
            params["customerName"] = canonical
            params.pop("customer_name", None)

    if not has_id("supplierId", "supplier_id"):
        s_name = params.get("supplierName") or params.get("supplier_name")
        if s_name:
            sid, canonical = _resolve_supplier(cache, str(s_name))
            params["supplierId"] = sid
            params["supplierName"] = canonical
            params.pop("supplier_name", None)


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

    if operation == "get_project":
        # Read-only — backend filters by team access (404 if scoped out, no
        # 403 leak). Symmetric with `list_projects` which already filters.
        project_id = _p(params, "projectId", "project_id") or ""
        return (
            OPS_CONFIG_API_LAMBDA,
            "GET",
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
        # `stage` is the API's lifecycle-stage filter. Accept lifecycleStage
        # (the field name resolution sets) as a fallback so name resolution
        # via lifecycleStageName flows through to the right query param.
        qp = _build_qp(
            params,
            [
                ("search", "search"),
                ("stage", "stage", "lifecycleStage", "lifecycle_stage"),
                ("ownerId", "ownerId", "owner_id"),
                ("territory", "territory"),
                ("industry", "industry"),
                ("flags", "flags"),
                # Phone lookup (E.164) — matches a contact's phone or the
                # source_phone customField. Used to find-or-create the CRM
                # customer for a Numa Voice prospect by their dialled number.
                ("phone", "phone", "prospect_phone"),
                ("limit", "limit"),
                ("cursor", "cursor"),
            ],
        )
        return (OPS_CRM_API_LAMBDA, "GET", "ops/customers", None, qp)

    if operation == "search_customers":
        # Thin alias over list_customers with a required `search` param.
        # Backend's `applyFilters` matches `companyName` + `notes` substring
        # case-insensitively. Kept as a distinct op (vs just list_customers
        # with --params '{"search":"..."}') so the LLM has a clear "search"
        # tool name — mirrors search_tickets.
        search_term = _p(params, "search", "query", "q") or ""
        if not search_term:
            raise ValueError(
                "search_customers requires a 'search' param " "(or 'query' / 'q' alias)"
            )
        qp = (
            _build_qp(
                params,
                [
                    ("stage", "stage", "lifecycleStage", "lifecycle_stage"),
                    ("ownerId", "ownerId", "owner_id"),
                    ("territory", "territory"),
                    ("industry", "industry"),
                    ("flags", "flags"),
                    ("limit", "limit"),
                    ("cursor", "cursor"),
                ],
            )
            or {}
        )
        qp["search"] = search_term
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
                ("stage", "stage", "lifecycleStage", "lifecycle_stage"),
                ("ownerId", "ownerId", "owner_id"),
                ("territory", "territory"),
                ("industry", "industry"),
                ("flags", "flags"),
                ("limit", "limit"),
                ("cursor", "cursor"),
            ],
        )
        return (OPS_CRM_API_LAMBDA, "GET", "ops/suppliers", None, qp)

    if operation == "search_suppliers":
        # Mirror of search_customers — required `search` term over the same
        # GET /ops/suppliers endpoint, which already supports `qp.search`
        # via the shared applyFilters helper in numa-ops-crm-api.
        search_term = _p(params, "search", "query", "q") or ""
        if not search_term:
            raise ValueError(
                "search_suppliers requires a 'search' param " "(or 'query' / 'q' alias)"
            )
        qp = (
            _build_qp(
                params,
                [
                    ("stage", "stage", "lifecycleStage", "lifecycle_stage"),
                    ("ownerId", "ownerId", "owner_id"),
                    ("territory", "territory"),
                    ("industry", "industry"),
                    ("flags", "flags"),
                    ("limit", "limit"),
                    ("cursor", "cursor"),
                ],
            )
            or {}
        )
        qp["search"] = search_term
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
    if operation == "list_boards":
        return (OPS_API_LAMBDA, "GET", "ops/boards", None, None)

    if operation == "get_board":
        board_id = _p(params, "boardId", "board_id") or ""
        return (OPS_API_LAMBDA, "GET", f"ops/boards/{board_id}", None, None)

    if operation == "create_board":
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
        return (OPS_API_LAMBDA, "POST", "ops/boards", body, None)

    if operation == "update_board":
        board_id = _p(params, "boardId", "board_id") or ""
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
        return (OPS_API_LAMBDA, "PUT", f"ops/boards/{board_id}", body, None)

    if operation == "update_zones":
        board_id = _p(params, "boardId", "board_id") or ""
        zones = params.get("zones", [])
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/boards/{board_id}/zones",
            {"zones": zones},
            None,
        )

    if operation == "update_stages":
        board_id = _p(params, "boardId", "board_id") or ""
        stages = params.get("stages", [])
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/boards/{board_id}/stages",
            {"stages": stages},
            None,
        )

    if operation == "list_tickets":
        qp = _build_qp(
            params,
            [
                ("boardId", "boardId", "board_id"),
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
        qp = _build_qp(params, [("boardId", "boardId", "board_id")])
        return (
            OPS_API_LAMBDA,
            "GET",
            f"ops/tickets/{ticket_id}",
            None,
            qp,
        )

    if operation == "search_tickets":
        qp = {"search": _p(params, "query", "search") or ""}
        board_id = _p(params, "boardId", "board_id")
        if board_id:
            qp["boardId"] = board_id
        return (OPS_API_LAMBDA, "GET", "ops/tickets", None, qp)

    if operation == "create_ticket":
        body = _build_body(
            params,
            [
                ("boardId", "boardId", "board_id"),
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
                ("boardId", "boardId", "board_id"),
                ("currentBoardId", "currentBoardId", "current_board_id"),
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
        qp = _build_qp(params, [("boardId", "boardId", "board_id")])
        return (OPS_API_LAMBDA, "DELETE", f"ops/tickets/{ticket_id}", None, qp)

    if operation == "bulk_update_tickets":
        changes = dict(params.get("changes", {}))
        board_id = _p(params, "boardId", "board_id")
        if board_id and "boardId" not in changes:
            changes["boardId"] = board_id
        body = {
            "ticketIds": _p(params, "ticketIds", "ticket_ids") or [],
            "changes": changes,
        }
        return (OPS_API_LAMBDA, "POST", "ops/tickets/bulk", body, None)

    if operation == "add_comment":
        ticket_id = _p(params, "ticketId", "ticket_id") or ""
        body = {
            "content": params.get("content", ""),
            "boardId": _p(params, "boardId", "board_id"),
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
        board_id = _p(params, "boardId", "board_id") or ""
        return (OPS_API_LAMBDA, "GET", f"ops/boards/{board_id}/work-units", None, None)

    if operation == "create_work_unit":
        board_id = _p(params, "boardId", "board_id") or ""
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
        return (OPS_API_LAMBDA, "POST", f"ops/boards/{board_id}/work-units", body, None)

    if operation == "update_work_unit":
        board_id = _p(params, "boardId", "board_id") or ""
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
                # Required when activating (status=active): which board zone to run in.
                ("targetZoneId", "targetZoneId", "target_zone_id"),
                # On completion (status=completed): where to roll incomplete tickets.
                # 'next' resolves to the next planning sprint by order.
                (
                    "rolloverToWorkUnitId",
                    "rolloverToWorkUnitId",
                    "rollover_to_work_unit_id",
                ),
            ],
        )
        return (
            OPS_API_LAMBDA,
            "PUT",
            f"ops/boards/{board_id}/work-units/{work_unit_id}",
            body,
            None,
        )

    if operation == "delete_work_unit":
        board_id = _p(params, "boardId", "board_id") or ""
        work_unit_id = _p(params, "workUnitId", "work_unit_id") or ""
        return (
            OPS_API_LAMBDA,
            "DELETE",
            f"ops/boards/{board_id}/work-units/{work_unit_id}",
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
            "boardId": _p(params, "boardId", "board_id"),
            "linkedBoardId": _p(params, "linkedBoardId", "linked_board_id"),
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
        board_ids = _p(params, "boardIds", "board_ids")
        if board_ids:
            qp["boardIds"] = board_ids
        else:
            board_id = _p(params, "boardId", "board_id")
            if board_id:
                qp["boardIds"] = board_id
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
    # Fetch the user's accessible boards (list_boards already filters by access)
    try:
        boards_result = _invoke_ops_lambda(
            lambda_name=OPS_API_LAMBDA,
            method="GET",
            path="ops/boards",
            body=None,
            query_params=None,
            user_sub=user_sub,
            user_email=user_email,
            user_name=user_name,
            user_groups=user_groups,
        )
        accessible_board_ids = {
            b["id"] for b in boards_result.get("boards", []) if "id" in b
        }
    except Exception:
        # If board lookup fails, don't block -- return unfiltered
        logger.warning("Failed to fetch boards for project access filtering")
        return result

    def is_accessible(project: dict) -> bool:
        board_ids = project.get("boardIds")
        if not board_ids:
            return True  # No boards = visible to all
        return bool(set(board_ids) & accessible_board_ids)

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
    # denies, or the approval window expires.
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
                    "message": "Approval timed out",
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

    # ── Default stage for create_ticket ─────────────────────────────────
    # Every board has a `defaultStageId` (and `defaultZoneId`) set at
    # creation, surfaced in the board's meta item by numa-ops-api. If the
    # caller didn't supply a stageId/stageName for create_ticket, fall
    # back to the board's default. Numa Ops UI uses the same default for
    # "Create New Ticket" without picking a stage manually.
    if operation == "create_ticket":
        has_stage = bool(op_params.get("stageId") or op_params.get("stage_id"))
        has_stage_name = bool(op_params.get("stageName") or op_params.get("stage_name"))
        board_id = op_params.get("boardId") or op_params.get("board_id")
        if not has_stage and not has_stage_name and board_id:
            try:
                cache = _LookupCache(
                    user_sub=user_sub,
                    user_email=user_email,
                    user_name=user_name,
                    user_groups=user_groups,
                )
                # board_details() returns the raw API shape:
                #   {"team": {...meta..., defaultStageId, defaultZoneId}, "zones": [...], "stages": [...]}
                # Translation to API names ("team" → "board") happens later
                # in the response path the caller sees — internally we read
                # from .team for the meta fields.
                board_resp = cache.board_details(str(board_id)) or {}
                meta = board_resp.get("team") or board_resp.get("board") or {}
                default_stage_id = meta.get("defaultStageId")
                if default_stage_id:
                    op_params["stageId"] = default_stage_id
                    logger.info(
                        "create_ticket: applied board default stage",
                        board_id=board_id,
                        default_stage_id=default_stage_id,
                    )
                else:
                    logger.warning(
                        "create_ticket: board has no defaultStageId — caller "
                        "must supply stageId or stageName",
                        board_id=board_id,
                    )
            except Exception as e:
                logger.warning(
                    "create_ticket: failed to resolve board default stage",
                    board_id=board_id,
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
        "upload_attachment",
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
            if not isinstance(display_id_val, str) or not display_id_val:
                raise ValueError(
                    f"Invalid displayId for {operation}: expected a non-empty string"
                )
            resolved_id, resolved_board_id = _resolve_ticket_by_display_id(
                display_id_val,
                user_sub=user_sub,
                user_email=user_email,
                user_name=user_name,
                user_groups=user_groups,
            )
            op_params["ticketId"] = resolved_id
            if (
                not (op_params.get("boardId") or op_params.get("board_id"))
                and resolved_board_id
            ):
                op_params["boardId"] = resolved_board_id

    # ── Resolve name-based parameters to IDs ─────────────────────────────
    # Models can pass human-readable names (stageName, customerName,
    # assigneeName, etc.) alongside or instead of IDs. The bridge resolves
    # them here so the API only ever sees IDs. Lookups are cached per
    # invocation so multiple resolutions on the same request don't repeat
    # the same get_board / get_config / list_* calls.
    cache = _LookupCache(
        user_sub=user_sub,
        user_email=user_email,
        user_name=user_name,
        user_groups=user_groups,
    )
    is_supplier_op = operation in _SUPPLIER_OPERATIONS
    _resolve_names_in_params(op_params, cache, is_supplier_context=is_supplier_op)
    # bulk_update_tickets nests its updates inside `changes`, which can
    # carry the same name-based fields (stageName, assigneeName, etc.).
    # Pass the top-level boardId so stage/work-unit resolution has context.
    if operation == "bulk_update_tickets" and isinstance(
        op_params.get("changes"), dict
    ):
        _resolve_names_in_params(
            op_params["changes"],
            cache,
            parent_board_id=op_params.get("boardId") or op_params.get("board_id") or "",
        )

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
        # overlap with the user's accessible boards (or have no boardIds = all).
        if operation in ("list_projects", "get_config") and isinstance(result, dict):
            result = _filter_projects_by_access(
                result, operation, user_sub, user_email, user_name, user_groups
            )

        # Belt-and-braces: the Node API already translates DB-shape to API-shape
        # (teamId -> boardId, etc.) via its serializer. The bridge re-runs the
        # same key-rename pass so the model never sees a leaked team key even
        # if a future API change forgets to wire something through dbToApi.
        result = _translate_response_keys(result)

        # Pagination guard: the ops API only returns a `cursor` when MORE
        # tickets exist beyond the page just returned (a `limit` was in
        # effect). Surface that loudly in the payload the model reads — a bare
        # cursor field is easy to overlook, and silently dropping the tail of a
        # "give me everything" query corrupts any count/report built from it
        # (observed on HQ: 4 deals sat past a 175-row page and were nearly
        # missed). Omit `limit` entirely to have the API auto-paginate instead.
        if (
            operation == "list_tickets"
            and isinstance(result, dict)
            and result.get("cursor")
        ):
            returned = len(result.get("tickets") or [])
            result["_pagination"] = (
                f"INCOMPLETE RESULT: {returned} tickets returned, but MORE exist "
                "beyond this page. To get them, either re-run list_tickets with "
                'the SAME filters plus params {"cursor": "<the cursor value '
                'above>"} and merge each page until no cursor comes back, OR '
                "omit `limit` to let the API return every ticket in one call. Do "
                "not compute totals or draw conclusions until the cursor is "
                "exhausted."
            )

        return result

    except Exception as e:
        logger.error(
            "Ops operation failed",
            operation=operation,
            error=str(e),
        )
        raise
