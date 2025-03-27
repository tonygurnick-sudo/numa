"""
Web Search Proxy Lambda Function.

This Lambda provides an API for performing web searches and retrieving content from web pages.
It accepts a search query and conversation ID to optimize the search,
then returns search results with content snippets from the top matching pages.

The Lambda retrieves conversation context from DynamoDB using query parameters:
- client: The client name for constructing the DynamoDB table name
- environment: The environment (defaults to 'prod' if not specified)
"""

import json
import time
from typing import Any, Dict, List, Optional

import boto3
import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from bs4 import BeautifulSoup
from googlesearch import search

import bedrock
import helpers
from prompts import REWRITE_QUERY_PROMPT

logger = structlog.get_logger()
dynamodb = boto3.client("dynamodb")


def fetch_conversation_context(
    conversation_id: str,
    user_id: str,
    max_messages: int = 6,
    event: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Fetch conversation context from DynamoDB for a specific conversation.

    Args:
        conversation_id: The unique conversation identifier
        user_id: The user's identity ID
        max_messages: Maximum number of messages to include in context
        event: Lambda event object for extracting client/environment

    Returns:
        Formatted conversation context string
    """
    try:
        if not event:
            logger.warning("No event provided to fetch_conversation_context")
            return ""
        params = event.get("queryStringParameters", {}) or {}
        table_name = params.get("table_name")

        if not table_name:
            logger.error("table_name not provided in query parameters")
            return ""

        # Query DynamoDB for conversation messages
        response = dynamodb.query(
            TableName=table_name,
            KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
            ExpressionAttributeValues={
                ":u": {"S": user_id},
                ":c": {"S": f"{conversation_id}#"},
            },
            ScanIndexForward=True,  # Sort by timestamp ascending
        )

        if not response.get("Items"):
            return ""

        # Process items - extract text messages only
        items = []
        for item in response.get("Items", []):
            # Extract only the fields we need directly from the DynamoDB response
            role = item.get("role", {}).get("S", "")
            content = item.get("content", {}).get("S", "")
            message_type = item.get("message_type", {}).get("S", "text")
            timestamp = int(item.get("timestamp", {}).get("N", 0))

            # Skip non-text messages (files, meta, etc.)
            if message_type != "text":
                continue

            if role and content:
                items.append({"role": role, "content": content, "timestamp": timestamp})

        # Sort by timestamp and get most recent messages
        items.sort(key=lambda x: x.get("timestamp", 0))
        recent = items[-max_messages:] if len(items) > max_messages else items

        # Format as conversation context
        context_lines = [f"{msg['role']}: {msg['content']}" for msg in recent]
        context = "\n".join(context_lines)

        return context

    except Exception as e:
        logger.error("Error fetching conversation context", error=str(e), exc_info=True)
        return ""


def google_search(query: str, max_results: int = 5) -> Any:
    """
    Perform a Google search and return a list of URLs.

    Args:
        query: The search query string
        max_results: Maximum number of results to return (default: 5)

    Returns:
        List of URLs from search results
    """
    try:
        urls = list(search(query, num_results=max_results, lang="en"))
        return urls
    except Exception as e:
        logger.error("Google search error", error=str(e))
        return []


def scrape_page(url: str) -> Dict[str, str]:
    """
    Scrape content from a web page.

    Args:
        url: URL of the page to scrape

    Returns:
        Dictionary containing title, URL, and content snippet
    """
    try:
        response = httpx.get(url, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            title = (
                soup.title.string.strip() if soup.title and soup.title.string else ""
            )
            text = soup.get_text(separator=" ", strip=True)
            snippet = text[:10000] if text else ""
            return {"title": title, "url": url, "snippet": snippet}

        # Log warning for non-200 responses
        logger.warning("Non-200 status code", url=url, status_code=response.status_code)
        return {"title": "", "url": url, "snippet": ""}
    except Exception as e:
        logger.error("Error scraping page", url=url, error=str(e))
        return {"title": "", "url": url, "snippet": ""}


def rewrite_query_with_context(query: str, context: str) -> str:
    """
    Rewrite a search query using conversation context to improve search relevance.

    Args:
        query: Original search query
        context: Conversation context to use for query refinement

    Returns:
        Rewritten query, or original query if rewriting fails
    """
    try:
        prompt = REWRITE_QUERY_PROMPT.format(context=context, query=query)

        # Create model and run query
        model = bedrock.BedrockClaude3Model(
            model_args={
                "max_tokens": 100,
                "temperature": 0.1,
            }
        )

        response = model.run(prompt, name_for_logging="search_query_rewrite")

        # Extract the rewritten query from the response
        if response and response.response:
            rewritten_query = response.response[0].get("text", "").strip()

            # Return original query if rewriting fails or produces empty result
            if not rewritten_query:
                logger.warning("Query rewriting returned empty result")
                return query

            max_query_length = 60
            if len(rewritten_query) > max_query_length:
                rewritten_query = rewritten_query[:max_query_length]

            logger.info("Query rewritten", original=query, rewritten=rewritten_query)
            return rewritten_query

        return query

    except Exception as e:
        logger.error("Error rewriting query", error=str(e))
        return query


def lambda_handler(
    event: Dict[str, Any], context: LambdaContext
) -> helpers.ApiGatewayProxyIntegrationResponse:
    """
    Lambda handler function for the web search proxy.

    Args:
        event: Lambda event object
        context: Lambda context object

    Returns:
        API Gateway response with search results
    """
    helpers.setup_logging()
    logger.info("Web search request", request_id=context.aws_request_id)

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json",
    }

    if event.get("httpMethod") == "OPTIONS":
        return helpers.ApiGatewayProxyIntegrationResponse(
            statusCode=200, headers=headers, body=""
        )

    try:
        params = event.get("queryStringParameters", {}) or {}
        query = params.get("query", "")
        max_results_str = params.get("max_results", "5")
        conversation_id = params.get("conversation_id", "")
        user_id = params.get("user_id", "")
        table_name = params.get("table_name", "")

        # Check required parameters
        if not query:
            return helpers.ApiGatewayProxyIntegrationResponse(
                statusCode=400,
                headers=headers,
                body=json.dumps(
                    {
                        "error": "Missing query parameter",
                        "message": "The 'query' parameter is required",
                    }
                ),
            )

        if not table_name:
            return helpers.ApiGatewayProxyIntegrationResponse(
                statusCode=400,
                headers=headers,
                body=json.dumps(
                    {
                        "error": "Missing table_name parameter",
                        "message": "The 'table_name' parameter is required",
                    }
                ),
            )

        # Get conversation context
        conversation_context = ""
        if conversation_id and user_id:
            logger.info(
                f"Fetching conversation context using conversation_id: {conversation_id}, user_id: {user_id}"
            )
            conversation_context = fetch_conversation_context(
                conversation_id, user_id, event=event
            )
            if not conversation_context:
                logger.warning(
                    "DynamoDB conversation fetch failed, falling back to context parameter"
                )
                conversation_context = params.get("context", "")
        else:
            logger.info(
                "Missing conversation_id or user_id, using 'context' parameter instead"
            )
            conversation_context = params.get("context", "")

        # If we have context, rewrite the query
        search_query = query
        if conversation_context:
            search_query = rewrite_query_with_context(query, conversation_context)

        try:
            max_results = int(max_results_str)
            max_results = min(max(1, max_results), 10)
        except ValueError:
            max_results = 5

        # Step 1: Get URLs from Google search with rewritten query
        urls = google_search(search_query, max_results)

        # Step 2: Scrape content from each URL
        results = []
        for url in urls:
            result = scrape_page(url)
            results.append(result)
            time.sleep(0.5)

        response_body = {
            "query": search_query,
            "original_query": query,
            "results_count": len(results),
            "results": results,
            "timestamp": int(time.time()),
        }

        return helpers.ApiGatewayProxyIntegrationResponse(
            statusCode=200, headers=headers, body=json.dumps(response_body)
        )

    except Exception:
        logger.exception("Error processing request")
        return helpers.ApiGatewayProxyIntegrationResponse(
            statusCode=500,
            headers=headers,
            body=json.dumps({"error": "Internal server error"}),
        )
