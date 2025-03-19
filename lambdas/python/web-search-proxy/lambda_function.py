import json
import logging
import os
import time
from typing import Any, Dict, List

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
            max_results = min(max(1, max_results), 10)
        except ValueError:
            max_results = 5

        # Step 1: Get URLs from Google search
        urls = google_search(query, max_results)

        # Step 2: Scrape content from each URL
        results = []
        for url in urls:
            result = scrape_page(url)
            results.append(result)
            # Small delay to avoid overloading target servers
            time.sleep(0.5)

        response_body = {
            "query": query,
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
