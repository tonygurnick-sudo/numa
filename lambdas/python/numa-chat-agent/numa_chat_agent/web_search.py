"""
Web search module for Numa Chat Agent.

Provides Google search and web scraping functionality.
"""

import time
from typing import Any, Dict, List

import httpx
import structlog
from bs4 import BeautifulSoup
from googlesearch import search  # type: ignore[import-untyped]

from .summarization import summarize_combined_content

logger = structlog.get_logger()

# User agents for retry logic
PRIMARY_USER_AGENT = "curl/8.7.1"
FALLBACK_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)


def _is_processable_url(url: str) -> bool:
    """Check if URL should be processed based on file extension."""
    return not url.lower().endswith(
        (
            ".pdf",
            ".docx",
            ".doc",
            ".xlsx",
            ".xls",
            ".pptx",
            ".ppt",
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".bmp",
            ".tiff",
            ".svg",
            ".webp",
            ".zip",
            ".rar",
            ".7z",
            ".tar",
            ".gz",
            ".bz2",
            ".dmg",
            ".exe",
            ".msi",
        )
    )


def google_search(query: str, max_results: int = 3, max_retries: int = 3) -> List[str]:
    """
    Perform a Google search with retry logic for rate limiting.

    Args:
        query: The search query string
        max_results: Maximum number of results to return (default: 3)
        max_retries: Maximum number of retry attempts (default: 3)

    Returns:
        List of URLs from search results
    """
    for attempt in range(max_retries + 1):
        try:
            # Add 2-second delay before retry attempts (not on first attempt)
            if attempt > 0:
                logger.info(
                    "Retrying Google search after delay",
                    query=query,
                    attempt=attempt + 1,
                    delay_seconds=2,
                )
                time.sleep(2)

            # Perform the search
            results = list(search(query, num_results=max_results, lang="en"))
            urls = [
                r if isinstance(r, str) else getattr(r, "url", str(r)) for r in results
            ]

            logger.info(
                "Google search completed successfully",
                query=query,
                results_count=len(urls),
                attempt=attempt + 1,
            )
            return urls

        except Exception as e:
            error_str = str(e).lower()
            is_rate_limit = (
                "429" in error_str
                or "too many requests" in error_str
                or "rate limit" in error_str
            )

            if is_rate_limit and attempt < max_retries:
                logger.warning(
                    "Google search rate limited, will retry",
                    query=query,
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    error=str(e),
                )
            logger.error(
                "Google search failed",
                query=query,
                attempt=attempt + 1,
                max_retries=max_retries,
                error=str(e),
                is_rate_limit=is_rate_limit,
            )
            return []

    return []


def scrape_page(url: str) -> Dict[str, Any]:
    """
    Scrape content from a web page with enhanced browser-like headers and retry logic.

    Args:
        url: URL of the page to scrape

    Returns:
        Dictionary containing title, URL, content snippet, and success status
    """
    if not _is_processable_url(url):
        logger.info("Skipping non-processable URL in scrape_page", url=url)
        return {
            "title": "",
            "url": url,
            "snippet": "",
            "success": False,
            "error_type": "non_processable_url",
        }
    # Browser-like headers to improve scraping success
    base_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
    }

    user_agents = [PRIMARY_USER_AGENT, FALLBACK_USER_AGENT]

    def attempt_scrape(url: str, user_agent: str, timeout: int = 12) -> Dict[str, Any]:
        """Single scraping attempt with detailed error tracking"""
        headers = {**base_headers, "User-Agent": user_agent}
        try:
            response = httpx.get(
                url, headers=headers, timeout=timeout, follow_redirects=True
            )

            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")
                title = (
                    soup.title.string.strip()
                    if soup.title and soup.title.string
                    else ""
                )
                text = soup.get_text(separator=" ", strip=True)
                snippet = text[:10000] if text else ""

                logger.info(
                    "Page scraping successful",
                    url=url,
                    title_length=len(title),
                    content_length=len(snippet),
                    status_code=response.status_code,
                    user_agent=user_agent,
                )

                return {
                    "title": title,
                    "url": url,
                    "snippet": snippet,
                    "success": True,
                    "status_code": response.status_code,
                }
            else:
                # Log different types of failures for better debugging
                if response.status_code == 403:
                    logger.warning(
                        "Site blocking access (403 Forbidden) - likely anti-bot protection",
                        url=url,
                        status_code=response.status_code,
                        user_agent=user_agent,
                    )
                elif response.status_code == 429:
                    logger.warning(
                        "Rate limited (429 Too Many Requests)",
                        url=url,
                        status_code=response.status_code,
                    )
                elif response.status_code in [401, 402]:
                    logger.warning(
                        "Authentication required",
                        url=url,
                        status_code=response.status_code,
                    )
                elif response.status_code >= 500:
                    logger.warning(
                        "Server error - site may be down",
                        url=url,
                        status_code=response.status_code,
                    )
                else:
                    logger.warning(
                        "Non-200 status code", url=url, status_code=response.status_code
                    )

                return {
                    "title": "",
                    "url": url,
                    "snippet": "",
                    "success": False,
                    "status_code": response.status_code,
                    "user_agent": user_agent,
                }

        except httpx.TimeoutException as e:
            logger.warning(
                "Page scraping timeout", url=url, timeout=timeout, error=str(e)
            )
            return {
                "title": "",
                "url": url,
                "snippet": "",
                "success": False,
                "error_type": "timeout",
            }
        except httpx.ConnectError as e:
            logger.warning("Connection error", url=url, error=str(e))
            return {
                "title": "",
                "url": url,
                "snippet": "",
                "success": False,
                "error_type": "connection_error",
            }
        except Exception as e:
            logger.warning(
                "Page scraping error",
                url=url,
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "title": "",
                "url": url,
                "snippet": "",
                "success": False,
                "error_type": type(e).__name__,
            }

    for attempt, user_agent in enumerate(user_agents, 1):
        try:
            result = attempt_scrape(url, user_agent)

            if result.get("success"):
                if attempt > 1:
                    logger.info(
                        "Web scrape retry successful",
                        url=url,
                        attempt=attempt,
                        user_agent=user_agent,
                    )
                return result

            if result.get("status_code", 0) >= 500:
                logger.info(
                    "Retrying server error with longer timeout",
                    url=url,
                    attempt=attempt,
                    user_agent=user_agent,
                )
                time.sleep(1)
                retry_result = attempt_scrape(url, user_agent, timeout=15)
                if retry_result.get("success"):
                    return retry_result

            if result.get("status_code") == 403 and attempt < len(user_agents):
                logger.info(
                    "403 error with user agent, trying fallback",
                    url=url,
                    attempt=attempt,
                    current_user_agent=user_agent,
                    next_user_agent=(
                        user_agents[attempt] if attempt < len(user_agents) else None
                    ),
                )
                continue

            if attempt == len(user_agents):
                return result

        except Exception as e:
            logger.error(
                "Error in scrape attempt",
                url=url,
                attempt=attempt,
                user_agent=user_agent,
                error=str(e),
            )
            if attempt == len(user_agents):
                return {
                    "title": "",
                    "url": url,
                    "snippet": "",
                    "success": False,
                    "error_type": "complete_failure",
                }
            continue

    return {
        "title": "",
        "url": url,
        "snippet": "",
        "success": False,
        "error_type": "complete_failure",
    }


def web_search_impl(query: str, user_intent: str, max_results: int = 3):
    """
    Implementation of web search functionality.

    Args:
        query: Natural language search query for general information
        user_intent: Description of what the user is trying to accomplish
        max_results: Maximum number of results to return (default: 3, max: 10)

    Returns:
        Dictionary with search results and status
    """
    logger.info("Performing web search", query=query, max_results=max_results)

    try:
        # Limit max_results to reasonable bounds (max 10 sites)
        max_results = min(max(1, max_results), 10)

        # Step 1: Get URLs from Google search with retry logic
        urls = google_search(query, max_results, max_retries=3)

        if not urls:
            logger.warning(
                "No URLs returned from Google search after retries", query=query
            )
            result_data = {
                "query": query,
                "user_intent": user_intent,
                "max_results": max_results,
                "results_count": 0,
                "references": [],
                "error": "No search results found. This may be due to rate limiting or search service unavailability.",
                "summarised_content": "Unable to perform web search due to rate limiting or service unavailability. Please try again later.",
            }
            return {"status": "error", "content": [{"json": result_data}]}

        # Step 2: Scrape content from each URL
        results = []
        successful_scrapes = 0
        failed_scrapes = 0

        for url in urls:
            if not _is_processable_url(url):
                logger.info("Skipping non-processable URL", url=url)
                continue

            result = scrape_page(url)
            # Track success/failure for logging
            if result.get("success"):
                successful_scrapes += 1
                results.append(result)
            else:
                failed_scrapes += 1
                # Log the specific failure reason
                error_type = result.get("error_type", "unknown")
                status_code = result.get("status_code", "N/A")
                logger.info(
                    "Skipping failed scrape",
                    url=url,
                    error_type=error_type,
                    status_code=status_code,
                )

            # Small delay between requests to be respectful
            time.sleep(0.5)

        logger.info(
            "Web scraping summary",
            query=query,
            urls_attempted=len(urls),
            successful_scrapes=successful_scrapes,
            failed_scrapes=failed_scrapes,
            success_rate=f"{(successful_scrapes/len(urls)*100):.1f}%" if urls else "0%",
        )

        logger.info(
            "Web search completed",
            query=query,
            urls_found=len(urls),
            results_with_content=len(results),
        )

        # Extract content and references for summarization
        content_pieces = []
        references = []

        for result in results:
            title = result.get("title", "No title")
            url = result.get("url", "")
            snippet = result.get("snippet", "No content available")

            content_pieces.append(f"Title: {title}\nURL: {url}\nContent: {snippet}")
            references.append(url)

        # Combine all content for summarization
        all_content = "\n\n".join(content_pieces)

        # Create summary using Haiku
        summarised_content = ""
        if all_content and user_intent:
            summarised_content = summarize_combined_content(
                all_content=all_content,
                user_intent=user_intent,
                content_type="web_search",
                references=references,
            )

        # Fallback to original structure if summarization fails
        if not summarised_content:
            logger.warning("Using fallback: original web search results")
            # Build original results structure as fallback
            formatted_results = []
            for result in results:
                formatted_results.append(
                    {
                        "title": result.get("title", "No title"),
                        "url": result.get("url", ""),
                        "snippet": result.get("snippet", "No content available"),
                    }
                )

            result_data = {
                "query": query,
                "user_intent": user_intent,
                "max_results": max_results,
                "results_count": len(formatted_results),
                "results": formatted_results,
            }
        else:
            # Return new structure with summarized content
            result_data = {
                "query": query,
                "user_intent": user_intent,
                "max_results": max_results,
                "summarised_content": summarised_content,
                "references": references,
                "results_count": len(references),
            }

        return {"status": "success", "content": [{"json": result_data}]}

    except Exception as exc:
        logger.error("Web search failed", query=query, error=str(exc), exc_info=True)
        error_data = {
            "query": query,
            "user_intent": user_intent,
            "max_results": max_results,
            "results_count": 0,
            "references": [],
            "error": f"Web search failed: {str(exc)}",
            "summarised_content": f"Web search encountered an error: {str(exc)}. Please try again later.",
        }
        return {
            "status": "error",
            "content": [{"json": error_data}],
        }
