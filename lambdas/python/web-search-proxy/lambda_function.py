import json
import logging
import os
import time
from typing import Any, Dict, List

import httpx

log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger("web-search-proxy")

# Constants
SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "e8358540c689f5b122cdd2c51fbaee28ff3f9ece")
SERPER_API_URL = "https://google.serper.dev/search"
TIMEOUT = 10


def serper_search(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    Search the web using Serper.dev API
    """
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}

    payload = {"q": query, "num": max_results}

    logger.info(f"Sending search request to Serper.dev: query='{query}', max_results={max_results}")

    try:
        with httpx.Client(headers=headers, timeout=TIMEOUT) as client:
            response = client.post(SERPER_API_URL, json=payload)
            response.raise_for_status()

            data = response.json()
            logger.info(f"Serper API response status: {response.status_code}")

            # Log the complete response for debugging (truncate if too large)
            response_str = json.dumps(data)
            if len(response_str) > 1000:
                logger.info(f"Serper API response (truncated): {response_str[:1000]}...")
            else:
                logger.info(f"Serper API response: {response_str}")

            # Extract organic search results
            organic = data.get("organic", [])

            results = []
            for item in organic[:max_results]:
                title = item.get("title", "")
                url = item.get("link", "")
                snippet = item.get("snippet", "")

                results.append({"title": title, "url": url, "snippet": snippet})

            return results
    except Exception as e:
        logger.error(f"Serper search error: {str(e)}")
        return []


def lambda_handler(event, context):
    """Lambda handler that performs web search using Serper.dev API"""
    logger.info(f"Received event: {json.dumps(event)}")

    # Add CORS headers to all responses
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json",
    }

    # Handle OPTIONS requests for CORS
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}

    try:
        # Extract query parameter
        params = event.get("queryStringParameters", {}) or {}
        query = params.get("query", "")
        max_results_str = params.get("max_results", "5")

        logger.info(f"Search query: {query}")

        if not query:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps(
                    {
                        "error": "Missing query parameter",
                        "message": "The 'query' parameter is required",
                    }
                ),
            }

        try:
            max_results = int(max_results_str)
            max_results = min(max(1, max_results), 10)  # Ensure between 1 and 10
        except ValueError:
            max_results = 5

        # Get search results from Serper.dev
        search_results = serper_search(query, max_results)

        if not search_results:
            # Generate mock results for fallback
            search_results = [
                {
                    "title": f"Result for {query} - Example 1",
                    "url": "https://example.com/result1",
                    "snippet": f"This is a mock result for the query: {query}. Example search result 1.",
                },
                {
                    "title": f"Result for {query} - Example 2",
                    "url": "https://example.com/result2",
                    "snippet": f"This is a mock result for the query: {query}. Example search result 2.",
                },
            ][:max_results]

        # Create response
        response = {
            "query": query,
            "results_count": len(search_results),
            "results": search_results,
            "timestamp": int(time.time()),
        }

        logger.info(f"Returning {len(search_results)} results")

        # Log the full response for debugging
        response_str = json.dumps(response)
        if len(response_str) > 1000:
            logger.info(f"Final response (truncated): {response_str[:1000]}...")
        else:
            logger.info(f"Final response: {response_str}")

        return {"statusCode": 200, "headers": headers, "body": json.dumps(response)}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": "Internal server error", "message": str(e)}),
        }
