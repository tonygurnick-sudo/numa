"""Cross-account Bedrock session utility for claude-code-agent."""

import os
from typing import Optional, TypedDict

import boto3
import structlog

logger = structlog.get_logger()


class BedrockCredentials(TypedDict):
    """AWS credential environment variables for cross-account Bedrock access."""

    AWS_ACCESS_KEY_ID: str
    AWS_SECRET_ACCESS_KEY: str
    AWS_SESSION_TOKEN: str


def get_cross_account_bedrock_credentials() -> Optional[BedrockCredentials]:
    """Get temporary credentials for cross-account Bedrock access.

    If BEDROCK_ACCOUNT is set, assumes the bedrock-quota-sharing role
    and returns credentials to inject into subprocess environment.

    Returns:
        Dict with AWS credential env vars, or None to use default credentials.
    """
    bedrock_account = os.environ.get("BEDROCK_ACCOUNT")
    if not bedrock_account:
        return None

    region = os.environ.get("AWS_REGION", "us-east-1")

    try:
        sts = boto3.client("sts", region_name=region)
        response = sts.assume_role(
            RoleArn=f"arn:aws:iam::{bedrock_account}:role/bedrock-quota-sharing",
            RoleSessionName="claude-code-agent",
        )
        credentials = response["Credentials"]

        logger.info(
            "Assumed cross-account role for Bedrock",
            bedrock_account=bedrock_account,
        )

        return {
            "AWS_ACCESS_KEY_ID": credentials["AccessKeyId"],
            "AWS_SECRET_ACCESS_KEY": credentials["SecretAccessKey"],
            "AWS_SESSION_TOKEN": credentials["SessionToken"],
        }
    except Exception as e:
        logger.error(
            "Failed to assume cross-account role, using default credentials",
            bedrock_account=bedrock_account,
            error=str(e),
        )
        return None
