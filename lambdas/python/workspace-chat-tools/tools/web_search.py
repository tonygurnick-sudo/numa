"""
Web search tool for workspace agent.

Provides comprehensive web search capabilities using multiple search engines
with intelligent fallback strategies for maximum reliability.

Features:
- Multi-engine search with automatic failover (DuckDuckGo API → Startpage → Yahoo)
- Anti-detection measures including user agent rotation and request spacing
- Content scraping with browser-like headers
- Automatic content summarization using Nova Lite

Adapted from numa-chat-agent/tools/web_search.py.
"""

import os
import random
import re
import time
from typing import Any, Dict, List
from urllib.parse import quote_plus, unquote

import httpx
import structlog
from bs4 import BeautifulSoup, Tag
from ddgs import DDGS

from prm import client as prm_client

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
FAST_MODEL_ID = os.getenv("FAST_MODEL_ID", "global.amazon.nova-2-lite-v1:0")

# Static user agent pool with current browser versions
USER_AGENTS = [
    # Desktop — Chrome (Windows)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Safari/537.36",
    # Desktop — Chrome (macOS)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Safari/537.36",
    # Desktop — Chrome (Linux)
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Safari/537.36",
    # Desktop — Firefox (Windows)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
    # Desktop — Firefox (macOS)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6; rv:143.0) Gecko/20100101 Firefox/143.0",
    # Desktop — Safari (macOS)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    # Mobile — iPhone
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    # Mobile — Android
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Mobile Safari/537.36",
]


def _get_random_user_agent() -> str:
    """Get a random user agent from the pool."""
    return random.choice(USER_AGENTS)


def _dedupe(urls: List[str]) -> List[str]:
    """Remove duplicate URLs while preserving order."""
    seen = set()
    result = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            result.append(url)
    return result


def _is_processable_url(url: str) -> bool:
    """Check if URL is processable (http/https and not a binary file)."""
    u = url.lower()
    if not u.startswith(("http://", "https://")):
        return False
    return not u.endswith(
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


def _clean_yahoo_url(url: str) -> str:
    """Clean Yahoo redirect URL to extract the actual destination URL."""
    try:
        if "r.search.yahoo.com" in url or "search.yahoo.com/_ylt" in url:
            if "/RU=" in url:
                ru_part = url.split("/RU=")[1].split("/")[0]
                actual_url = unquote(ru_part)
                if actual_url.startswith("https%3a"):
                    actual_url = unquote(actual_url)
                return actual_url
            elif "RU=" in url:
                ru_part = url.split("RU=")[1].split("&")[0].split("/")[0]
                actual_url = unquote(ru_part)
                if actual_url.startswith("https%3a"):
                    actual_url = unquote(actual_url)
                return actual_url
        return url
    except Exception:
        return url


def _duckduckgo_search(query: str, max_results: int) -> List[str]:
    """Search using DuckDuckGo API (primary, most reliable)."""
    try:
        with DDGS() as ddgs:
            results = list(
                ddgs.text(
                    query,
                    region="wt-wt",
                    safesearch="moderate",
                    max_results=max_results,
                    backend="auto",
                )
            )
            urls = []
            for result in results:
                if isinstance(result, dict) and "href" in result:
                    url = result["href"]
                    if isinstance(url, str) and url.startswith("http"):
                        urls.append(url)
            logger.debug("DuckDuckGo search results", query=query, urls_found=len(urls))
            return urls
    except Exception as e:
        logger.warning("DuckDuckGo search error", error=str(e), query=query)
        return []


def _startpage_search(query: str, max_results: int) -> List[str]:
    """Search using Startpage (privacy-focused, uses Google results)."""
    session = None
    try:
        user_agent = _get_random_user_agent()
        accept_lang = random.choice(
            ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-AU,en;q=0.9"]
        )

        session = httpx.Client(
            headers={
                "User-Agent": user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": accept_lang,
                "Connection": "keep-alive",
                "DNT": "1",
            },
            timeout=15.0,
            follow_redirects=True,
        )

        search_url = f"https://www.startpage.com/sp/search?query={quote_plus(query)}"
        response = session.get(search_url)

        if response.status_code in (429, 403):
            logger.warning("Startpage rate limited", status_code=response.status_code)
            return []
        elif response.status_code != 200:
            logger.warning("Startpage search failed", status_code=response.status_code)
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        urls = []

        containers = soup.select("div.result")
        if not containers:
            containers = soup.select('[data-testid="result"]')

        for container in containers[:max_results]:
            title_link = container.find("a", class_=re.compile(r"result-link"))
            if not title_link:
                h3_elem = container.find("h3")
                if h3_elem and isinstance(h3_elem, Tag):
                    title_link = h3_elem.find("a", href=True)
                else:
                    title_link = container.find("a", href=True)

            if title_link and isinstance(title_link, Tag):
                url = title_link.get("href", "")
                if isinstance(url, str) and url and url.startswith("http"):
                    urls.append(url)

        return urls
    except Exception as e:
        logger.warning("Startpage search error", error=str(e))
        return []
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass


def _yahoo_search(query: str, max_results: int) -> List[str]:
    """Search using Yahoo Search (fallback)."""
    session = None
    try:
        user_agent = _get_random_user_agent()
        accept_lang = random.choice(
            ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-AU,en;q=0.9"]
        )

        session = httpx.Client(
            headers={
                "User-Agent": user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": accept_lang,
                "Connection": "keep-alive",
                "DNT": "1",
            },
            timeout=15.0,
            follow_redirects=True,
        )

        search_url = f"https://search.yahoo.com/search?p={quote_plus(query)}"
        response = session.get(search_url)

        if response.status_code in (429, 403):
            logger.warning("Yahoo rate limited", status_code=response.status_code)
            return []
        elif response.status_code != 200:
            logger.warning("Yahoo search failed", status_code=response.status_code)
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        urls = []

        containers: List[Tag] = soup.select("div.compTitle") or []
        if not containers:
            containers = soup.select("div.algo, div.algo-sr, li div.algo") or []
        if not containers:
            containers = soup.select("div.Sr") or []

        for container in containers[:max_results]:
            title_link = None
            direct_links = container.find_all("a", href=True)
            for link in direct_links:
                if isinstance(link, Tag):
                    href = link.get("href", "")
                    if href and "RU=" in href:
                        title_link = link
                        break

            if not title_link:
                h3_elem = container.find("h3")
                if h3_elem and isinstance(h3_elem, Tag):
                    link_elem = h3_elem.find("a", href=True)
                    if isinstance(link_elem, Tag):
                        title_link = link_elem

            if not title_link and direct_links:
                first_link = direct_links[0]
                if isinstance(first_link, Tag):
                    title_link = first_link

            if not title_link or not isinstance(title_link, Tag):
                continue

            raw_url = title_link.get("href", "")
            if not raw_url or not isinstance(raw_url, str):
                continue

            clean_url = _clean_yahoo_url(raw_url)
            if clean_url.startswith("http"):
                urls.append(clean_url)

        return urls
    except Exception as e:
        logger.warning("Yahoo search error", error=str(e))
        return []
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass


# Global state for search spacing
_last_search_time: float = 0.0
_failed_searches_in_row: int = 0


def _google_search(query: str, max_results: int = 3, max_retries: int = 3) -> List[str]:
    """
    Perform web search using reliable search engines with fallback strategy.

    Uses DuckDuckGo as primary, Startpage as secondary, and Yahoo as fallback.
    """
    if not query or not query.strip():
        logger.warning("Empty search query provided")
        return []

    global _last_search_time, _failed_searches_in_row  # pylint: disable=global-statement
    current_time = time.time()

    # Anti-detection delay
    if _last_search_time > 0:
        time_since_last = current_time - _last_search_time
        base_delay = 2.0
        if _failed_searches_in_row > 0:
            base_delay *= min(2**_failed_searches_in_row, 8)
        jittered_delay = base_delay + (random.random() - 0.5) * base_delay * 0.3
        required_delay = max(jittered_delay, 1.0)
        if time_since_last < required_delay:
            sleep_time = required_delay - time_since_last
            logger.info("Anti-detection delay", sleep_time=round(sleep_time, 2))
            time.sleep(sleep_time)

    _last_search_time = time.time()

    logger.info("Starting web search", query=query, max_results=max_results)

    search_engines = [
        ("DuckDuckGo", _duckduckgo_search),
        ("Startpage", _startpage_search),
        ("Yahoo", _yahoo_search),
    ]

    for attempt in range(max_retries):
        for engine_name, search_func in search_engines:
            try:
                logger.info(
                    "Attempting search", engine=engine_name, attempt=attempt + 1
                )
                urls = search_func(query, max_results)
                if urls:
                    _failed_searches_in_row = 0
                    logger.info(
                        "Search completed",
                        engine=engine_name,
                        results_count=len(urls),
                    )
                    return urls
            except Exception as e:
                logger.error("Search engine error", engine=engine_name, error=str(e))

        if attempt < max_retries - 1:
            delay = 1.5 + random.random() * 2.0
            time.sleep(delay)

    _failed_searches_in_row += 1
    logger.error("All search attempts failed", query=query)
    return []


def _scrape_page(url: str) -> Dict[str, Any]:
    """Scrape content from a web page with browser-like headers."""
    if not _is_processable_url(url):
        return {"title": "", "url": url, "snippet": "", "success": False}

    referer_options = [
        "https://www.google.com/",
        "https://www.bing.com/",
        "https://duckduckgo.com/",
    ]

    headers = {
        "User-Agent": _get_random_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": random.choice(["en-US,en;q=0.9", "en-GB,en;q=0.9"]),
        "Connection": "keep-alive",
        "Referer": random.choice(referer_options),
        "DNT": "1",
    }

    client = None
    try:
        client = httpx.Client(headers=headers, timeout=12, follow_redirects=True)
        response = client.get(url)

        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            title = (
                soup.title.string.strip() if soup.title and soup.title.string else ""
            )
            text = soup.get_text(separator=" ", strip=True)
            snippet = text[:10000] if text else ""
            logger.info(
                "Page scraping successful", url=url, content_length=len(snippet)
            )
            return {"title": title, "url": url, "snippet": snippet, "success": True}
        else:
            logger.warning("Scraping failed", url=url, status_code=response.status_code)
            return {"title": "", "url": url, "snippet": "", "success": False}

    except Exception as e:
        logger.warning("Page scraping error", url=url, error=str(e))
        return {"title": "", "url": url, "snippet": "", "success": False}
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass


def _summarize_content(all_content: str, user_intent: str, num_sources: int) -> str:
    """Summarize web content using Nova Lite (fast, cost-effective model)."""
    if not all_content.strip():
        return ""

    start_time = time.time()
    logger.info(
        "Starting web content summarization",
        model_id=FAST_MODEL_ID,
        content_length=len(all_content),
        num_sources=num_sources,
    )

    bedrock_client = prm_client("bedrock-runtime", region=REGION)

    prompt = f"""You are summarizing web search results for a user query.

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
                    "Web summarization completed",
                    original_length=len(all_content),
                    summary_length=len(item["text"]),
                    elapsed_ms=round(elapsed_ms, 2),
                )
                return item["text"].strip()

        logger.warning("Summarization returned no text")
        return ""
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "Web summarization failed", error=str(e), elapsed_ms=round(elapsed_ms, 2)
        )
        return ""


def handle_web_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle web_search tool invocation.

    Parameters:
        query (str, required): Natural language search query
        user_intent (str, required): What the user is trying to accomplish
        max_results (int, default=3, max=10): Number of results to scrape

    Returns:
        Dict with summarised_content, references, query, results_count
    """
    query = params.get("query")
    user_intent = params.get("user_intent")

    if not query:
        raise ValueError("Missing required parameter: query")
    if not user_intent:
        raise ValueError("Missing required parameter: user_intent")

    max_results = min(max(1, params.get("max_results", 3)), 10)

    logger.info(
        "Web search starting",
        query=query[:100],
        max_results=max_results,
        user_intent=user_intent[:100],
    )

    # Step 1: Search for URLs
    raw_urls = _google_search(query, max_results, max_retries=3)
    urls = _dedupe(raw_urls)

    if not urls:
        logger.warning("No URLs found", query=query)
        return {
            "summarised_content": "Unable to perform web search. No results found or search services are temporarily unavailable.",
            "references": [],
            "query": query,
            "results_count": 0,
            "error": "No search results found",
        }

    # Step 2: Scrape content from each URL
    results = []
    for url in urls:
        if not _is_processable_url(url):
            continue
        result = _scrape_page(url)
        if result.get("success"):
            results.append(result)
        # Small delay between requests
        time.sleep(0.4 + random.random() * 0.4)

    logger.info(
        "Web scraping complete", urls_found=len(urls), successful_scrapes=len(results)
    )

    if not results:
        return {
            "summarised_content": "Found search results but unable to access the content. Sites may be blocking access.",
            "references": urls,
            "query": query,
            "results_count": 0,
            "error": "Content scraping failed",
        }

    # Step 3: Combine and summarize content
    content_pieces = []
    references = []
    for result in results:
        title = result.get("title", "No title")
        url = result.get("url", "")
        snippet = result.get("snippet", "")
        content_pieces.append(f"Title: {title}\nURL: {url}\nContent: {snippet}")
        references.append(url)

    all_content = "\n\n".join(content_pieces)
    summarised_content = _summarize_content(all_content, user_intent, len(references))

    if not summarised_content:
        # Fallback: return raw snippets
        logger.warning("Summarization failed, returning raw content")
        raw_snippets = []
        for result in results:
            raw_snippets.append(
                {
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "snippet": result.get("snippet", "")[:500],
                }
            )
        return {
            "raw_results": raw_snippets,
            "references": references,
            "query": query,
            "results_count": len(references),
        }

    return {
        "summarised_content": summarised_content,
        "references": references,
        "query": query,
        "results_count": len(references),
    }
