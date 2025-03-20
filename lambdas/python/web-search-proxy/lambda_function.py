import json
import time

import bedrock
import helpers
import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from bs4 import BeautifulSoup
from googlesearch import search

from prompts import REWRITE_QUERY_PROMPT

logger = structlog.get_logger()


def google_search(query: str, max_results: int = 5) -> list:
    try:
        urls = list(search(query, num_results=max_results, lang="en"))
        logger.info("Google search completed", urls_count=len(urls))
        return urls
    except Exception as e:
        logger.error("Google search error", error=str(e))
        return []


def scrape_page(url: str) -> dict:
    try:
        response = httpx.get(url, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            title = soup.title.string.strip() if soup.title and soup.title.string else ""
            text = soup.get_text(separator=" ", strip=True)
            snippet = text[:5000] if text else ""
            return {"title": title, "url": url, "snippet": snippet}
        else:
            logger.warning("Non-200 status code", url=url, status_code=response.status_code)
            return {"title": "", "url": url, "snippet": ""}
    except Exception as e:
        logger.error("Error scraping page", url=url, error=str(e))
        return {"title": "", "url": url, "snippet": ""}


def rewrite_query_with_context(query: str, context: str) -> str:
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

            logger.info("Query rewritten", original=query, rewritten=rewritten_query)
            return rewritten_query

        return query

    except Exception as e:
        logger.error("Error rewriting query", error=str(e))
        return query


def lambda_handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

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
        conversation_context = params.get("context", "")

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

        return {"statusCode": 200, "headers": headers, "body": json.dumps(response_body)}

    except Exception:
        logger.exception("Error processing request")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": "Internal server error"}),
        }
