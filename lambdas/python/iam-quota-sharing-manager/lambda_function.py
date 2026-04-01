"""
IAM Quota Sharing Manager - Idempotent IAM resource management.

Creates or retrieves the bedrock-quota-sharing IAM role and policy.
Safe to call multiple times - checks existence before creating.
"""

import json

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

from helpers import setup_logging
from prm import client as prm_client

logger = structlog.get_logger()

ROLE_NAME = "bedrock-quota-sharing"
POLICY_NAME = "bedrock-quota-sharing"


def handler(event: dict, _context: LambdaContext) -> dict:
    """
    Create or retrieve bedrock-quota-sharing IAM role and policy.

    Event:
        assume_role_policy: dict - The trust policy for the role
        policy_document: dict - The permissions policy document

    Returns:
        role_arn: str - ARN of the role (created or existing)
        policy_arn: str - ARN of the policy (created or existing)
        status: str - 'success' | 'error'
        created_role: bool - Whether role was newly created
        created_policy: bool - Whether policy was newly created
    """
    setup_logging()
    logger.info("Starting IAM quota sharing manager", lambda_event=event)

    iam = prm_client("iam")
    account_id = prm_client("sts").get_caller_identity()["Account"]

    result = {
        "role_arn": None,
        "policy_arn": None,
        "status": "success",
        "created_role": False,
        "created_policy": False,
    }

    # Handle role
    role_arn, created = _ensure_role(iam, ROLE_NAME, event["assume_role_policy"])
    result["role_arn"] = role_arn
    result["created_role"] = created

    # Handle policy
    policy_arn, created = _ensure_policy(
        iam, POLICY_NAME, event["policy_document"], account_id
    )
    result["policy_arn"] = policy_arn
    result["created_policy"] = created

    # Ensure policy is attached to role
    _ensure_policy_attached(iam, ROLE_NAME, policy_arn)

    logger.info("IAM quota sharing manager complete", result=result)
    return result


def _ensure_role(iam, role_name: str, assume_role_policy: dict) -> tuple[str, bool]:
    """Create role if it doesn't exist. Returns (arn, was_created)."""
    try:
        response = iam.get_role(RoleName=role_name)
        logger.info(f"Role {role_name} already exists")
        return response["Role"]["Arn"], False
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        if error_code != "NoSuchEntity":
            raise

    # Role doesn't exist, create it
    logger.info(f"Creating role {role_name}")
    response = iam.create_role(
        RoleName=role_name,
        AssumeRolePolicyDocument=json.dumps(assume_role_policy),
        Description="Cross-account Bedrock quota sharing role",
    )
    return response["Role"]["Arn"], True


def _ensure_policy(
    iam, policy_name: str, policy_doc: dict, account_id: str
) -> tuple[str, bool]:
    """Create or update policy. Returns (arn, was_created)."""
    policy_arn = f"arn:aws:iam::{account_id}:policy/{policy_name}"

    try:
        iam.get_policy(PolicyArn=policy_arn)
        logger.info(f"Policy {policy_name} already exists, checking for updates")
        _update_policy_if_changed(iam, policy_arn, policy_doc)
        return policy_arn, False
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        if error_code != "NoSuchEntity":
            raise

    # Policy doesn't exist, create it
    logger.info(f"Creating policy {policy_name}")
    response = iam.create_policy(
        PolicyName=policy_name,
        PolicyDocument=json.dumps(policy_doc),
        Description="Bedrock quota sharing permissions",
    )
    return response["Policy"]["Arn"], True


def _update_policy_if_changed(iam, policy_arn: str, desired_doc: dict) -> None:
    """Compare current policy version to desired and create a new version if changed."""
    # Get the current default version's document
    policy = iam.get_policy(PolicyArn=policy_arn)
    default_version_id = policy["Policy"]["DefaultVersionId"]
    current_version = iam.get_policy_version(
        PolicyArn=policy_arn, VersionId=default_version_id
    )
    current_doc = current_version["PolicyVersion"]["Document"]

    desired_sorted = json.dumps(desired_doc, sort_keys=True)
    current_sorted = json.dumps(current_doc, sort_keys=True)

    if current_sorted == desired_sorted:
        logger.info("Policy document unchanged, no update needed")
        return

    logger.info("Policy document changed, creating new version")

    # IAM allows max 5 policy versions -- delete non-default versions to make room
    versions = iam.list_policy_versions(PolicyArn=policy_arn)
    non_default = [v for v in versions["Versions"] if not v["IsDefaultVersion"]]
    for v in non_default:
        logger.info(f"Deleting old policy version {v['VersionId']}")
        iam.delete_policy_version(PolicyArn=policy_arn, VersionId=v["VersionId"])

    iam.create_policy_version(
        PolicyArn=policy_arn,
        PolicyDocument=json.dumps(desired_doc),
        SetAsDefault=True,
    )
    logger.info("Policy updated with new default version")


def _ensure_policy_attached(iam, role_name: str, policy_arn: str) -> None:
    """Attach policy to role if not already attached."""
    try:
        attached = iam.list_attached_role_policies(RoleName=role_name)
        if any(p["PolicyArn"] == policy_arn for p in attached["AttachedPolicies"]):
            logger.info("Policy already attached to role")
            return
    except ClientError:
        pass

    logger.info("Attaching policy to role")
    iam.attach_role_policy(RoleName=role_name, PolicyArn=policy_arn)
