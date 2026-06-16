"""Seed default system knowledge bases.

This Lambda creates system KB records on stack deployment if they do not exist.
Invoked once via Terraform LambdaInvocation resource.
"""

import json
import os
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError

from prm import client as prm_client

logger = structlog.get_logger()

# Initialize DynamoDB client
dynamodb = prm_client("dynamodb")

SYSTEM_KBS = [
    {
        "kb_id": "company",
        "kb_name": "Company Knowledge Base",
        "s3_prefix": "documents/company/",
        "is_default": True,
    },
    {
        "kb_id": "numa-support",
        "kb_name": "Numa Support",
        "s3_prefix": "documents/numa-support/",
        "is_default": False,
    },
    {
        # Cross-job Synergy (12d) corpus, auto-populated by the synergy KB crawler.
        # viewers ["*"] makes it SELECTABLE in the chat KB picker for all users, but
        # per-document `allowed_users` metadata gates what each user can actually
        # retrieve (fail-closed listContains filter in the query path). hidden +
        # auto_managed keep it OUT of the Files/Folders management page while still
        # surfacing it in the chat selector. editors [] => read-only via chat.
        "kb_id": "synergy",
        "kb_name": "Synergy (12d)",
        "s3_prefix": "documents/synergy/",
        "is_default": False,
        "hidden": True,
        "auto_managed": True,
    },
]


def handler(event, context):
    """
    Seed system-managed knowledge bases.

    Creates KB records with:
    - kb_id fixed system IDs (not UUID)
    - viewers as String Set {"SS": ["*"]} so visibility parsing works
    - editors empty list (no user write access by default)
    """
    try:
        # Explicitly mark Lambda parameters as unused in this handler
        del event, context
        client_name = os.environ.get("CLIENT_NAME", "")
        if not client_name:
            raise ValueError("CLIENT_NAME environment variable not set")

        table_name = f"numa-{client_name}-knowledge-bases"
        tenant_pk = f"TENANT#{client_name}"
        now = datetime.now(timezone.utc).isoformat()

        created_kbs = []
        skipped_kbs = []
        for kb in SYSTEM_KBS:
            kb_id = kb["kb_id"]
            logger.info(
                "Seeding system KB",
                client_name=client_name,
                table_name=table_name,
                kb_id=kb_id,
            )

            # Check if KB already exists (idempotent)
            try:
                response = dynamodb.get_item(
                    TableName=table_name,
                    Key={"PK": {"S": tenant_pk}, "SK": {"S": f"KB#{kb_id}"}},
                )
                if response.get("Item"):
                    logger.info("System KB already exists, skipping", kb_id=kb_id)
                    skipped_kbs.append(kb_id)
                    continue
            except ClientError as e:
                logger.warning(
                    "Error checking for existing system KB",
                    kb_id=kb_id,
                    error=str(e),
                )
                # Continue with creation attempt

            kb_item = {
                "PK": {"S": tenant_pk},
                "SK": {"S": f"KB#{kb_id}"},
                "kb_id": {"S": kb_id},
                "kb_name": {"S": kb["kb_name"]},
                "s3_prefix": {"S": kb["s3_prefix"]},
                "is_default": {"BOOL": kb["is_default"]},
                "viewers": {
                    "SS": ["*"]
                },  # Must be SS for permission parser compatibility
                "editors": {"L": []},
                "created_by": {"S": "system"},
                "created_at": {"S": now},
                "updated_at": {"S": now},
                "status": {"S": "ACTIVE"},
                "document_count": {"N": "0"},
            }
            # Auto-managed KBs (e.g. the Synergy crawler corpus) are hidden from
            # the Files/Folders management page but stay selectable in chat.
            if kb.get("hidden"):
                kb_item["hidden"] = {"BOOL": True}
            if kb.get("auto_managed"):
                kb_item["auto_managed"] = {"BOOL": True}

            dynamodb.put_item(TableName=table_name, Item=kb_item)
            created_kbs.append(kb_id)
            logger.info("System KB created successfully", kb_id=kb_id)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "status": "success",
                    "message": "System KB seeding complete",
                    "created_kbs": created_kbs,
                    "skipped_kbs": skipped_kbs,
                }
            ),
        }

    except (ValueError, ClientError) as e:
        logger.error("Failed to seed system KBs", error=str(e), exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps(
                {"status": "error", "message": f"Failed to seed system KBs: {str(e)}"}
            ),
        }
