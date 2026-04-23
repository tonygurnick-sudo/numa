"""Environment-driven configuration for the KB manager Lambda."""

from __future__ import annotations

import os

REGION = os.environ.get("AWS_REGION", "us-east-1")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")

# Cognito (JWT validation + user lookups)
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID")
USER_POOL_CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID")

# CloudFront-injected shared secret used to gate the public Function URL
CF_SHARED_SECRET = os.environ.get("CLOUDFRONT_SHARED_SECRET")

# Knowledge Base backends
PREFERRED_KNOWLEDGE_BASE = os.environ.get("PREFERRED_KNOWLEDGE_BASE", "bedrock").lower()
BEDROCK_KNOWLEDGE_BASE_ID = os.environ.get("BEDROCK_KNOWLEDGE_BASE_ID")
Q_APPLICATION_ID = os.environ.get("Q_APPLICATION_ID")
Q_INDEX_ID = os.environ.get("Q_INDEX_ID")

# Web crawler stats (optional — enriches GET /api/kb/{id}/state when present)
CRAWL_URLS_TABLE_NAME = os.environ.get("CRAWL_URLS_TABLE_NAME")

# S3 data bucket holding the indexed documents
DATA_BUCKET = f"numa-{CLIENT_NAME}-data" if CLIENT_NAME else ""
