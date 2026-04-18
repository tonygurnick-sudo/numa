"""Disaster recovery export Lambda.

Triggered every 6 hours by EventBridge. Exports:
1. All DynamoDB tables matching the client prefix to S3 (DynamoDB JSON format)
2. Cognito User Pool users and groups to S3 (JSON)
3. Secrets Manager secrets to S3 (KMS-encrypted JSON)
"""

import json
import os
from datetime import datetime, timezone

import boto3
import structlog
from botocore.exceptions import ClientError

from prm import client

logger = structlog.get_logger()

RECOVERY_BUCKET = os.environ["RECOVERY_BUCKET"]
CLIENT_NAME = os.environ["CLIENT_NAME"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
KMS_KEY_ID = os.environ["KMS_KEY_ID"]


def handler(event: dict, context: object) -> dict:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    log = logger.bind(client_name=CLIENT_NAME, timestamp=timestamp)

    results = {
        "dynamodb": export_dynamodb_tables(log, timestamp),
        "cognito": export_cognito(log, timestamp),
        "secrets": export_secrets(log, timestamp),
        "qbusiness": export_qbusiness(log, timestamp),
    }

    log.info("DR export complete", results=results, _name="DR_EXPORT_COMPLETE")
    return results


def export_dynamodb_tables(log: structlog.BoundLogger, timestamp: str) -> dict:
    """Export all client DynamoDB tables to S3 using ExportTableToPointInTime."""
    dynamodb = client("dynamodb")
    tables: list[str] = []
    exports_started: list[str] = []
    exports_skipped: list[str] = []
    errors: list[str] = []

    # List all tables matching client prefix
    paginator = dynamodb.get_paginator("list_tables")
    for page in paginator.paginate():
        for table_name in page.get("TableNames", []):
            # Match tables belonging to this client
            if table_name.startswith(f"numa-{CLIENT_NAME}") or table_name.startswith(
                CLIENT_NAME
            ):
                tables.append(table_name)

    log.info(
        "Found DynamoDB tables",
        count=len(tables),
        tables=tables,
        _name="DR_DYNAMO_TABLES",
    )

    for table_name in tables:
        try:
            # Check PITR is enabled (required for export)
            backups = dynamodb.describe_continuous_backups(TableName=table_name)
            pitr_status = (
                backups.get("ContinuousBackupsDescription", {})
                .get("PointInTimeRecoveryDescription", {})
                .get("PointInTimeRecoveryStatus")
            )
            if pitr_status != "ENABLED":
                log.warning(
                    "PITR not enabled, skipping export",
                    table=table_name,
                    _name="DR_DYNAMO_SKIP_NO_PITR",
                )
                exports_skipped.append(table_name)
                continue

            # Start export
            dynamodb.export_table_to_point_in_time(
                TableArn=dynamodb.describe_table(TableName=table_name)["Table"][
                    "TableArn"
                ],
                S3Bucket=RECOVERY_BUCKET,
                S3Prefix=f"dynamodb/{table_name}",
                ExportFormat="DYNAMODB_JSON",
            )
            exports_started.append(table_name)
            log.info(
                "DynamoDB export started",
                table=table_name,
                _name="DR_DYNAMO_EXPORT_START",
            )

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "ConflictException":
                log.info(
                    "Export already in progress",
                    table=table_name,
                    _name="DR_DYNAMO_EXPORT_IN_PROGRESS",
                )
                exports_skipped.append(table_name)
            else:
                log.error(
                    "DynamoDB export failed",
                    table=table_name,
                    error=str(e),
                    _name="DR_DYNAMO_EXPORT_ERROR",
                )
                errors.append(f"{table_name}: {e}")

    return {
        "tables_found": len(tables),
        "exports_started": len(exports_started),
        "exports_skipped": len(exports_skipped),
        "errors": errors,
    }


def export_cognito(log: structlog.BoundLogger, timestamp: str) -> dict:
    """Export Cognito User Pool users and groups to S3."""
    cognito = client("cognito-idp")
    s3 = client("s3")

    # Export all groups
    groups: list[dict] = []
    paginator = cognito.get_paginator("list_groups")
    for page in paginator.paginate(UserPoolId=USER_POOL_ID):
        for group in page.get("Groups", []):
            groups.append(
                {
                    "GroupName": group.get("GroupName"),
                    "Description": group.get("Description"),
                    "RoleArn": group.get("RoleArn"),
                    "Precedence": group.get("Precedence"),
                }
            )

    log.info("Cognito groups exported", count=len(groups), _name="DR_COGNITO_GROUPS")

    # Export all users with group memberships
    users: list[dict] = []
    paginator = cognito.get_paginator("list_users")
    for page in paginator.paginate(UserPoolId=USER_POOL_ID):
        for user in page.get("Users", []):
            username = user.get("Username", "")

            # Get group memberships for this user
            user_groups: list[str] = []
            try:
                group_resp = cognito.admin_list_groups_for_user(
                    UserPoolId=USER_POOL_ID, Username=username
                )
                user_groups = [g["GroupName"] for g in group_resp.get("Groups", [])]
            except ClientError as e:
                log.warning(
                    "Failed to get groups for user",
                    username=username,
                    error=str(e),
                    _name="DR_COGNITO_USER_GROUPS_ERROR",
                )

            users.append(
                {
                    "Username": username,
                    "Attributes": {
                        attr["Name"]: attr["Value"]
                        for attr in user.get("Attributes", [])
                    },
                    "Enabled": user.get("Enabled"),
                    "UserStatus": user.get("UserStatus"),
                    "UserCreateDate": (
                        user.get("UserCreateDate", "").isoformat()
                        if hasattr(user.get("UserCreateDate", ""), "isoformat")
                        else str(user.get("UserCreateDate", ""))
                    ),
                    "UserLastModifiedDate": (
                        user.get("UserLastModifiedDate", "").isoformat()
                        if hasattr(user.get("UserLastModifiedDate", ""), "isoformat")
                        else str(user.get("UserLastModifiedDate", ""))
                    ),
                    "MFAOptions": user.get("MFAOptions", []),
                    "Groups": user_groups,
                }
            )

    log.info("Cognito users exported", count=len(users), _name="DR_COGNITO_USERS")

    # Write to S3
    prefix = f"cognito/{timestamp}"

    s3.put_object(
        Bucket=RECOVERY_BUCKET,
        Key=f"{prefix}/users.json",
        Body=json.dumps(users, indent=2, default=str),
        ContentType="application/json",
    )

    s3.put_object(
        Bucket=RECOVERY_BUCKET,
        Key=f"{prefix}/groups.json",
        Body=json.dumps(groups, indent=2, default=str),
        ContentType="application/json",
    )

    # Export identity providers (SSO config — SAML/OIDC providers)
    identity_providers: list[dict] = []
    try:
        idp_resp = cognito.list_identity_providers(
            UserPoolId=USER_POOL_ID, MaxResults=25
        )
        for provider_summary in idp_resp.get("Providers", []):
            try:
                provider_detail = cognito.describe_identity_provider(
                    UserPoolId=USER_POOL_ID,
                    ProviderName=provider_summary["ProviderName"],
                )
                idp = provider_detail.get("IdentityProvider", {})
                identity_providers.append(
                    {
                        "ProviderName": idp.get("ProviderName"),
                        "ProviderType": idp.get("ProviderType"),
                        "ProviderDetails": idp.get("ProviderDetails", {}),
                        "AttributeMapping": idp.get("AttributeMapping", {}),
                        "IdpIdentifiers": idp.get("IdpIdentifiers", []),
                    }
                )
            except ClientError as e:
                log.warning(
                    "Failed to describe identity provider",
                    provider=provider_summary.get("ProviderName"),
                    error=str(e),
                    _name="DR_COGNITO_IDP_ERROR",
                )
        log.info(
            "Identity providers exported",
            count=len(identity_providers),
            _name="DR_COGNITO_IDP",
        )
    except ClientError as e:
        log.warning(
            "Failed to list identity providers",
            error=str(e),
            _name="DR_COGNITO_IDP_LIST_ERROR",
        )

    if identity_providers:
        s3.put_object(
            Bucket=RECOVERY_BUCKET,
            Key=f"{prefix}/identity-providers.json",
            Body=json.dumps(identity_providers, indent=2, default=str),
            ContentType="application/json",
        )

    return {
        "users": len(users),
        "groups": len(groups),
        "identityProviders": len(identity_providers),
    }


def export_secrets(log: structlog.BoundLogger, timestamp: str) -> dict:
    """Export all Secrets Manager secrets to S3, encrypted with KMS."""
    secrets_client = client("secretsmanager")
    s3 = client("s3")

    secrets: list[dict] = []
    errors: list[str] = []

    # List all secrets
    paginator = secrets_client.get_paginator("list_secrets")
    for page in paginator.paginate():
        for secret in page.get("SecretList", []):
            secret_name = secret.get("Name", "")
            try:
                value_resp = secrets_client.get_secret_value(SecretId=secret_name)
                secrets.append(
                    {
                        "Name": secret_name,
                        "ARN": secret.get("ARN"),
                        "Description": secret.get("Description"),
                        "SecretString": value_resp.get("SecretString"),
                        "Tags": secret.get("Tags", []),
                    }
                )
            except ClientError as e:
                log.warning(
                    "Failed to get secret value",
                    secret=secret_name,
                    error=str(e),
                    _name="DR_SECRET_GET_ERROR",
                )
                errors.append(f"{secret_name}: {e}")

    log.info(
        "Secrets exported", count=len(secrets), errors=len(errors), _name="DR_SECRETS"
    )

    # Write to S3 with SSE-KMS encryption
    s3.put_object(
        Bucket=RECOVERY_BUCKET,
        Key=f"secrets/{timestamp}/secrets.json",
        Body=json.dumps(secrets, indent=2, default=str),
        ContentType="application/json",
        ServerSideEncryption="aws:kms",
        SSEKMSKeyId=KMS_KEY_ID,
    )

    return {"secrets": len(secrets), "errors": errors}


def export_qbusiness(log: structlog.BoundLogger, timestamp: str) -> dict:
    """Export Q Business application config to S3 (if provisioned)."""
    q_app_id = os.environ.get("Q_APPLICATION_ID")
    if not q_app_id:
        log.info(
            "Q Business not provisioned, skipping export", _name="DR_QBUSINESS_SKIP"
        )
        return {"skipped": True}

    s3 = client("s3")
    config: dict = {}

    try:
        qbusiness = client("qbusiness")

        # Export application config
        try:
            app_resp = qbusiness.get_application(ApplicationId=q_app_id)
            config["application"] = {
                "applicationId": app_resp.get("ApplicationId"),
                "displayName": app_resp.get("DisplayName"),
                "description": app_resp.get("Description"),
                "roleArn": app_resp.get("RoleArn"),
                "status": app_resp.get("Status"),
            }
        except ClientError as e:
            log.warning(
                "Failed to get Q Business application",
                error=str(e),
                _name="DR_QBUSINESS_APP_ERROR",
            )

        # Export indices
        try:
            indices_resp = qbusiness.list_indices(ApplicationId=q_app_id)
            config["indices"] = [
                {
                    "indexId": idx.get("IndexId"),
                    "displayName": idx.get("DisplayName"),
                    "status": idx.get("Status"),
                }
                for idx in indices_resp.get("Indices", [])
            ]
        except ClientError as e:
            log.warning(
                "Failed to list Q Business indices",
                error=str(e),
                _name="DR_QBUSINESS_INDEX_ERROR",
            )

        # Export retrievers
        try:
            retrievers_resp = qbusiness.list_retrievers(ApplicationId=q_app_id)
            config["retrievers"] = [
                {
                    "retrieverId": r.get("RetrieverId"),
                    "displayName": r.get("DisplayName"),
                    "type": r.get("Type"),
                    "status": r.get("Status"),
                }
                for r in retrievers_resp.get("Retrievers", [])
            ]
        except ClientError as e:
            log.warning(
                "Failed to list Q Business retrievers",
                error=str(e),
                _name="DR_QBUSINESS_RETRIEVER_ERROR",
            )

        if config:
            s3.put_object(
                Bucket=RECOVERY_BUCKET,
                Key=f"qbusiness/{timestamp}/config.json",
                Body=json.dumps(config, indent=2, default=str),
                ContentType="application/json",
            )
            log.info("Q Business config exported", _name="DR_QBUSINESS")

    except Exception as e:
        log.warning(
            "Q Business export failed", error=str(e), _name="DR_QBUSINESS_ERROR"
        )
        return {"error": str(e)}

    return {"exported": True}
