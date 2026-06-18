"""
Pipedream Schema Refresh Lambda - Pre-fetches integration action schemas.

Runs weekly via EventBridge to populate the pipedream-integration-schemas DynamoDB
table. This allows workspace agents to load all integration schemas in a single
BatchGetItem call instead of making N sequential Pipedream API calls on cold start.

Each DynamoDB item stores all actions for one integration slug:
  - PK: app_slug (e.g. "google_drive")
  - schemas: JSON string of {actions: [...], index: [...]}
  - action_count: number of actions
  - updated_at: epoch timestamp
  - ttl: auto-expiry at updated_at + 30 days
"""

import json
import os
import time
from typing import Any, Dict, List, Optional

import requests
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from prm import client as prm_client

logger = structlog.get_logger()

SCHEMA_CACHE_TABLE = os.environ.get("SCHEMA_CACHE_TABLE", "")
PIPEDREAM_SECRET_ARN = os.environ.get("PIPEDREAM_SECRET_ARN", "")
SUPPORTED_INTEGRATIONS = json.loads(os.environ.get("SUPPORTED_INTEGRATIONS", "[]"))

TTL_DAYS = 30


def _get_pipedream_credentials() -> Dict[str, str]:
    """Fetch Pipedream OAuth credentials from Secrets Manager."""
    secrets_client = prm_client("secretsmanager")
    response = secrets_client.get_secret_value(SecretId=PIPEDREAM_SECRET_ARN)
    return json.loads(response["SecretString"])


def _get_access_token(credentials: Dict[str, str]) -> str:
    """Get OAuth access token from Pipedream."""
    response = requests.post(
        "https://api.pipedream.com/v1/oauth/token",
        headers={
            "Content-Type": "application/json",
            "x-pd-environment": credentials["environment"],
        },
        json={
            "grant_type": "client_credentials",
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
        },
        timeout=10,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def _list_actions(
    app_slug: str,
    project_id: str,
    environment: str,
    access_token: str,
) -> List[Dict[str, Any]]:
    """Fetch all actions for an integration from Pipedream API with pagination.

    Fetches the default (public-registry) listing plus the workspace's
    privately published custom tools (``registry=private``) — Pipedream
    excludes custom tools from the default listing, so without the second
    fetch keys like ``~/pipedrive-add-file`` never reach the schema cache.
    """

    def _fetch_all_pages(registry: Optional[str]) -> List[Dict[str, Any]]:
        collected: List[Dict[str, Any]] = []
        after_cursor: Optional[str] = None
        limit = 100

        while True:
            params: Dict[str, Any] = {
                "app": app_slug,
                "component_type": "action",
                "limit": limit,
            }
            if registry:
                params["registry"] = registry
            if after_cursor:
                params["after"] = after_cursor

            response = requests.get(
                f"https://api.pipedream.com/v1/connect/{project_id}/components",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "x-pd-environment": environment,
                },
                params=params,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

            collected.extend(data.get("data", []))

            page_info = data.get("page_info", {})
            if page_info.get("count", 0) < limit:
                break
            after_cursor = page_info.get("end_cursor")
            if not after_cursor:
                break

        return collected

    all_actions = _fetch_all_pages(None)

    # The registry param is undocumented — if Pipedream changes it, custom
    # tools drop out of the cache but public schemas must keep refreshing.
    try:
        private_actions = _fetch_all_pages("private")
    except Exception as e:
        logger.warning(
            "Failed to list private-registry actions",
            app_slug=app_slug,
            error=str(e),
        )
        private_actions = []

    seen_keys = {a.get("key") for a in all_actions}
    all_actions.extend(a for a in private_actions if a.get("key") not in seen_keys)

    # Hide Pipedream's private-component "~/" namespace from the agent-facing
    # cache: present custom tools under their bare key (e.g. "pipedrive-add-file")
    # so the workspace index shows them like any public action. The proxy's
    # run_action / configure_props re-add "~/" at the Pipedream boundary. Guard
    # the (theoretical) public-key collision — keep "~/" there to disambiguate.
    public_keys = {
        a.get("key") for a in all_actions if not str(a.get("key", "")).startswith("~/")
    }
    for action in all_actions:
        key = action.get("key", "")
        if isinstance(key, str) and key.startswith("~/"):
            bare = key[2:]
            if bare and bare not in public_keys:
                action["key"] = bare

    return all_actions


def _build_index(actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build a compact index from full action schemas.

    Matches the format used by the workspace agent's _download_single_integration().
    """
    index = []
    for action in actions:
        key = action.get("key", "")
        index.append(
            {
                "key": key,
                "name": action.get("name", ""),
                "description": (action.get("description") or "")[:200],
                "annotations": action.get("annotations", {}),
                "prop_count": len(action.get("configurable_props", [])),
                "file": key.replace("/", "_") + ".json",
            }
        )
    return index


def _write_to_dynamo(
    dynamo_client: Any,
    app_slug: str,
    actions: List[Dict[str, Any]],
    index: List[Dict[str, Any]],
) -> None:
    """Write schemas for one integration to the cache table."""
    now = int(time.time())
    schemas_json = json.dumps({"actions": actions, "index": index})

    dynamo_client.put_item(
        TableName=SCHEMA_CACHE_TABLE,
        Item={
            "app_slug": {"S": app_slug},
            "schemas": {"S": schemas_json},
            "action_count": {"N": str(len(actions))},
            "updated_at": {"N": str(now)},
            "ttl": {"N": str(now + TTL_DAYS * 86400)},
        },
    )


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """Refresh integration schemas for all supported integrations."""
    logger.info(
        "Starting schema refresh",
        integration_count=len(SUPPORTED_INTEGRATIONS),
    )

    if not SCHEMA_CACHE_TABLE:
        raise ValueError("SCHEMA_CACHE_TABLE environment variable not set")
    if not PIPEDREAM_SECRET_ARN:
        raise ValueError("PIPEDREAM_SECRET_ARN environment variable not set")

    credentials = _get_pipedream_credentials()
    access_token = _get_access_token(credentials)
    project_id = credentials["project_id"]
    environment = credentials["environment"]

    dynamo = prm_client("dynamodb")

    succeeded = []
    failed = []

    for slug in SUPPORTED_INTEGRATIONS:
        try:
            actions = _list_actions(slug, project_id, environment, access_token)
            index = _build_index(actions)
            _write_to_dynamo(dynamo, slug, actions, index)

            succeeded.append(slug)
            logger.info(
                "Refreshed schema",
                app_slug=slug,
                action_count=len(actions),
            )
        except Exception as e:
            failed.append(slug)
            logger.error(
                "Failed to refresh schema",
                app_slug=slug,
                error=str(e),
            )

    logger.info(
        "Schema refresh complete",
        succeeded_count=len(succeeded),
        failed_count=len(failed),
        failed_slugs=failed,
    )

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "succeeded": len(succeeded),
                "failed": len(failed),
                "failed_slugs": failed,
            }
        ),
    }
