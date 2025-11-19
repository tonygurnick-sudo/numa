"""
Knowledge base utilities for the Numa chat agent.

Handles Q Business and Bedrock knowledge base querying with a unified interface.
"""

import os
from typing import Any, Dict

import structlog

from ..auth import get_current_user_auth, get_qbusiness_client_for_user
from ..config import (
    BEDROCK_KNOWLEDGE_BASE_ID,
    PREFERRED_KNOWLEDGE_BASE,
    QB_APPLICATION_ID,
    QB_RETRIEVER_ID,
    get_bedrock_agent_runtime_client,
)
from ..summarization import summarize_combined_content
from ..utils import retry_aurora_operation

logger = structlog.get_logger()


def extract_bedrock_uri(location):
    """
    Extract URI from Bedrock knowledge base location object.

    Args:
        location: Location object from Bedrock response

    Returns:
        URI string or "N/A" if not found
    """
    if not location:
        return "N/A"
    return (
        location.get("s3Location", {}).get("uri")
        or location.get("webLocation", {}).get("url")
        or "N/A"
    )


def query_qbusiness_knowledge_base(query: str, max_results: int = 6):
    """
    Query Q Business knowledge base.

    Args:
        query: Search query
        max_results: Maximum number of results

    Returns:
        Dictionary with content, references, and metadata
    """
    logger.debug(
        "Using Q Business knowledge base",
        app_id=QB_APPLICATION_ID,
        retriever_id=QB_RETRIEVER_ID,
    )

    # Get authenticated client if possible
    current_user_auth = get_current_user_auth()
    qb_client = get_qbusiness_client_for_user(current_user_auth)

    resp = qb_client.search_relevant_content(
        applicationId=QB_APPLICATION_ID,
        queryText=query,
        contentSource={"retriever": {"retrieverId": QB_RETRIEVER_ID}},
        maxResults=max_results,
    )

    items = resp.get("relevantContent", [])
    logger.info(
        "Q Business search completed",
        results_count=len(items),
        max_results=max_results,
    )

    # Extract content and references
    content_pieces = []
    refs = []

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
        "raw_items": items,
    }


def query_bedrock_knowledge_base(
    query: str, max_results: int = 6, kb_id: str = "company"
):
    """
    Query Bedrock knowledge base with Aurora retry logic and metadata filtering.

    Args:
        query: Search query
        max_results: Maximum number of results
        kb_id: Knowledge base ID to filter by (default: "company")

    Returns:
        Dictionary with content, references, and metadata
    """
    resolved_kb_id = (kb_id or "company").strip() or "company"

    logger.debug(
        "Using Bedrock knowledge base",
        bedrock_kb_id=BEDROCK_KNOWLEDGE_BASE_ID,
        filter_kb_id=resolved_kb_id,
    )

    kb_client = get_bedrock_agent_runtime_client()

    # Build retrieval configuration with metadata filtering
    retrieval_config: Dict[str, Any] = {
        "vectorSearchConfiguration": {"numberOfResults": max_results}
    }

    # Add metadata filter to restrict results to specific KB
    client_name = os.environ.get("CLIENT_NAME", "")
    if client_name and resolved_kb_id:
        retrieval_config["vectorSearchConfiguration"]["filter"] = {
            "andAll": [
                {"equals": {"key": "tenant_id", "value": client_name}},
                {"equals": {"key": "kb_id", "value": resolved_kb_id}},
            ]
        }
        logger.debug(
            "Applied metadata filter",
            tenant_id=client_name,
            kb_id=resolved_kb_id,
        )

    # Create a retry-wrapped retrieve operation for Aurora auto-pause handling
    def bedrock_retrieve_operation(config):
        return kb_client.retrieve(
            knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration=config,
        )

    # Apply retry wrapper and execute with current configuration
    def execute_with_config(config):
        retry_retrieve = retry_aurora_operation(
            lambda: bedrock_retrieve_operation(config)
        )
        return retry_retrieve()

    resp = execute_with_config(retrieval_config)
    # Strict separation: Do not retry without metadata filter.
    # If no results with the applied filter, return an empty result set to avoid cross‑KB leakage.

    items = resp.get("retrievalResults", [])
    logger.info(
        "Bedrock knowledge base search completed",
        results_count=len(items),
        max_results=max_results,
    )

    # Extract content and references
    content_pieces = []
    refs = []

    for item in items:
        if item.get("content"):
            source_uri = extract_bedrock_uri(item.get("location"))
            content = item.get("content", {}).get("text", "")
            content_pieces.append(f"Source: {source_uri}\n{content}")
            refs.append(source_uri)

    return {
        "content_pieces": content_pieces,
        "references": refs,
        "provider": "bedrock",
        "raw_items": items,
    }


def query_knowledge_base_impl(
    query: str, user_intent: str, max_results: int = 6, kb_id: str = "company"
):
    """
    Implementation of knowledge base querying with unified interface.

    Args:
        query: Natural language description of what you're searching for
        user_intent: Description of what the user is trying to accomplish
        max_results: Maximum number of results to return (default: 6, max: 15)
        kb_id: Knowledge base ID to search (default: "company")

    Returns:
        Dictionary with search results and status
    """
    resolved_kb_id = (kb_id or "company").strip() or "company"

    logger.info(
        "Querying knowledge base",
        query=query,
        max_results=max_results,
        provider=PREFERRED_KNOWLEDGE_BASE,
        kb_id=resolved_kb_id,
    )

    # Limit max_results to reasonable bounds (max 15 sources)
    max_results = min(max(1, max_results), 15)

    provider = PREFERRED_KNOWLEDGE_BASE.lower()

    try:
        # Query the appropriate knowledge base
        if provider == "q" and QB_APPLICATION_ID and QB_RETRIEVER_ID:
            kb_result = query_qbusiness_knowledge_base(query, max_results)
        elif provider == "bedrock" and BEDROCK_KNOWLEDGE_BASE_ID:
            kb_result = query_bedrock_knowledge_base(query, max_results, resolved_kb_id)
        else:
            logger.warning(
                "Knowledge base provider not configured",
                provider=provider,
                qb_configured=bool(QB_APPLICATION_ID and QB_RETRIEVER_ID),
                bedrock_configured=bool(BEDROCK_KNOWLEDGE_BASE_ID),
            )
            return {
                "status": "error",
                "content": [{"text": "Knowledge‑base provider not configured"}],
            }

        # Combine all content for summarization
        all_content = "\n\n".join(kb_result["content_pieces"])
        refs = kb_result["references"]

        # Create summary using Haiku
        summarised_content = ""
        if all_content and user_intent:
            summarised_content = summarize_combined_content(
                all_content=all_content,
                user_intent=user_intent,
                content_type="knowledge_base",
                references=refs,
            )

        # Fallback to original structure if summarization fails
        if not summarised_content:
            logger.warning("Using fallback: original knowledge base content")
            # Build original structured list as fallback
            if provider == "q":
                knowledge_list = [
                    {item.get("documentUri", "N/A"): item.get("content", "")}
                    for item in kb_result["raw_items"]
                    if item.get("content")
                ]
            else:  # bedrock
                knowledge_list = [
                    {
                        extract_bedrock_uri(item.get("location")): item.get(
                            "content", {}
                        ).get("text", "")
                    }
                    for item in kb_result["raw_items"]
                    if item.get("content")
                ]

            result_data = {
                "knowledgeText": knowledge_list,
                "references": refs,
                "provider": kb_result["provider"],
                "query": query,
                "results_count": len(refs),
            }
        else:
            # Return new structure with summarized content
            result_data = {
                "summarised_content": summarised_content,
                "references": refs,
                "provider": kb_result["provider"],
                "query": query,
                "results_count": len(refs),
            }

        return {"status": "success", "content": [{"json": result_data}]}

    except Exception as exc:
        logger.error(
            "Knowledge base query failed",
            error=str(exc),
            provider=provider,
            exc_info=True,
        )
        return {
            "status": "error",
            "content": [{"text": f"Knowledge base query failed: {str(exc)}"}],
        }
