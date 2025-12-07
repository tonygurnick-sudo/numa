"""
AWS Partner Revenue Measurement (PRM) Helper

This module provides utilities for adding AWS Partner Revenue Measurement
tracking to all AWS SDK clients used in Numa.

The PRM User-Agent string is added to all boto3 client instantiations to
enable AWS to track usage and attribute revenue to the Arcanum Numa product.

Usage:
    from prm import client, resource

    # Create a boto3 client with PRM User-Agent
    s3 = client("s3")
    bedrock = client("bedrock-runtime", region="us-east-1")

    # Create a boto3 resource with PRM User-Agent
    dynamodb = resource("dynamodb")
"""

from typing import Any

import boto3
from botocore.config import Config

# AWS Marketplace Product Code for Arcanum Numa
PRODUCT_CODE = "cl23v3vsno0k35czlg7e3ld9p"

# Partner Revenue Measurement User-Agent string
# Format: APN/1.1 (<product-code>)
PRM_UA = f"APN/1.1 ({PRODUCT_CODE})"

# Botocore configuration with PRM User-Agent
_prm_config = Config(user_agent_extra=PRM_UA)


def client(service_name: str, region: str | None = None, **kwargs) -> Any:
    """
    Create a boto3 client with PRM User-Agent tracking.

    Args:
        service_name: AWS service name (e.g., "s3", "bedrock-runtime", "dynamodb")
        region: AWS region. Defaults to boto3's standard resolution (env/config/metadata).
        **kwargs: Additional arguments to pass to boto3.client()

    Returns:
        boto3 client with PRM User-Agent configured

    Example:
        >>> from prm import client
        >>> s3 = client("s3", region="us-west-2")
        >>> bedrock = client("bedrock-runtime")
    """
    # Merge provided config with PRM config
    provided_config = kwargs.pop("config", None)
    if provided_config:
        # If caller provides a config, merge it with PRM config
        # PRM user_agent_extra takes precedence
        kwargs["config"] = provided_config.merge(_prm_config)
    else:
        kwargs["config"] = _prm_config

    return boto3.client(service_name, region_name=region, **kwargs)


def resource(service_name: str, region: str | None = None, **kwargs) -> Any:
    """
    Create a boto3 resource with PRM User-Agent tracking.

    Args:
        service_name: AWS service name (e.g., "s3", "dynamodb")
        region: AWS region. Defaults to boto3's standard resolution (env/config/metadata).
        **kwargs: Additional arguments to pass to boto3.resource()

    Returns:
        boto3 resource with PRM User-Agent configured

    Example:
        >>> from prm import resource
        >>> dynamodb = resource("dynamodb")
        >>> s3 = resource("s3", region="us-west-2")
    """
    # Merge provided config with PRM config
    provided_config = kwargs.pop("config", None)
    if provided_config:
        # If caller provides a config, merge it with PRM config
        # PRM user_agent_extra takes precedence
        kwargs["config"] = provided_config.merge(_prm_config)
    else:
        kwargs["config"] = _prm_config

    return boto3.resource(service_name, region_name=region, **kwargs)
