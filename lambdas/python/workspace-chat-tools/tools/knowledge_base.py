"""
Unified Knowledge Base tools for workspace agent.

Provides all KB operations:
- query: Search KBs with AI summarization
- upload: Add files to knowledge bases
- download: Download files from KB storage
- list: List files in a KB
- download_folder: Download folder as zip

Security:
- All operations validate kb_id against allowed_kbs list (fail-closed)
- Server-side DynamoDB permission verification
- Company KB uploads require admin role
- User KB uploads require editor/owner access
"""

import base64
import fnmatch
import io
import json
import os
import re
import time
import uuid as uuid_mod
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import structlog

from prm import client as prm_client
from tools.kb_permissions import _get_dynamodb_client, verify_kb_access

from .approval import create_approval_request, poll_approval

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")
USER_POOL_ID = os.getenv("USER_POOL_ID", "")
PREFERRED_KNOWLEDGE_BASE = os.getenv("PREFERRED_KNOWLEDGE_BASE", "bedrock").lower()
QB_APPLICATION_ID = os.getenv("Q_APPLICATION_ID")
QB_RETRIEVER_ID = os.getenv("Q_RETRIEVER_ID")
BEDROCK_KNOWLEDGE_BASE_ID = os.getenv("BEDROCK_KNOWLEDGE_BASE_ID")
FAST_MODEL_ID = os.getenv("FAST_MODEL_ID", "global.amazon.nova-2-lite-v1:0")
SYSTEM_KB_IDS = {"company", "numa-support"}
MAX_KB_ID_LENGTH = 128
MAX_FILENAME_LENGTH = 255
MAX_RELATIVE_PATH_LENGTH = 1024

# Threshold for switching from inline base64 to presigned URL.
# Lambda response payload limit is 6 MB; base64 adds ~33% overhead.
# 3.5 MB raw -> ~4.67 MB base64 -> safely under 6 MB with JSON wrapper.
PRESIGNED_URL_THRESHOLD = 3.5 * 1024 * 1024  # 3.5 MB
PRESIGNED_URL_EXPIRY = 300  # 5 minutes


# =============================================================================
# QUERY OPERATIONS
# =============================================================================


def handle_query_knowledgebase(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle query_knowledgebase tool invocation.

    Parameters:
        query (str, required): Natural language search query
        user_intent (str, required): What the user is trying to accomplish
        max_results (int, default=6, max=15): Number of results
        kb_id (str, default="company"): KB to query - "company" or user KB UUID
        summarise_results (bool, default=True): When true, summarize using Nova Lite
        all_kbs (bool, default=False): Query all enabled KBs and synthesize results
        __allowed_kbs (list, internal): Allowed KB IDs passed from handler for defense in depth
        __allowed_kbs_with_names (list, internal): Full KB objects with id and name for attribution

    Returns:
        Dict with summarised_content or raw_content, references, provider, etc.

    Raises:
        ValueError: If required parameters are missing or invalid
    """
    # Extract and validate parameters
    query = params.get("query")
    user_intent = params.get("user_intent")

    if not query:
        raise ValueError("Missing required parameter: query")
    if not user_intent:
        raise ValueError("Missing required parameter: user_intent")

    max_results = min(max(1, params.get("max_results", 6)), 15)
    kb_id = (params.get("kb_id") or "company").strip() or "company"
    summarise_results = params.get("summarise_results", True)
    all_kbs = params.get("all_kbs", False)

    # Get allowed KB lists for validation and attribution
    allowed_kbs = params.get("__allowed_kbs")
    allowed_kbs_with_names = params.get("__allowed_kbs_with_names", [])

    # Handle all_kbs mode: query all enabled KBs
    if all_kbs:
        return _handle_all_kbs_query(
            query=query,
            user_intent=user_intent,
            max_results=max_results,
            summarise_results=summarise_results,
            allowed_kbs_with_names=allowed_kbs_with_names,
        )

    # Single KB mode: validate KB access
    if allowed_kbs is not None and kb_id not in allowed_kbs:
        raise ValueError(f"Access denied: KB '{kb_id}' not in allowed list")

    logger.info(
        "Querying knowledge base",
        query=query[:100],
        kb_id=kb_id,
        max_results=max_results,
        summarise_results=summarise_results,
        preferred_provider=PREFERRED_KNOWLEDGE_BASE,
    )

    # Query single KB
    kb_result = _query_single_kb(query, max_results, kb_id)

    # Combine content
    all_content = "\n\n".join(kb_result["content_pieces"])
    refs = kb_result["references"]

    # Summarize if requested and we have content
    if summarise_results and all_content and user_intent:
        summarised = _summarize_content(all_content, user_intent, len(refs))
        if summarised:
            return {
                "summarised_content": summarised,
                "references": refs,
                "provider": kb_result["provider"],
                "query": query,
                "results_count": len(refs),
            }

    # Return raw content (fallback or when summarise_results=False)
    return {
        "raw_content": kb_result["content_pieces"],
        "references": refs,
        "provider": kb_result["provider"],
        "query": query,
        "results_count": len(refs),
    }


def _query_single_kb(query: str, max_results: int, kb_id: str) -> Dict[str, Any]:
    """Query a single knowledge base (Q Business or Bedrock)."""
    # Determine which backend to use
    # User KBs (non-company) MUST use Bedrock (Q Business doesn't support metadata filtering)
    provider = PREFERRED_KNOWLEDGE_BASE
    if kb_id != "company" and provider == "q":
        if BEDROCK_KNOWLEDGE_BASE_ID:
            logger.info("Using Bedrock for user KB (Q doesn't support kb isolation)")
            provider = "bedrock"
        else:
            raise ValueError("User KBs require Bedrock KB which is not configured")

    # Query the appropriate backend
    if provider == "q" and QB_APPLICATION_ID and QB_RETRIEVER_ID:
        return _query_qbusiness(query, max_results)
    elif provider == "bedrock" and BEDROCK_KNOWLEDGE_BASE_ID:
        return _query_bedrock(query, max_results, kb_id)
    else:
        raise ValueError(f"Knowledge base provider '{provider}' not configured")


def _handle_all_kbs_query(
    query: str,
    user_intent: str,
    max_results: int,
    summarise_results: bool,
    allowed_kbs_with_names: List[Dict[str, str]],
) -> Dict[str, Any]:
    """
    Query all enabled KBs sequentially and synthesize results.

    Args:
        query: Search query
        user_intent: User's intent for summarization
        max_results: Max results per KB
        summarise_results: Whether to summarize
        allowed_kbs_with_names: List of {id, name} objects for enabled KBs

    Returns:
        Combined results with KB attribution
    """
    if not allowed_kbs_with_names:
        raise ValueError("No knowledge bases enabled for --all-kbs query")

    logger.info(
        "Starting multi-KB query",
        query=query[:100],
        kb_count=len(allowed_kbs_with_names),
        kbs=[kb.get("id") for kb in allowed_kbs_with_names],
    )

    # Query each KB sequentially
    all_kb_results: List[Dict[str, Any]] = []
    total_results_count = 0

    for kb in allowed_kbs_with_names:
        kb_id = kb.get("id", "unknown")
        kb_name = kb.get("name", kb_id)

        try:
            logger.info("Querying KB", kb_id=kb_id, kb_name=kb_name)
            kb_result = _query_single_kb(query, max_results, kb_id)

            # Add KB attribution to each content piece
            attributed_content = []
            for content_piece in kb_result.get("content_pieces", []):
                attributed_content.append(f"[KB: {kb_name}]\n{content_piece}")

            all_kb_results.append(
                {
                    "kb_id": kb_id,
                    "kb_name": kb_name,
                    "content_pieces": attributed_content,
                    "references": kb_result.get("references", []),
                    "provider": kb_result.get("provider", "unknown"),
                    "results_count": len(kb_result.get("references", [])),
                }
            )
            total_results_count += len(kb_result.get("references", []))

        except Exception as e:
            logger.warning(
                "Failed to query KB",
                kb_id=kb_id,
                kb_name=kb_name,
                error=str(e),
            )
            all_kb_results.append(
                {
                    "kb_id": kb_id,
                    "kb_name": kb_name,
                    "content_pieces": [],
                    "references": [],
                    "provider": "error",
                    "results_count": 0,
                    "error": str(e),
                }
            )

    # Build per-KB references for response
    per_kb_references = [
        {
            "kb_id": result["kb_id"],
            "kb_name": result["kb_name"],
            "sources": result["references"],
        }
        for result in all_kb_results
        if result["references"]  # Only include KBs with results
    ]

    # Combine all content with attribution
    all_content_pieces = []
    for result in all_kb_results:
        all_content_pieces.extend(result.get("content_pieces", []))

    kbs_queried = [kb.get("id") for kb in allowed_kbs_with_names]

    # If no content found across any KB
    if not all_content_pieces:
        return {
            "raw_content": [],
            "references": per_kb_references,
            "kbs_queried": kbs_queried,
            "total_results_count": 0,
            "query": query,
        }

    # Summarize if requested
    if summarise_results and all_content_pieces and user_intent:
        all_content = "\n\n".join(all_content_pieces)
        summarised = _summarize_multi_kb_content(
            all_content, user_intent, total_results_count, allowed_kbs_with_names
        )
        if summarised:
            return {
                "summarised_content": summarised,
                "references": per_kb_references,
                "kbs_queried": kbs_queried,
                "total_results_count": total_results_count,
                "query": query,
            }

    # Return raw content grouped by KB
    return {
        "raw_content": all_content_pieces,
        "references": per_kb_references,
        "kbs_queried": kbs_queried,
        "total_results_count": total_results_count,
        "query": query,
    }


def _query_qbusiness(query: str, max_results: int) -> Dict[str, Any]:
    """Query Q Business knowledge base."""
    start_time = time.time()
    logger.info(
        "Starting Q Business query",
        app_id=QB_APPLICATION_ID,
        retriever_id=QB_RETRIEVER_ID,
        query_length=len(query),
        max_results=max_results,
    )

    qb_client = prm_client("qbusiness", region=REGION)

    resp = qb_client.search_relevant_content(
        applicationId=QB_APPLICATION_ID,
        queryText=query,
        contentSource={"retriever": {"retrieverId": QB_RETRIEVER_ID}},
        maxResults=max_results,
    )

    elapsed_ms = (time.time() - start_time) * 1000
    items = resp.get("relevantContent", [])
    logger.info(
        "Q Business search completed",
        results_count=len(items),
        max_results=max_results,
        elapsed_ms=round(elapsed_ms, 2),
    )

    content_pieces: List[str] = []
    refs: List[str] = []

    for item in items:
        if item.get("content"):
            doc_uri = item.get("documentUri", "Unknown source")
            content = item.get("content", "")
            content_pieces.append(f"Source: {doc_uri}\n{content}")
            refs.append(doc_uri)

    return {
        "content_pieces": content_pieces,
        "references": refs,
        "provider": "q_business",
    }


def _query_bedrock(query: str, max_results: int, kb_id: str) -> Dict[str, Any]:
    """Query Bedrock knowledge base with metadata filtering."""
    start_time = time.time()
    logger.info(
        "Starting Bedrock KB query",
        bedrock_kb_id=BEDROCK_KNOWLEDGE_BASE_ID,
        filter_kb_id=kb_id,
        query_length=len(query),
        max_results=max_results,
    )

    kb_client = prm_client("bedrock-agent-runtime", region=REGION)

    # Build retrieval configuration with metadata filtering
    retrieval_config: Dict[str, Any] = {
        "vectorSearchConfiguration": {"numberOfResults": max_results}
    }

    # Add metadata filter for tenant and KB isolation
    if CLIENT_NAME and kb_id:
        retrieval_config["vectorSearchConfiguration"]["filter"] = {
            "andAll": [
                {"equals": {"key": "tenant_id", "value": CLIENT_NAME}},
                {"equals": {"key": "kb_id", "value": kb_id}},
            ]
        }
        logger.info(
            "Applied metadata filter",
            tenant_id=CLIENT_NAME,
            kb_id=kb_id,
        )

    # Query Bedrock knowledge base
    resp = kb_client.retrieve(
        knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID,
        retrievalQuery={"text": query},
        retrievalConfiguration=retrieval_config,
    )
    # Strict separation: Do not retry without metadata filter
    # If no results with the applied filter, return empty to avoid cross-KB leakage

    elapsed_ms = (time.time() - start_time) * 1000
    items = resp.get("retrievalResults", [])
    logger.info(
        "Bedrock KB search completed",
        results_count=len(items),
        max_results=max_results,
        elapsed_ms=round(elapsed_ms, 2),
    )

    content_pieces: List[str] = []
    refs: List[str] = []

    for item in items:
        if item.get("content"):
            source_uri = _extract_bedrock_uri(item.get("location"))
            content = item.get("content", {}).get("text", "")
            content_pieces.append(f"Source: {source_uri}\n{content}")
            refs.append(source_uri)

    return {
        "content_pieces": content_pieces,
        "references": refs,
        "provider": "bedrock",
    }


def _extract_bedrock_uri(location: Dict[str, Any] | None) -> str:
    """Extract URI from Bedrock knowledge base location object."""
    if not location:
        return "N/A"
    return (
        location.get("s3Location", {}).get("uri")
        or location.get("webLocation", {}).get("url")
        or "N/A"
    )


def _summarize_content(all_content: str, user_intent: str, num_sources: int) -> str:
    """Summarize KB content using Nova Lite (fast, cost-effective model)."""
    start_time = time.time()
    logger.info(
        "Starting content summarization",
        model_id=FAST_MODEL_ID,
        content_length=len(all_content),
        num_sources=num_sources,
        user_intent_preview=user_intent[:100] if user_intent else None,
    )

    bedrock_client = prm_client("bedrock-runtime", region=REGION)

    prompt = f"""You are summarizing internal knowledge base content for a user query.

USER INTENT: {user_intent}

TASK: Create a comprehensive but concise summary of the following content from {num_sources} knowledge base sources. Focus on information directly relevant to the user's intent.

GUIDELINES:
1. Synthesize information from all sources into a coherent narrative
2. Retain ALL specific facts, numbers, dates, and precise details
3. Preserve technical terms and proper nouns exactly
4. Focus on content directly relevant to the user's intent
5. If multiple sources provide conflicting information, note the discrepancies
6. Organize information logically (e.g., by topic, chronology, importance)
7. Keep the summary detailed enough that no critical information is lost

KNOWLEDGE BASE CONTENT:
{all_content[:15000]}

Provide a comprehensive summary:"""

    try:
        response = bedrock_client.converse(
            modelId=FAST_MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 10000, "temperature": 0.1},
            additionalModelRequestFields={
                "reasoningConfig": {
                    "type": "enabled",
                    "maxReasoningEffort": "medium",
                }
            },
        )

        elapsed_ms = (time.time() - start_time) * 1000
        content = response.get("output", {}).get("message", {}).get("content", [])
        for item in content:
            if "text" in item:
                logger.info(
                    "Content summarization completed",
                    original_length=len(all_content),
                    summary_length=len(item["text"]),
                    elapsed_ms=round(elapsed_ms, 2),
                    model_id=FAST_MODEL_ID,
                )
                return item["text"].strip()
        logger.warning(
            "Summarization returned no text content", elapsed_ms=round(elapsed_ms, 2)
        )
        return ""
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "Summarization failed",
            error=str(e),
            elapsed_ms=round(elapsed_ms, 2),
            exc_info=True,
        )
        return ""


def _summarize_multi_kb_content(
    all_content: str,
    user_intent: str,
    num_sources: int,
    kbs_with_names: List[Dict[str, str]],
) -> str:
    """
    Summarize content from multiple KBs with attribution.

    Uses Nova 2 Lite with medium reasoning effort (same as single-KB summarization).

    Args:
        all_content: Combined content from all KBs (already has [KB: name] attribution)
        user_intent: User's intent
        num_sources: Total number of sources across all KBs
        kbs_with_names: List of {id, name} for all queried KBs

    Returns:
        Summarized content with KB attribution
    """
    start_time = time.time()
    kb_names = ", ".join(
        [kb.get("name", kb.get("id", "Unknown")) for kb in kbs_with_names]
    )

    logger.info(
        "Starting multi-KB content summarization",
        model_id=FAST_MODEL_ID,
        content_length=len(all_content),
        num_sources=num_sources,
        kb_count=len(kbs_with_names),
        kb_names=kb_names,
        user_intent_preview=user_intent[:100] if user_intent else None,
    )

    bedrock_client = prm_client("bedrock-runtime", region=REGION)

    prompt = f"""You are summarizing search results from multiple knowledge bases.
When presenting information, always attribute which knowledge base it came from.

USER'S INTENT: {user_intent}

KNOWLEDGE BASES QUERIED: {kb_names}

TASK: Create a comprehensive summary of the following content from {num_sources} sources across {len(kbs_with_names)} knowledge bases. The content is already tagged with [KB: name] markers.

GUIDELINES:
1. Address the user's intent directly
2. Clearly attribute each piece of information to its source KB (e.g., "According to [Company KB]...", "The [HR Docs] knowledge base states...")
3. Highlight any differences or complementary information across KBs
4. Retain ALL specific facts, numbers, dates, and precise details
5. Preserve technical terms and proper nouns exactly
6. Organize information logically (e.g., by topic, then by KB source)
7. If KBs provide conflicting information, note the discrepancies with their sources

KNOWLEDGE BASE CONTENT:
{all_content[:15000]}

Provide a comprehensive summary with clear KB attribution:"""

    try:
        response = bedrock_client.converse(
            modelId=FAST_MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 10000, "temperature": 0.1},
            additionalModelRequestFields={
                "reasoningConfig": {
                    "type": "enabled",
                    "maxReasoningEffort": "medium",
                }
            },
        )

        elapsed_ms = (time.time() - start_time) * 1000
        content = response.get("output", {}).get("message", {}).get("content", [])
        for item in content:
            if "text" in item:
                logger.info(
                    "Multi-KB summarization completed",
                    original_length=len(all_content),
                    summary_length=len(item["text"]),
                    elapsed_ms=round(elapsed_ms, 2),
                    model_id=FAST_MODEL_ID,
                    kb_count=len(kbs_with_names),
                )
                return item["text"].strip()
        logger.warning(
            "Multi-KB summarization returned no text content",
            elapsed_ms=round(elapsed_ms, 2),
        )
        return ""
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "Multi-KB summarization failed",
            error=str(e),
            elapsed_ms=round(elapsed_ms, 2),
            exc_info=True,
        )
        return ""


# =============================================================================
# UPLOAD OPERATIONS
# =============================================================================


def is_user_admin(user_sub: str) -> bool:
    """
    Check if user is in the 'admin' Cognito group.

    Uses AdminListGroupsForUser API with the user's sub (UUID).

    Args:
        user_sub: User's Cognito sub (UUID)

    Returns:
        True if user is in 'admin' group, False otherwise
    """
    if not user_sub or not USER_POOL_ID:
        logger.warning(
            "Cannot check admin status - missing context",
            has_user_sub=bool(user_sub),
            has_user_pool_id=bool(USER_POOL_ID),
        )
        return False

    try:
        cognito_client = prm_client("cognito-idp", region=REGION)
        response = cognito_client.admin_list_groups_for_user(
            UserPoolId=USER_POOL_ID,
            Username=user_sub,  # Sub (UUID) is accepted as Username
        )
        groups = [g["GroupName"] for g in response.get("Groups", [])]
        is_admin = "admin" in groups

        logger.info(
            "Admin check completed",
            user_sub=user_sub[:8] + "...",
            is_admin=is_admin,
            groups=groups,
        )

        return is_admin
    except Exception as e:
        logger.error(
            "Failed to check admin status",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        return False  # Fail closed


def verify_kb_write_access(user_sub: str, kb_id: str) -> bool:
    """
    Check if user has EDITOR/OWNER access to KB (required for uploads).

    Args:
        user_sub: User's Cognito sub (UUID)
        kb_id: Knowledge base ID

    Returns:
        True if user can write to the KB, False otherwise
    """
    # Numa Support KB is read-only and managed by the CS portal.
    if kb_id == "numa-support":
        return False

    # Company KB: only admins can upload (check Cognito group)
    if kb_id == "company":
        return is_user_admin(user_sub)

    # For user KBs, check if user is editor or creator
    table_name = f"numa-{CLIENT_NAME}-knowledge-bases"
    dynamodb = _get_dynamodb_client()

    try:
        response = dynamodb.get_item(
            TableName=table_name,
            Key={
                "PK": {"S": f"TENANT#{CLIENT_NAME}"},
                "SK": {"S": f"KB#{kb_id}"},
            },
            ProjectionExpression="editors, created_by",
        )

        if "Item" not in response:
            logger.warning("KB not found for write access check", kb_id=kb_id)
            return False

        item = response["Item"]
        editors_attr = item.get("editors", {})
        if "SS" in editors_attr:
            editors = list(editors_attr.get("SS", []))
        else:
            editors = [
                editor.get("S", "")
                for editor in editors_attr.get("L", [])
                if isinstance(editor, dict) and editor.get("S")
            ]
        created_by = item.get("created_by", {}).get("S", "")

        has_access = user_sub in editors or user_sub == created_by

        logger.info(
            "KB write access check completed",
            kb_id=kb_id,
            user_sub=user_sub[:8] + "...",
            has_access=has_access,
            is_editor=user_sub in editors,
            is_creator=user_sub == created_by,
        )

        return has_access
    except Exception as e:
        logger.error(
            "KB write access check failed",
            kb_id=kb_id,
            error=str(e),
            exc_info=True,
        )
        return False  # Fail closed


def _contains_control_chars(value: str) -> bool:
    """Check whether a string contains ASCII control characters."""
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


def _validate_kb_id(kb_id: Any, field_name: str = "kb_id") -> str:
    """
    Validate a KB ID used for permissions and S3 path construction.

    KB IDs are expected to be system IDs ("company", "numa-support")
    or UUID-like identifiers. We reject separators and traversal tokens.
    """
    if not isinstance(kb_id, str):
        raise ValueError(f"{field_name} must be a string")

    normalized = kb_id.strip()
    if not normalized:
        raise ValueError(f"{field_name} cannot be empty")

    if len(normalized) > MAX_KB_ID_LENGTH:
        raise ValueError(f"{field_name} is too long")

    if "/" in normalized or "\\" in normalized or ".." in normalized:
        raise ValueError(f"Invalid {field_name}: path separators are not allowed")

    if _contains_control_chars(normalized):
        raise ValueError(f"Invalid {field_name}: contains control characters")

    if not re.fullmatch(r"[A-Za-z0-9_-]+", normalized):
        raise ValueError(
            f"Invalid {field_name}: only letters, numbers, '-' and '_' are allowed"
        )

    return normalized


def _validate_filename(filename: Any, field_name: str = "filename") -> str:
    """Validate a single file name (no path segments)."""
    if not isinstance(filename, str):
        raise ValueError(f"{field_name} must be a string")

    normalized = filename.strip()
    if not normalized:
        raise ValueError(f"{field_name} cannot be empty")

    if len(normalized) > MAX_FILENAME_LENGTH:
        raise ValueError(f"{field_name} is too long")

    if "/" in normalized or "\\" in normalized:
        raise ValueError(f"Invalid {field_name}: path separators are not allowed")

    if normalized in {".", ".."}:
        raise ValueError(f"Invalid {field_name}")

    if normalized.endswith(".metadata.json"):
        raise ValueError(
            f"Invalid {field_name}: metadata sidecar files are not allowed"
        )

    if _contains_control_chars(normalized):
        raise ValueError(f"Invalid {field_name}: contains control characters")

    return normalized


def _validate_relative_path(
    path_value: Any,
    field_name: str,
    *,
    allow_empty: bool = True,
) -> str:
    """
    Validate and normalize a relative S3 path.

    This allows nested folders but blocks traversal and unsafe characters.
    """
    if path_value is None:
        if allow_empty:
            return ""
        raise ValueError(f"{field_name} cannot be empty")

    if not isinstance(path_value, str):
        raise ValueError(f"{field_name} must be a string")

    trimmed = path_value.strip().strip("/")
    if not trimmed:
        if allow_empty:
            return ""
        raise ValueError(f"{field_name} cannot be empty")

    if len(trimmed) > MAX_RELATIVE_PATH_LENGTH:
        raise ValueError(f"{field_name} is too long")

    if "\\" in trimmed:
        raise ValueError(f"Invalid {field_name}: backslashes are not allowed")

    if _contains_control_chars(trimmed):
        raise ValueError(f"Invalid {field_name}: contains control characters")

    parts = trimmed.split("/")
    normalized_parts: List[str] = []
    for part in parts:
        if part in {"", ".", ".."}:
            raise ValueError(f"Invalid {field_name}: path traversal is not allowed")
        normalized_parts.append(part)

    return "/".join(normalized_parts)


def _require_user_sub(params: Dict[str, Any], operation: str) -> str:
    """
    Require authenticated user context for KB operations.

    All KB file operations must enforce server-side permission checks.
    """
    user_sub = params.get("__user_sub", "")
    if not isinstance(user_sub, str) or not user_sub.strip():
        logger.warning(
            "KB operation denied - missing user identity",
            operation=operation,
        )
        raise ValueError("Access denied: User identity required for KB operations")
    return user_sub.strip()


def handle_add_to_kb(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Upload file to knowledge base S3 storage.

    Parameters:
        filename (str): Name of the file
        kb_id (str): Knowledge base ID (default: "company")
        kb_path (str): Path within KB (default: root)
        content_base64 (str): Base64-encoded file content
        size_bytes (int): Original file size
        __allowed_kbs (list): Allowed KB IDs for security
        __user_sub (str): User's Cognito sub for permission check

    Returns:
        Dict with message, s3_uri, kb_id, filename, size_bytes, and note
    """
    # HITL approval gate
    request_id = params.get("request_id")
    if request_id and not params.get("auto_approved", False):
        user_sub = params.get("__user_sub", "")
        approval_id = create_approval_request(
            user_sub=user_sub,
            action_key="numa_knowledgeBases_upload",
            description=f"Upload to KB: {params.get('filename', 'unknown')}",
            props_preview={
                "filename": params.get("filename", ""),
                "kb_id": params.get("kb_id", "company"),
            },
            approval_id=request_id,
        )
        decision, deny_reason = poll_approval(approval_id)
        if decision == "denied":
            msg = deny_reason or "User denied this action"
            return {"status": "denied", "message": msg, "deny_reason": deny_reason}
        if decision == "timeout":
            return {"status": "timeout", "message": "Approval timed out"}

    filename = _validate_filename(params.get("filename"), "filename")
    kb_id = _validate_kb_id(params.get("kb_id", "company"), "kb_id")
    kb_path = _validate_relative_path(params.get("kb_path", ""), "kb_path")
    content_base64 = params.get("content_base64")
    size_bytes = params.get("size_bytes", 0)
    allowed_kbs = params.get("__allowed_kbs", [])
    user_sub = _require_user_sub(params, "add_to_kb")

    # Validate required params
    if not content_base64:
        raise ValueError("Missing required parameter: content_base64")

    if not DATA_BUCKET_NAME:
        raise ValueError("DATA_BUCKET_NAME not configured")

    # Security: Validate KB access (fail-closed)
    if not allowed_kbs:
        raise ValueError("No knowledge bases are enabled for this conversation")

    if kb_id not in allowed_kbs:
        logger.warning(
            "KB access denied for upload",
            kb_id=kb_id,
            allowed_kbs=allowed_kbs,
        )
        raise ValueError(
            f"Access denied: KB '{kb_id}' is not enabled. Enabled KBs: {allowed_kbs}"
        )

    # Server-side permission check (must have EDITOR access to upload)
    if not verify_kb_write_access(user_sub, kb_id):
        logger.warning(
            "KB write access denied",
            user_sub=user_sub[:8] + "...",
            kb_id=kb_id,
        )
        raise ValueError(
            f"Access denied: You don't have permission to add to this knowledge base '{kb_id}'"
        )

    # Sanitize filename for safe S3 key usage
    safe_filename = filename.replace("\\", "/").replace("..", "")
    safe_filename = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", safe_filename)
    safe_filename = re.sub(r"/+", "/", safe_filename).strip("/")
    if not safe_filename:
        safe_filename = "unnamed_file"

    # Build S3 key - keep system KB ids as-is, prefix user KBs with "kb-".
    prefix_part = _get_s3_kb_id(kb_id)

    if kb_path:
        s3_key = f"documents/{prefix_part}/{kb_path}/{safe_filename}"
    else:
        s3_key = f"documents/{prefix_part}/{safe_filename}"

    # Decode content
    try:
        content = base64.b64decode(content_base64)
    except Exception as e:
        raise ValueError(f"Invalid base64 content: {e}")

    # Upload to S3
    s3_client = prm_client("s3", region=REGION)
    try:
        upload_time = datetime.utcnow().isoformat()

        # Upload the file with metadata
        s3_client.put_object(
            Bucket=DATA_BUCKET_NAME,
            Key=s3_key,
            Body=content,
            Metadata={
                "kb_id": kb_id,
                "uploaded_at": upload_time,
                "tenant_id": CLIENT_NAME,
                "uploader_id": user_sub,
                "source": "workspace-agent",
            },
        )

        # Create metadata sidecar (for KB indexing)
        metadata_key = f"{s3_key}.metadata.json"
        metadata_content = {
            "metadataAttributes": {
                "kb_id": kb_id,
                "uploaded_at": upload_time,
                "tenant_id": CLIENT_NAME,
                "uploader_id": user_sub,
                "source": "workspace-agent",
            }
        }
        s3_client.put_object(
            Bucket=DATA_BUCKET_NAME,
            Key=metadata_key,
            Body=json.dumps(metadata_content).encode("utf-8"),
            ContentType="application/json",
        )

        logger.info(
            "File uploaded to KB",
            filename=filename,
            kb_id=kb_id,
            s3_key=s3_key,
            size_bytes=size_bytes,
            user_sub=user_sub[:8] + "...",
        )

        return {
            "message": f"File '{filename}' uploaded successfully to KB '{kb_id}'",
            "s3_uri": f"s3://{DATA_BUCKET_NAME}/{s3_key}",
            "kb_id": kb_id,
            "filename": filename,
            "size_bytes": size_bytes,
            "note": "The file will be indexed and searchable within ~30 minutes.",
        }

    except Exception as e:
        logger.error(
            "Failed to upload file to KB",
            error=str(e),
            filename=filename,
            kb_id=kb_id,
            exc_info=True,
        )
        raise ValueError(f"Failed to upload file: {e}")


# =============================================================================
# FILE OPERATIONS (download, list, download_folder)
# =============================================================================


def _extract_kb_id_from_uri(uri: str) -> str:
    """
    Extract kb_id from S3 URI path.

    S3 paths follow pattern: s3://bucket/documents/{kb_id}/...
    - Company KB: documents/company/...
    - User KB: documents/kb-{uuid}/...

    Args:
        uri: S3 URI (e.g., s3://numa-client-data/documents/company/policy.pdf)

    Returns:
        kb_id extracted from path (e.g., "company" or "kb-abc123")

    Raises:
        ValueError: If URI doesn't match expected pattern
    """
    try:
        parsed = urlparse(uri)
        if parsed.scheme != "s3":
            raise ValueError(f"Not an S3 URI: {uri}")

        # Path is like /documents/company/subdir/file.pdf
        path = parsed.path.lstrip("/")
        parts = path.split("/")

        if len(parts) < 2:
            raise ValueError(f"Invalid S3 path structure: {path}")

        # Expected: documents/{kb_id}/...
        if parts[0] != "documents":
            raise ValueError(f"Path doesn't start with 'documents/': {path}")

        kb_id = _validate_kb_id(parts[1], "uri kb_id")
        return kb_id

    except Exception as e:
        logger.error("Failed to extract kb_id from URI", uri=uri, error=str(e))
        raise ValueError(f"Invalid KB file URI: {uri}") from e


def _normalize_kb_id(kb_id: str) -> str:
    """
    Normalize KB ID for permission checks (strip 'kb-' prefix).

    DynamoDB and allowed_kbs use plain UUIDs, but S3 paths use 'kb-{uuid}'.
    This function normalizes S3-extracted IDs for permission comparisons.

    Args:
        kb_id: KB ID possibly with 'kb-' prefix

    Returns:
        Normalized KB ID without prefix (e.g., 'company' or plain UUID)
    """
    if kb_id.startswith("kb-"):
        return kb_id[3:]
    return kb_id


def _get_s3_kb_id(kb_id: str) -> str:
    """
    Get S3-compatible KB ID (prepend 'kb-' for non-company KBs).

    S3 paths use 'documents/company/' for company KB
    and 'documents/kb-{uuid}/' for user KBs.

    Args:
        kb_id: KB ID (plain UUID or 'company')

    Returns:
        S3-compatible KB ID with 'kb-' prefix for user KBs
    """
    if kb_id in SYSTEM_KB_IDS:
        return kb_id
    # If already has prefix, return as-is
    if kb_id.startswith("kb-"):
        return kb_id
    # Prepend kb- for user KBs
    return f"kb-{kb_id}"


def _get_s3_prefix(kb_id: str) -> str:
    """
    Get S3 prefix for a knowledge base.

    Args:
        kb_id: Knowledge base ID ("company" or plain UUID)

    Returns:
        S3 prefix (e.g., "documents/company/" or "documents/kb-{uuid}/")
    """
    s3_kb_id = _get_s3_kb_id(kb_id)
    return f"documents/{s3_kb_id}/"


def _validate_download_path(path_value: Any, field_name: str) -> str:
    """Validate a download target path and block metadata sidecar access."""
    normalized = _validate_relative_path(path_value, field_name, allow_empty=False)
    if normalized.endswith(".metadata.json"):
        raise ValueError(
            f"Invalid {field_name}: metadata sidecar files are not allowed"
        )
    return normalized


def _parse_and_validate_uri_key(uri: str, kb_id: str, bucket: str) -> str:
    """
    Parse an S3 URI and ensure it points to the expected KB prefix.

    This prevents cross-KB key access by validating both bucket and prefix.
    """
    parsed = urlparse(uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Not an S3 URI: {uri}")

    if parsed.netloc and parsed.netloc != bucket:
        raise ValueError("Invalid URI bucket for this tenant")

    raw_key = parsed.path.lstrip("/")
    expected_prefix = _get_s3_prefix(kb_id)
    if not raw_key.startswith(expected_prefix):
        raise ValueError("Invalid URI path for the requested knowledge base")

    relative_path = raw_key[len(expected_prefix) :]
    validated_relative_path = _validate_download_path(relative_path, "uri path")
    return f"{expected_prefix}{validated_relative_path}"


def _download_file(bucket: str, key: str) -> Dict[str, Any]:
    """
    Download file from S3.

    For small files (< PRESIGNED_URL_THRESHOLD): returns base64-encoded content inline.
    For large files (>= PRESIGNED_URL_THRESHOLD): returns a presigned S3 GET URL
    so the caller can download directly, bypassing Lambda payload limits.

    Args:
        bucket: S3 bucket name
        key: S3 object key

    Returns:
        Dict with filename, size_bytes, s3_uri, and either content_base64 or presigned_url
    """
    logger.info("Downloading file", bucket=bucket, key=key)

    s3_client = prm_client("s3", region=REGION)
    filename = key.split("/")[-1]

    try:
        # Check file size first with a HEAD request (no data transfer)
        head_response = s3_client.head_object(Bucket=bucket, Key=key)
        file_size = head_response["ContentLength"]

        logger.info(
            "File size determined",
            filename=filename,
            size_bytes=file_size,
            use_presigned_url=file_size >= PRESIGNED_URL_THRESHOLD,
        )

        if file_size >= PRESIGNED_URL_THRESHOLD:
            # Large file: return presigned URL for direct download
            presigned_url = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=PRESIGNED_URL_EXPIRY,
            )

            logger.info(
                "Generated presigned URL for large file",
                filename=filename,
                size_bytes=file_size,
            )

            return {
                "filename": filename,
                "size_bytes": file_size,
                "presigned_url": presigned_url,
                "s3_uri": f"s3://{bucket}/{key}",
            }

        # Small file: return inline base64 (existing behavior)
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read()
        content_base64 = base64.b64encode(content).decode("utf-8")

        logger.info(
            "File downloaded successfully",
            filename=filename,
            size_bytes=len(content),
        )

        return {
            "filename": filename,
            "size_bytes": len(content),
            "content_base64": content_base64,
            "s3_uri": f"s3://{bucket}/{key}",
        }

    except s3_client.exceptions.NoSuchKey:
        logger.warning("File not found", bucket=bucket, key=key)
        raise ValueError(f"File not found: s3://{bucket}/{key}")
    except Exception as e:
        logger.error("Failed to download file", bucket=bucket, key=key, error=str(e))
        raise ValueError(f"Failed to download file: {str(e)}") from e


def _list_files(
    bucket: str, prefix: str, pattern: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    List files in S3 prefix, optionally filtering by pattern.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix to list
        pattern: Optional filename pattern (e.g., "*.pdf")

    Returns:
        List of file info dicts with name, size, last_modified
    """
    logger.info("Listing files", bucket=bucket, prefix=prefix, pattern=pattern)

    s3_client = prm_client("s3", region=REGION)

    files = []
    paginator = s3_client.get_paginator("list_objects_v2")

    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1]

                # Skip empty filenames and metadata sidecars
                if not filename or filename.endswith(".metadata.json"):
                    continue

                # Skip directory markers
                if key.endswith("/"):
                    continue

                # Apply pattern filter if specified
                if pattern and not fnmatch.fnmatch(filename.lower(), pattern.lower()):
                    continue

                files.append(
                    {
                        "name": filename,
                        "key": key,
                        "size": obj["Size"],
                        "last_modified": obj["LastModified"].isoformat(),
                        "s3_uri": f"s3://{bucket}/{key}",
                    }
                )

        logger.info("Files listed successfully", count=len(files))
        return files

    except Exception as e:
        logger.error("Failed to list files", bucket=bucket, prefix=prefix, error=str(e))
        raise ValueError(f"Failed to list files: {str(e)}") from e


def _download_folder(
    bucket: str, prefix: str, folder_name: str, max_files: int = 400
) -> Dict[str, Any]:
    """
    Download all files in a folder as a zip archive.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the folder
        folder_name: Name for the zip file
        max_files: Maximum number of files to include (default 400)

    Returns:
        Dict with filename, size_bytes, content_base64, file_count
    """
    logger.info(
        "Downloading folder as zip",
        bucket=bucket,
        prefix=prefix,
        folder_name=folder_name,
    )

    s3_client = prm_client("s3", region=REGION)

    # List all files in the folder
    files = _list_files(bucket, prefix, pattern=None)

    if not files:
        raise ValueError(f"No files found in folder: {prefix}")

    if len(files) > max_files:
        logger.warning(
            "Folder has too many files, limiting download",
            total_files=len(files),
            max_files=max_files,
        )
        files = files[:max_files]

    # Create zip in memory
    zip_buffer = io.BytesIO()
    downloaded_count = 0
    total_size = 0

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            key = file_info["key"]
            filename = file_info["name"]

            try:
                response = s3_client.get_object(Bucket=bucket, Key=key)
                content = response["Body"].read()

                # Preserve folder structure relative to the prefix
                relative_path = (
                    key[len(prefix) :] if key.startswith(prefix) else filename
                )
                zip_file.writestr(relative_path, content)

                downloaded_count += 1
                total_size += len(content)

                logger.debug(
                    "Added file to zip",
                    filename=filename,
                    relative_path=relative_path,
                    size=len(content),
                )

            except Exception as e:
                logger.warning(
                    "Failed to download file for zip",
                    key=key,
                    error=str(e),
                )
                # Continue with other files

    zip_buffer.seek(0)
    zip_content = zip_buffer.read()
    zip_filename = f"{folder_name}.zip"

    logger.info(
        "Folder downloaded successfully as zip",
        filename=zip_filename,
        file_count=downloaded_count,
        zip_size_bytes=len(zip_content),
        total_uncompressed_size=total_size,
    )

    if len(zip_content) >= PRESIGNED_URL_THRESHOLD:
        # Large zip: upload to S3 temp location and return presigned URL
        temp_key = f"tmp/kb-downloads/{uuid_mod.uuid4()}/{zip_filename}"
        s3_client.put_object(
            Bucket=bucket,
            Key=temp_key,
            Body=zip_content,
            ContentType="application/zip",
        )

        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": temp_key},
            ExpiresIn=PRESIGNED_URL_EXPIRY,
        )

        logger.info(
            "Generated presigned URL for large zip",
            filename=zip_filename,
            zip_size_bytes=len(zip_content),
            temp_key=temp_key,
        )

        return {
            "filename": zip_filename,
            "size_bytes": len(zip_content),
            "presigned_url": presigned_url,
            "file_count": downloaded_count,
            "total_files_in_folder": len(files),
        }

    # Small zip: return inline base64 (existing behavior)
    content_base64 = base64.b64encode(zip_content).decode("utf-8")

    return {
        "filename": zip_filename,
        "size_bytes": len(zip_content),
        "content_base64": content_base64,
        "file_count": downloaded_count,
        "total_files_in_folder": len(files),
    }


def handle_retrieve_kb_file(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle retrieve_kb_file tool invocation.

    Modes:
        download: Download a file by S3 URI
        list: List files in a KB, optionally filtered by pattern
        download_folder: Download all files in a KB folder as a zip

    Parameters:
        mode (str, required): "download", "list", or "download_folder"
        uri (str, download mode): S3 URI to download
        kb_id (str, list/download_folder mode): Knowledge base ID
        folder_path (str, download_folder mode): Folder path within KB
        pattern (str, optional, list mode): Filename pattern filter
        __allowed_kbs (list, internal): Allowed KB IDs for security validation
        __user_sub (str, internal): User identity required for server-side validation

    Returns:
        Download mode: Dict with filename, size_bytes, content_base64
        List mode: Dict with files list, kb_id, count
        Download folder mode: Dict with filename, size_bytes, content_base64, file_count
    """
    mode_raw = params.get("mode", "download")
    mode = mode_raw.strip().lower() if isinstance(mode_raw, str) else "download"
    allowed_kbs = params.get("__allowed_kbs", [])
    user_sub = _require_user_sub(params, "retrieve_kb_file")

    # Fail-closed: require allowed_kbs
    if not allowed_kbs:
        raise ValueError("No knowledge bases are enabled for this conversation")

    # Validate bucket is configured
    bucket = DATA_BUCKET_NAME
    if not bucket:
        raise ValueError("DATA_BUCKET_NAME not configured")

    if mode == "download":
        # Download mode - supports either URI or file+kb_id
        uri = params.get("uri")
        filename = params.get("file")
        kb_id = _validate_kb_id(params.get("kb_id", "company"), "kb_id")

        if uri:
            # URI-based download (existing flow)
            # Extract kb_id from URI (includes 'kb-' prefix for user KBs)
            kb_id_from_uri = _extract_kb_id_from_uri(uri)
            # Normalize for permission check (strip 'kb-' prefix to match allowed_kbs format)
            kb_id = _validate_kb_id(_normalize_kb_id(kb_id_from_uri), "kb_id")
            if kb_id not in allowed_kbs:
                logger.warning(
                    "KB access denied for download",
                    kb_id=kb_id,
                    allowed_kbs=allowed_kbs,
                    uri=uri,
                )
                raise ValueError(
                    f"Access denied: KB '{kb_id}' is not enabled. Enabled KBs: {allowed_kbs}"
                )

            # Server-side verification: Check DynamoDB for actual KB permissions
            if not verify_kb_access(user_sub, kb_id):
                logger.warning(
                    "KB download denied - server-side verification failed",
                    user_sub=user_sub[:8] + "...",
                    kb_id=kb_id,
                    uri=uri,
                )
                raise ValueError(f"Access denied to knowledge base '{kb_id}'")

            # Parse URI and validate key is constrained to this KB prefix
            key = _parse_and_validate_uri_key(uri, kb_id, bucket)

        elif filename:
            # Filename + kb_id based download (new flow)
            filename = _validate_filename(filename, "file")
            if kb_id not in allowed_kbs:
                logger.warning(
                    "KB access denied for download",
                    kb_id=kb_id,
                    allowed_kbs=allowed_kbs,
                    filename=filename,
                )
                raise ValueError(
                    f"Access denied: KB '{kb_id}' is not enabled. Enabled KBs: {allowed_kbs}"
                )

            # Server-side verification: Check DynamoDB for actual KB permissions
            if not verify_kb_access(user_sub, kb_id):
                logger.warning(
                    "KB download denied - server-side verification failed",
                    user_sub=user_sub[:8] + "...",
                    kb_id=kb_id,
                    filename=filename,
                )
                raise ValueError(f"Access denied to knowledge base '{kb_id}'")

            # Construct S3 key from kb_id + filename
            prefix = _get_s3_prefix(kb_id)  # e.g., "documents/company/"
            key = f"{prefix}{filename}"

            logger.info(
                "Download by filename",
                kb_id=kb_id,
                filename=filename,
                key=key,
            )

        else:
            raise ValueError("Either 'uri' or 'file' must be provided for download")

        # Download and return
        return _download_file(bucket, key)

    elif mode == "list":
        # List mode
        kb_id = _validate_kb_id(params.get("kb_id", "company"), "kb_id")
        pattern = params.get("pattern")
        if pattern is not None and not isinstance(pattern, str):
            raise ValueError("pattern must be a string")

        # Validate kb_id
        if kb_id not in allowed_kbs:
            logger.warning(
                "KB access denied for list",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            raise ValueError(
                f"Access denied: KB '{kb_id}' is not enabled. Enabled KBs: {allowed_kbs}"
            )

        if not verify_kb_access(user_sub, kb_id):
            logger.warning(
                "KB list denied - server-side verification failed",
                user_sub=user_sub[:8] + "...",
                kb_id=kb_id,
            )
            raise ValueError(f"Access denied to knowledge base '{kb_id}'")

        # Get prefix and list files
        prefix = _get_s3_prefix(kb_id)
        files = _list_files(bucket, prefix, pattern)

        return {
            "files": files,
            "kb_id": kb_id,
            "count": len(files),
            "pattern": pattern,
        }

    elif mode == "download_folder":
        # Download folder as zip
        kb_id = _validate_kb_id(params.get("kb_id", "company"), "kb_id")
        folder_path = _validate_relative_path(
            params.get("folder_path", ""), "folder_path"
        )

        # Validate kb_id
        if kb_id not in allowed_kbs:
            logger.warning(
                "KB access denied for folder download",
                kb_id=kb_id,
                allowed_kbs=allowed_kbs,
            )
            raise ValueError(
                f"Access denied: KB '{kb_id}' is not enabled. Enabled KBs: {allowed_kbs}"
            )

        # Server-side verification: Check DynamoDB for actual KB permissions
        if not verify_kb_access(user_sub, kb_id):
            logger.warning(
                "KB folder download denied - server-side verification failed",
                user_sub=user_sub[:8] + "...",
                kb_id=kb_id,
            )
            raise ValueError(f"Access denied to knowledge base '{kb_id}'")

        # Build prefix for the folder
        base_prefix = _get_s3_prefix(kb_id)
        # Add folder path if specified
        if folder_path:
            prefix = f"{base_prefix}{folder_path}/"
        else:
            prefix = base_prefix

        # Derive folder name for zip
        if folder_path:
            folder_name = folder_path.rsplit("/", maxsplit=1)[-1] or kb_id
        else:
            folder_name = kb_id

        # Download and return
        return _download_folder(bucket, prefix, folder_name)

    else:
        raise ValueError(
            f"Invalid mode: {mode}. Must be 'download', 'list', or 'download_folder'"
        )
