#!/usr/bin/env python3
"""
Credential utilities for Numa workspace tools.

Provides boto3 clients using local account credentials (NUMA_LOCAL_*)
for Lambda/S3 operations while cross-account Bedrock credentials are active.

When cross-account Bedrock is configured, the SDK subprocess has AWS_ACCESS_KEY_ID
etc. set to cross-account credentials. This causes default boto3 clients to use
the wrong account for Lambda/S3 calls that should stay in the local account.

Solution: sdk_config.py captures local credentials as NUMA_LOCAL_AWS_* env vars
BEFORE assuming the cross-account role. Tools use these helpers to explicitly
create clients with local credentials.
"""

import os

import boto3


def get_local_session() -> boto3.Session:
    """
    Get a boto3 Session using local account credentials.

    Uses NUMA_LOCAL_AWS_* env vars if set (cross-account mode),
    otherwise falls back to default credentials (single-account mode).
    """
    access_key = os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY")
    session_token = os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN")
    region = os.environ.get("AWS_REGION", "us-east-1")

    if access_key and secret_key:
        # Cross-account mode: use explicit local credentials
        return boto3.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            aws_session_token=session_token,
            region_name=region,
        )
    # Single-account mode: use default credentials (no cross-account override)
    return boto3.Session(region_name=region)


def get_local_lambda_client():
    """Get a Lambda client using local account credentials."""
    return get_local_session().client("lambda")


def get_local_s3_client():
    """Get an S3 client using local account credentials."""
    return get_local_session().client("s3")
