"""
Web search module for Numa Chat Agent.

This module provides comprehensive web search capabilities using multiple search engines
with intelligent fallback strategies for maximum reliability and uptime.

Features:
- Multi-engine search with automatic failover (DuckDuckGo API → Startpage → Yahoo)
- DuckDuckGo API integration for primary search (most reliable, API-based)
- Startpage search with privacy-focused Google results (HTML scraping)
- Yahoo search with enhanced CSS selectors and URL cleaning (HTML scraping)
- Anti-detection measures including user agent rotation and request spacing
- Progressive backoff and session-aware rate limiting
- Comprehensive content scraping with browser-like headers
- Automatic content summarization using fast model (Nova 2 Lite)
- Production-ready error handling and logging

Architecture:
1. Search Phase: Try search engines in priority order until results found
2. Scraping Phase: Extract content from discovered URLs with retry logic
3. Summarization Phase: Process content using AI for user consumption
"""

import random
import re
import time
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, unquote

import httpx
import structlog
from bs4 import BeautifulSoup, Tag
from ddgs import DDGS

from ..summarization import summarize_combined_content

logger = structlog.get_logger()

# Static user agent pool (September 2025) with current browser versions
USER_AGENTS_2025_SEP = [
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
    # Desktop — Microsoft Edge (Windows, Chromium-based)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Safari/537.36 Edg/140.0.7339.128",
    # Desktop — Safari (macOS)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    # Mobile — iPhone (Safari on iOS 17.x)
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    # Mobile — iPad (Safari)
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/605.1.15",
    # Mobile — Android (Chrome on Pixel / Android 14+)
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Mobile Safari/537.36",
    # Mobile — Android (Samsung)
    "Mozilla/5.0 (Linux; Android 14; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.128 Mobile Safari/537.36",
]


def _random_chrome_version() -> str:
    """Generate a randomized Chrome version within plausible range."""
    major = 140  # Current stable (Sept 2025)
    minor = 0
    build = random.randint(7330, 7360)  # Slightly narrower, still plausible
    patch = random.randint(60, 180)
    return f"{major}.{minor}.{build}.{patch}"


def _random_edge_version() -> str:
    """Generate a randomized Edge version (typically close to Chrome but not identical)."""
    major = 140
    minor = 0
    build = random.randint(7330, 7360)
    patch = random.randint(50, 170)
    return f"{major}.{minor}.{build}.{patch}"


def _random_firefox_version() -> str:
    """Generate a randomized Firefox version."""
    major = 143  # Current stable
    return f"{major}.0"


def _random_windows() -> str:
    """Generate randomized Windows platform string (Win 11 still reports NT 10.0)."""
    return random.choice(
        [
            "Windows NT 10.0; Win64; x64",
            "Windows NT 10.0; WOW64",
        ]
    )


def _random_mac() -> str:
    """Generate randomized macOS platform string."""
    version = random.choice(["13_6", "13_7", "14_0"])
    return f"Macintosh; Intel Mac OS X {version}"


def _random_android() -> str:
    """Generate randomized Android platform string."""
    devices = [
        "Pixel 8",
        "Pixel 8 Pro",
        "Pixel 7 Pro",
        "SM-S931B",
        "SM-G991B",
        "SM-A546B",
    ]
    return f"Linux; Android 14; {random.choice(devices)}"


def _random_ios() -> str:
    """Generate randomized iOS Safari platform string."""
    ios_ver = random.choice(["17_4", "17_5", "17_6"])
    mobile_build = random.choice(["15E148", "16F203", "17G80"])
    device = random.choice(
        [
            "iPhone; CPU iPhone OS",  # iPhone
            "iPad; CPU OS",  # iPad
        ]
    )
    # Safari on iOS typically: WebKit 605.1.15, Safari/604.1 (legacy token)
    return (
        f"{device} {ios_ver} like Mac OS X) AppleWebKit/605.1.15 "
        f"(KHTML, like Gecko) Version/{ios_ver.replace('_','.')}"
        f" Mobile/{mobile_build} Safari/604.1"
    )


def _generate_random_user_agent() -> str:
    """Generate a randomized user agent with plausible variations."""
    templates = [
        # Desktop Chromium
        "Mozilla/5.0 ({win}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Safari/537.36",
        "Mozilla/5.0 ({mac}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Safari/537.36",
        # Firefox
        "Mozilla/5.0 ({win}; rv:{ff}) Gecko/20100101 Firefox/{ff}",
        "Mozilla/5.0 ({mac}; rv:{ff}) Gecko/20100101 Firefox/{ff}",
        # Edge (Chromium)
        "Mozilla/5.0 ({win}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Safari/537.36 Edg/{edge}",
        # Android Chrome
        "Mozilla/5.0 ({android}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Mobile Safari/537.36",
        # iOS Safari
        "Mozilla/5.0 ({ios}",
    ]

    t = random.choice(templates)
    if "{ios}" in t:
        # Already complete iOS UA (no additional format fields)
        return t.format(ios=_random_ios())

    return t.format(
        win=_random_windows(),
        mac=_random_mac(),
        android=_random_android(),
        chrome=_random_chrome_version(),
        edge=_random_edge_version(),
        ff=_random_firefox_version(),
    )


def _get_random_user_agent() -> str:
    """
    Get a random user agent - mix of static pool and generated variants.

    70% chance of using static pool (reliable), 30% chance of generating
    randomized version (unpredictable). This provides both stability and variety.
    """
    if random.random() < 0.7:
        return random.choice(USER_AGENTS_2025_SEP)
    else:
        return _generate_random_user_agent()


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
    """
    Clean Yahoo redirect URL to extract the actual destination URL.

    Args:
        url: Raw URL from Yahoo search results

    Returns:
        Cleaned URL pointing directly to the destination
    """
    try:
        # Handle multiple Yahoo redirect formats
        if "r.search.yahoo.com" in url or "search.yahoo.com/_ylt" in url:
            if "/RU=" in url:
                # Standard format: /RU=https%3a%2f%2fexample.com/
                ru_part = url.split("/RU=")[1].split("/")[0]
                actual_url = unquote(ru_part)

                # Handle double encoding
                if actual_url.startswith("https%3a"):
                    actual_url = unquote(actual_url)

                return actual_url

            elif "RU=" in url:
                # Alternative format in URL parameters
                ru_part = url.split("RU=")[1].split("&")[0].split("/")[0]
                actual_url = unquote(ru_part)

                # Handle double encoding
                if actual_url.startswith("https%3a"):
                    actual_url = unquote(actual_url)

                return actual_url

        return url
    except Exception:
        # Return original URL if cleaning fails
        return url


def _startpage_search(
    query: str, max_results: int, user_agent: Optional[str] = None
) -> List[str]:
    """
    Search using Startpage (privacy-focused search engine using Google results).

    Args:
        query: Search query string
        max_results: Maximum number of results to return

    Returns:
        List of URLs from search results
    """
    session = None
    try:
        # Use provided user agent or get a random one
        selected_user_agent = user_agent or _get_random_user_agent()

        # Randomize Accept-Language for each search
        accept_lang = random.choice(
            ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-AU,en;q=0.9"]
        )

        session = httpx.Client(
            headers={
                "User-Agent": selected_user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": accept_lang,
                "Connection": "keep-alive",
                "DNT": "1",  # Do Not Track - common in privacy-focused browsers
                "Sec-GPC": "1",  # Global Privacy Control
            },
            timeout=15.0,
            follow_redirects=True,  # Follow redirects for geographic handling
        )

        search_url = f"https://www.startpage.com/sp/search?query={quote_plus(query)}"
        response = session.get(search_url)

        # Handle various response codes
        if response.status_code in (429, 403):
            # Rate limited or forbidden - back off
            backoff_delay = 2 + random.random() * 3
            logger.warning(
                "Startpage rate limited/blocked, backing off",
                status_code=response.status_code,
                delay=round(backoff_delay, 2),
            )
            time.sleep(backoff_delay)
            return []
        elif response.status_code != 200:
            logger.warning("Startpage search failed", status_code=response.status_code)
            return []

        # Check if we got redirected to captcha block
        if "captcha-block" in str(response.url):
            logger.warning("Startpage captcha block detected")
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        urls = []

        # Find result containers - try multiple selectors for robustness
        containers = soup.select("div.result")
        if not containers:
            containers = soup.select('[data-testid="result"]')

        for container in containers[:max_results]:
            # Find title link
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


def _yahoo_search(
    query: str, max_results: int, user_agent: Optional[str] = None
) -> List[str]:
    """
    Search using Yahoo Search.

    Args:
        query: Search query string
        max_results: Maximum number of results to return

    Returns:
        List of cleaned URLs from search results
    """
    session = None
    try:
        # Use provided user agent or get a random one
        selected_user_agent = user_agent or _get_random_user_agent()

        # Randomize Accept-Language for each search
        accept_lang = random.choice(
            ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-AU,en;q=0.9"]
        )

        session = httpx.Client(
            headers={
                "User-Agent": selected_user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": accept_lang,
                "Connection": "keep-alive",
                "DNT": "1",  # Do Not Track - common in privacy-focused browsers
                "Sec-GPC": "1",  # Global Privacy Control
            },
            timeout=15.0,
            follow_redirects=True,
        )

        search_url = f"https://search.yahoo.com/search?p={quote_plus(query)}"
        response = session.get(search_url)

        # Handle various response codes
        if response.status_code in (429, 403):
            # Rate limited or forbidden - back off
            backoff_delay = 2 + random.random() * 3
            logger.warning(
                "Yahoo rate limited/blocked, backing off",
                status_code=response.status_code,
                delay=round(backoff_delay, 2),
            )
            time.sleep(backoff_delay)
            return []
        elif response.status_code != 200:
            logger.warning("Yahoo search failed", status_code=response.status_code)
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        urls = []

        # Find result containers - prioritize current working selectors
        # Note: div.compTitle is the current working selector for Yahoo AU/main results
        containers: List[Tag] = soup.select("div.compTitle") or []

        # If no results from primary selector, try legacy selectors
        if not containers:
            containers = soup.select("div.algo, div.algo-sr, li div.algo") or []

        # Final fallback to older selectors
        if not containers:
            containers = soup.select("div.Sr") or []

        # Log container discovery for debugging
        logger.debug(
            "Yahoo search container analysis",
            containers_found=len(containers),
            content_length=len(response.text),
            query=query,
            selector_used=(
                "div.compTitle"
                if containers and soup.select("div.compTitle")
                else "legacy"
            ),
        )

        for container in containers[:max_results]:
            # For div.compTitle containers, links are directly in the container
            # For legacy containers, look for h3 > a structure
            title_link = None

            # First, try direct link extraction (works for div.compTitle)
            direct_links = container.find_all("a", href=True)
            for link in direct_links:
                if isinstance(link, Tag):
                    href = link.get("href", "")
                    if href and "RU=" in href:  # Yahoo redirect link
                        title_link = link
                        break

            # Fallback to h3 > a structure (legacy selectors)
            if not title_link:
                h3_elem = container.find("h3")
                if h3_elem and isinstance(h3_elem, Tag):
                    link_elem = h3_elem.find("a", href=True)
                    if isinstance(link_elem, Tag):
                        title_link = link_elem

            # Final fallback to any link
            if not title_link and direct_links:
                first_link = direct_links[0]
                if isinstance(first_link, Tag):
                    title_link = first_link

            if not title_link or not isinstance(title_link, Tag):
                continue

            raw_url = title_link.get("href", "")
            if not raw_url or not isinstance(raw_url, str):
                continue

            # Clean Yahoo redirect URL
            clean_url = _clean_yahoo_url(raw_url)
            if clean_url.startswith("http"):
                urls.append(clean_url)

        # Log final results for reliability tracking
        logger.debug(
            "Yahoo search results",
            query=query,
            urls_found=len(urls),
            containers_processed=min(len(containers), max_results),
        )

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


def _duckduckgo_search(
    query: str,
    max_results: int,
    user_agent: Optional[str] = None,  # pylint: disable=unused-argument
) -> List[str]:
    """
    Search using DuckDuckGo API (reliable third fallback).

    Args:
        query: Search query string
        max_results: Maximum number of results to return
        user_agent: Optional user agent string (ignored - DDGS handles this internally)

    Returns:
        List of URLs from search results
    """
    try:
        # Use the official DuckDuckGo search API
        # This is much more reliable than HTML scraping
        with DDGS() as ddgs:
            # Use text search - updated for ddgs v9.6.0 API
            results = list(
                ddgs.text(
                    query,  # First positional argument
                    region="wt-wt",  # Worldwide results
                    safesearch="moderate",
                    max_results=max_results,
                    backend="auto",  # Try all backends for maximum reliability
                )
            )

            urls = []
            for result in results:
                if isinstance(result, dict) and "href" in result:
                    url = result["href"]
                    if isinstance(url, str) and url.startswith("http"):
                        urls.append(url)

            logger.debug(
                "DuckDuckGo search results",
                query=query,
                urls_found=len(urls),
                total_results=len(results),
            )

            return urls

    except Exception as e:
        logger.warning("DuckDuckGo search error", error=str(e), query=query)
        return []


# Global state for search spacing (prevents rapid consecutive searches)
_last_search_time: float = 0.0
_search_count_in_session: int = 0
_failed_searches_in_row: int = 0


def google_search(
    query: str, max_results: int = 3, max_retries: int = 3, force_delay: bool = True
) -> List[str]:
    """
    Perform web search using reliable search engines with fallback strategy.

    This replaces the previous Google search implementation which was being blocked.
    Uses DuckDuckGo API as primary, Startpage (privacy-focused) as secondary, and Yahoo as final fallback.

    Implements anti-detection measures for high-volume searches:
    - Automatic spacing between searches to avoid rate limiting
    - Progressive backoff after failed searches
    - Session-aware request spacing

    Args:
        query: The search query string
        max_results: Maximum number of results to return (default: 3)
        max_retries: Maximum number of retry attempts (default: 3)
        force_delay: Whether to enforce delays between searches (default: True)

    Returns:
        List of URLs from search results
    """
    if not query or not query.strip():
        logger.warning("Empty search query provided")
        return []

    # Anti-detection: implement search spacing for high-volume usage
    # pylint: disable=global-statement
    global _last_search_time, _search_count_in_session, _failed_searches_in_row
    current_time = time.time()

    if force_delay and _last_search_time > 0:
        time_since_last = current_time - _last_search_time

        # Calculate required delay based on session state
        base_delay = 2.0  # Base 2 second delay

        # Increase delay after failed searches (progressive backoff)
        if _failed_searches_in_row > 0:
            backoff_multiplier = min(2**_failed_searches_in_row, 8)  # Cap at 8x
            base_delay *= backoff_multiplier
            logger.info(
                "Progressive backoff active",
                failed_in_row=_failed_searches_in_row,
                backoff_multiplier=backoff_multiplier,
                base_delay=base_delay,
            )

        # Increase delay for rapid searches in same session
        if _search_count_in_session > 1:
            session_multiplier = min(
                1 + (_search_count_in_session - 1) * 0.3, 3.0
            )  # Max 3x
            base_delay *= session_multiplier
            logger.debug(
                "Session-based delay scaling",
                search_count=_search_count_in_session,
                session_multiplier=session_multiplier,
            )

        # Add jitter to avoid predictable patterns
        jittered_delay = base_delay + (random.random() - 0.5) * base_delay * 0.3
        required_delay = max(jittered_delay, 1.0)  # Minimum 1 second

        if time_since_last < required_delay:
            sleep_time = required_delay - time_since_last
            logger.info(
                "Anti-detection delay",
                query=query,
                sleep_time=round(sleep_time, 2),
                session_search_count=_search_count_in_session,
                failed_in_row=_failed_searches_in_row,
            )
            time.sleep(sleep_time)

    _search_count_in_session += 1
    _last_search_time = time.time()

    logger.info(
        "Starting web search with fallback engines",
        query=query,
        max_results=max_results,
        max_retries=max_retries,
    )

    # Search engines to try in order of preference
    search_engines = [
        ("DuckDuckGo", _duckduckgo_search),
        ("Startpage", _startpage_search),
        ("Yahoo", _yahoo_search),
    ]

    for attempt in range(max_retries):
        for engine_name, search_func in search_engines:
            try:
                # Get a fresh random user agent for each attempt
                fresh_user_agent = _get_random_user_agent()
                request_id = str(uuid.uuid4())[:8]  # Short request ID for tracking

                logger.info(
                    "Attempting search",
                    engine=engine_name,
                    query=query,
                    attempt=attempt + 1,
                    request_id=request_id,
                    user_agent=(
                        fresh_user_agent[:50] + "..."
                        if len(fresh_user_agent) > 50
                        else fresh_user_agent
                    ),
                )

                urls = search_func(query, max_results, user_agent=fresh_user_agent)

                if urls:
                    # Reset failure counter on success
                    _failed_searches_in_row = 0
                    logger.info(
                        "Search completed successfully",
                        engine=engine_name,
                        query=query,
                        results_count=len(urls),
                        attempt=attempt + 1,
                        session_search_count=_search_count_in_session,
                    )
                    return urls
                else:
                    logger.warning(
                        "No results from search engine",
                        engine=engine_name,
                        query=query,
                        attempt=attempt + 1,
                    )

            except Exception as e:
                logger.error(
                    "Search engine error",
                    engine=engine_name,
                    query=query,
                    attempt=attempt + 1,
                    error=str(e),
                )

        # Delay between retry attempts (not after last attempt)
        if attempt < max_retries - 1:
            # Randomized delay with jitter (1.5-3.5 seconds)
            delay = 1.5 + random.random() * 2.0
            logger.info(
                "Retrying search after delay",
                query=query,
                attempt=attempt + 1,
                delay_seconds=round(delay, 2),
            )
            time.sleep(delay)

    # Increment failure counter for progressive backoff
    _failed_searches_in_row += 1

    logger.error(
        "All search attempts failed",
        query=query,
        total_attempts=max_retries * len(search_engines),
        failed_searches_in_row=_failed_searches_in_row,
        session_search_count=_search_count_in_session,
    )
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
    referer_options = [
        "https://www.google.com/",
        "https://www.bing.com/",
        "https://duckduckgo.com/",
        "https://www.startpage.com/",
        "https://search.yahoo.com/",
    ]

    # Simulate realistic viewport dimensions
    viewport_width = random.choice([1920, 1366, 1536, 1440, 1280, 2560])

    base_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": random.choice(
            ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-AU,en;q=0.9"]
        ),
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Referer": random.choice(referer_options),
        "DNT": "1",  # Do Not Track - privacy-conscious behavior
        "Sec-GPC": "1",  # Global Privacy Control
        "Cache-Control": random.choice(
            ["no-cache", "max-age=0"]
        ),  # Vary caching behavior
        "Viewport-Width": str(viewport_width),  # Simulate browser viewport
        # Removed: Accept-Encoding (let httpx negotiate), Sec-Fetch-* (browser-generated)
    }

    # Use random user agents for web scraping too
    user_agents = [_get_random_user_agent(), _get_random_user_agent()]
    # Reuse client per user agent for cookie persistence
    clients = {}

    def attempt_scrape(url: str, user_agent: str, timeout: int = 12) -> Dict[str, Any]:
        """Single scraping attempt with detailed error tracking"""
        headers = {**base_headers, "User-Agent": user_agent}
        try:
            # Get or create client for this user agent
            if user_agent not in clients:
                clients[user_agent] = httpx.Client(
                    headers=headers, timeout=timeout, follow_redirects=True
                )

            client = clients[user_agent]
            response = client.get(url)

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

    try:
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
                    # Jittered delay before retry (0.8-1.2s)
                    time.sleep(0.8 + random.random() * 0.4)
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

    finally:
        # Clean up clients after all attempts
        for client in clients.values():
            try:
                client.close()
            except Exception:
                pass


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
        raw_urls = google_search(query, max_results, max_retries=3)
        urls = _dedupe(raw_urls)

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

            # Small randomized delay between requests (0.4-1.2s)
            time.sleep(0.4 + random.random() * 0.8)

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

        # Create summary using fast model
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
