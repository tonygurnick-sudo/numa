"""Seed default company knowledge base.

This Lambda creates the default "company" KB on stack deployment if it doesn't exist.
Invoked once via Terraform LambdaInvocation resource.
"""

import json
import os
from datetime import datetime, timezone

import boto3
import structlog

logger = structlog.get_logger()

# Initialize DynamoDB client
dynamodb = boto3.client("dynamodb")


def handler(event, context):
    """
    Seed the default company knowledge base.

    Creates a KB record with:
    - kb_id: "company" (fixed, not UUID)
    - kb_name: "Company Knowledge Base"
    - s3_prefix: "documents/company/"
    - viewers: ["*"] (all users)
    - editors: [] (empty)
    - is_default: True
    """
    try:
        client_name = os.environ.get("CLIENT_NAME", "")
        if not client_name:
            raise ValueError("CLIENT_NAME environment variable not set")

        table_name = f"numa-{client_name}-knowledge-bases"
        tenant_pk = f"TENANT#{client_name}"
        kb_id = "company"
        now = datetime.now(timezone.utc).isoformat()

        logger.info(
            "Seeding default KB",
            client_name=client_name,
            table_name=table_name,
            kb_id=kb_id,
        )

        # Check if default KB already exists (idempotent)
        try:
            response = dynamodb.get_item(
                TableName=table_name,
                Key={"PK": {"S": tenant_pk}, "SK": {"S": f"KB#{kb_id}"}},
            )
            if response.get("Item"):
                logger.info("Default KB already exists, skipping creation")
                return {
                    "statusCode": 200,
                    "body": json.dumps(
                        {
                            "status": "success",
                            "message": "Default KB already exists",
                            "kb_id": kb_id,
                        }
                    ),
                }
        except Exception as e:
            logger.warning("Error checking for existing KB", error=str(e))
            # Continue with creation attempt

        # Create default KB record
        kb_item = {
            "PK": {"S": tenant_pk},
            "SK": {"S": f"KB#{kb_id}"},
            "kb_id": {"S": kb_id},
            "kb_name": {"S": "Company Knowledge Base"},
            "s3_prefix": {"S": "documents/company/"},
            "is_default": {"BOOL": True},
            "viewers": {"SS": ["*"]},  # All users can view
            "editors": {"L": []},  # Empty list (no specific editors for default KB)
            "created_by": {"S": "system"},
            "created_at": {"S": now},
            "updated_at": {"S": now},
            "status": {"S": "ACTIVE"},
            "document_count": {"N": "0"},
        }

        dynamodb.put_item(TableName=table_name, Item=kb_item)

        logger.info("Default KB created successfully", kb_id=kb_id)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "status": "success",
                    "message": "Default KB created",
                    "kb_id": kb_id,
                }
            ),
        }

    except Exception as e:
        logger.error("Failed to seed default KB", error=str(e), exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps(
                {"status": "error", "message": f"Failed to seed default KB: {str(e)}"}
            ),
        }
