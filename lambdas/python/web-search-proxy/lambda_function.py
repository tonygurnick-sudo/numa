import json
import logging
import os
import time
from typing import Any, Dict, List

import bedrock
import httpx
from bs4 import BeautifulSoup
from googlesearch import search

log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger("web-search-proxy")


def google_search(query: str, max_results: int = 5) -> List[str]:
    """
    Uses googlesearch-python to perform a Google search and return a list of URLs.
    """
    try:
        urls = list(search(query, num_results=max_results, lang="en"))
        logger.info(f"Google search returned URLs: {urls}")
        return urls
    except Exception as e:
        logger.error(f"Google search error: {str(e)}")
        return []


def scrape_page(url: str) -> Dict[str, str]:
    """
    Fetches page content from the URL using httpx and extracts the title and up to 1000 characters of text content.
    """
    try:
        response = httpx.get(url, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            title = soup.title.string.strip() if soup.title and soup.title.string else ""
            text = soup.get_text(separator=" ", strip=True)
            snippet = text[:5000] if text else ""
            return {"title": title, "url": url, "snippet": snippet}
        else:
            logger.warning(f"Non-200 status code for {url}: {response.status_code}")
            return {"title": "", "url": url, "snippet": ""}
    except Exception as e:
        logger.error(f"Error scraping {url}: {str(e)}")
        return {"title": "", "url": url, "snippet": ""}


def rewrite_query_with_context(query: str, context: str) -> str:
    """
    Use bedrock library to rewrite the search query based on conversation context
    """
    try:
        # Create prompt for query rewriting
        prompt = f"""
        You are a search query optimizer. Your task is to rewrite a search query to make it more effective
        based on the conversation context provided. Focus on extracting the most relevant search terms
        and adding context that would improve search results.

        Conversation context:
        {context}

        Original query:
        {query}

        Return only the rewritten query without explanation. Keep it concise (under 100 characters if possible).
        """

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
                logger.warning("Query rewriting returned empty result, using original query")
                return query

            logger.info(f"Original query: '{query}' -> Rewritten: '{rewritten_query}'")
            return rewritten_query

        return query

    except Exception as e:
        logger.error(f"Error rewriting query: {str(e)}")
        # Fall back to original query on failure
        return query


def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}

    try:
        params = event.get("queryStringParameters", {}) or {}
        query = params.get("query", "")
        max_results_str = params.get("max_results", "5")

        # Get conversation context if provided
        conversation_context = params.get("context", "")

        logger.info(f"Original search query: {query}")

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

        # If we have context, rewrite the query
        search_query = query
        if conversation_context:
            logger.info(f"Conversation context provided, length: {len(conversation_context)}")
            search_query = rewrite_query_with_context(query, conversation_context)
            logger.info(f"Rewritten query: {search_query}")

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
            # Small delay to avoid overloading target servers
            time.sleep(0.5)

        response_body = {
            "query": search_query,  # Return the query used for search
            "original_query": query,  # Include the original query for reference
            "results_count": len(results),
            "results": results,
            "timestamp": int(time.time()),
        }

        logger.info(f"Returning {len(results)} results")
        return {"statusCode": 200, "headers": headers, "body": json.dumps(response_body)}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": "Internal server error", "message": str(e)}),
        }
