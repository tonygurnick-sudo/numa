"""
Content summarization module for Numa Chat Agent.

Provides fast, cost-effective content summarization using Claude Haiku.
"""

import json
from typing import List

import structlog

from .config import HAIKU_MODEL_ID, get_bedrock_runtime_client
from .utils import log_token_usage

logger = structlog.get_logger()


def call_haiku_summarizer(prompt: str, max_tokens: int = 2000) -> str:
    """
    Call Claude Haiku for fast, cost-effective summarization.

    Args:
        prompt: Summarization prompt
        max_tokens: Maximum tokens for response

    Returns:
        Summarized text, or empty string if failed
    """
    try:
        client = get_bedrock_runtime_client()

        body = json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "temperature": 0.1,  # Low temperature for consistency
                "messages": [
                    {"role": "user", "content": [{"type": "text", "text": prompt}]}
                ],
            }
        )

        response = client.invoke_model(
            body=body,
            modelId=HAIKU_MODEL_ID,
            accept="application/json",
            contentType="application/json",
        )

        response_body = json.loads(response.get("body").read())

        # Extract token usage information and log it
        usage_stats = response_body.get("usage", {})
        log_token_usage(
            model_id=HAIKU_MODEL_ID,
            usage_stats=usage_stats,
            context="Haiku summarization",
        )

        # Log additional summarization metrics
        input_tokens = usage_stats.get("input_tokens", 0)
        output_tokens = usage_stats.get("output_tokens", 0)

        logger.info(
            "Haiku summarization completed",
            model_id=HAIKU_MODEL_ID,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            prompt_length=len(prompt),
            response_length=len(response_body["content"][0]["text"]),
        )

        return response_body["content"][0]["text"].strip()

    except Exception as e:
        logger.error("Haiku summarization failed", error=str(e), exc_info=True)
        # Return empty string on failure - tools will handle fallback
        return ""


def summarize_combined_content(
    all_content: str, user_intent: str, content_type: str, references: List[str]
) -> str:
    """
    Create a single coherent summary from all collected content.

    Args:
        all_content: Combined text from all sources
        user_intent: What the user is trying to accomplish
        content_type: "knowledge_base" or "web_search"
        references: List of source references

    Returns:
        Coherent text summary, or empty string if summarization fails
    """
    if not all_content.strip():
        return ""

    # Create context-appropriate prompt
    if content_type == "knowledge_base":
        prompt_template = """You are summarizing internal knowledge base content for a user query.

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
{content}

Provide a comprehensive summary:"""
    else:  # web_search
        prompt_template = """You are summarizing web search results for a user query.

USER INTENT: {user_intent}

TASK: Create a comprehensive but concise summary of the following content from {num_sources} web sources. Focus on current information relevant to the user's intent.

GUIDELINES:
1. Synthesize information from all sources into a coherent narrative
2. Extract key facts, recent developments, and specific details
3. Preserve dates, statistics, quotes, and concrete information
4. Focus on content directly relevant to the user's intent
5. Note when information is recent/current vs older
6. If sources conflict, mention the different perspectives
7. Organize information logically by relevance and recency

WEB SEARCH CONTENT:
{content}

Provide a comprehensive summary:"""

    prompt = prompt_template.format(
        user_intent=user_intent,
        num_sources=len(references),
        content=all_content[:15000],  # Limit content to avoid token limits
    )

    logger.info(
        "Starting content summarization",
        content_type=content_type,
        num_sources=len(references),
        content_length=len(all_content),
        user_intent_preview=user_intent[:100],
    )

    summary = call_haiku_summarizer(prompt)

    if summary:
        logger.info(
            "Content summarization completed successfully",
            content_type=content_type,
            original_length=len(all_content),
            summary_length=len(summary),
        )
    else:
        logger.warning("Content summarization failed, will use fallback")

    return summary
