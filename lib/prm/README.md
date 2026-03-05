# AWS Partner Revenue Measurement (PRM) Helper

This library provides utilities for adding AWS Partner Revenue Measurement tracking to all AWS SDK clients used in Numa.

## Purpose

The PRM User-Agent string is added to all boto3 client instantiations to enable AWS to track usage and attribute revenue to the Arcanum Numa product in the AWS Marketplace.

## Usage

### Import the helper

```python
from prm import client, resource
```

### Create boto3 clients with PRM tracking

```python
# Create a boto3 client with PRM User-Agent
s3 = client("s3")
bedrock = client("bedrock-runtime", region="us-east-1")

# Create a boto3 resource with PRM User-Agent
dynamodb = resource("dynamodb")
```

### Replace existing boto3 calls

**Before:**

```python
import boto3
s3 = boto3.client("s3", region_name="us-east-1")
```

**After:**

```python
from prm import client
s3 = client("s3", region="us-east-1")
```

## Configuration

The product code is defined in `prm.py`:

```python
PRODUCT_CODE = "cl23v3vsno0k35czlg7e3ld9p"
```

Update this with the actual AWS Marketplace product code once available.

## How it works

The helper module creates a `botocore.config.Config` object with the `user_agent_extra` parameter set to the PRM User-Agent string in the format `APN/1.1 (<product-code>)`. This configuration is automatically applied to all clients and resources created through the helper functions.

The User-Agent string appears in CloudTrail logs and enables AWS to track API usage for Partner Revenue Measurement.
