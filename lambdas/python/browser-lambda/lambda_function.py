"""
Crawl-Page Lambda Function.

This Lambda scrapes content from a URL, uploads it to S3, and discovers links.
It's the second step in the web crawler Step Function workflow.
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import ssl
import time
import urllib.parse
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence, TypedDict
from urllib.parse import urldefrag, urljoin, urlparse

import html2text
import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from bs4 import BeautifulSoup, Tag

from prm import client as prm_client
from prm import resource as prm_resource


class CrawlPageEvent(TypedDict, total=False):
    """Type definition for the Crawl Page Lambda event."""

    url: str
    crawlDepth: int
    userId: str
    title: str
    crawlSessionId: str
    kbId: str
    limitToPath: bool
    seedUrlPrefix: str
    returnContent: bool
    forcePlaywright: bool


# User agents for retry logic
PRIMARY_USER_AGENT = "curl/8.7.1"
FALLBACK_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)

USER_AGENT = PRIMARY_USER_AGENT
HTTP_TIMEOUT_SECONDS = 8
MAX_CONTENT_BYTES = 5_242_880  # 5 MiB
MAX_SAME_HOST_LINKS = 5000  # Maximum number of same-host links to collect

# File streaming constants
CHUNK_SIZE = 8 * 1024 * 1024  # 8MB chunks for faster downloads
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB limit

# SSRF protection: block requests to internal/private networks
BLOCKED_HOSTS = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "metadata.google.internal",
}
BLOCKED_IP_PREFIXES = (
    "10.",
    "172.16.",
    "172.17.",
    "172.18.",
    "172.19.",
    "172.20.",
    "172.21.",
    "172.22.",
    "172.23.",
    "172.24.",
    "172.25.",
    "172.26.",
    "172.27.",
    "172.28.",
    "172.29.",
    "172.30.",
    "172.31.",
    "192.168.",
    "169.254.",  # AWS metadata service + link-local
    "fd",  # IPv6 ULA
)


def _is_blocked_url(url: str) -> bool:
    """Block URLs targeting internal networks, metadata services, or private IPs."""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()

        if host in BLOCKED_HOSTS:
            return True

        if host.startswith(BLOCKED_IP_PREFIXES):
            return True

        # Resolve hostname to check for DNS rebinding to private IPs
        import socket

        try:
            resolved = socket.getaddrinfo(host, None, socket.AF_INET)
            for _, _, _, _, addr in resolved:
                ip = addr[0]
                if ip.startswith(BLOCKED_IP_PREFIXES) or ip in BLOCKED_HOSTS:
                    logger.warning(
                        "DNS resolved to blocked IP", host=host, resolved_ip=ip
                    )
                    return True
        except socket.gaierror:
            pass  # Can't resolve -- let the HTTP client handle the error

        return False
    except Exception:
        return True  # Block on parse failure


# Supported file types for knowledge base ingestion
EXTRACTABLE_FILE_TYPES = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
}

# Minimum word count threshold -- pages with fewer words after httpx extraction
# are candidates for Playwright re-fetch (may be JS-rendered shells)
MIN_CONTENT_WORDS = int(os.environ.get("MIN_CONTENT_WORDS", "50"))

# Markers that indicate a JS-rendered shell rather than genuinely thin content
JS_SHELL_MARKERS = [
    'id="root"',
    'id="app"',
    'id="__next"',
    "__NEXT_DATA__",
    'id="__nuxt"',
    "window.__INITIAL_STATE__",
    "ng-app",
    "data-reactroot",
    'id="svelte"',
    'id="vue-',
    "data-v-",
]

# Playwright configuration
PLAYWRIGHT_TIMEOUT_MS = 30_000
PLAYWRIGHT_STABILISE_MAX_MS = 20_000
PLAYWRIGHT_STABILISE_QUIET_MS = 1500
PLAYWRIGHT_STABILISE_POLL_MS = 300
PLAYWRIGHT_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--single-process",
]


# Use system CA certs instead of pip-installed certifi (which has missing root CAs)
_ssl_context = ssl.create_default_context()


def _configure_html2text() -> html2text.HTML2Text:
    """Create a configured html2text converter for markdown output."""
    converter = html2text.HTML2Text()
    converter.body_width = 0  # Don't wrap lines
    converter.ignore_links = False
    converter.ignore_images = True
    converter.ignore_emphasis = False
    converter.protect_links = True
    converter.unicode_snob = True
    return converter


_h2t = _configure_html2text()


logger = structlog.get_logger()
s3 = prm_client("s3")
dynamodb = prm_resource("dynamodb")


class ScrapedContent(TypedDict):
    title: str
    url: str
    content: str
    content_type: str
    metadata: Dict[str, str]
    links: List[str]


class FetchHttpError(Exception):
    """Raised when page navigation returns a non-2xx HTTP status."""

    def __init__(self, http_status: int, url: str):
        self.http_status = http_status
        self.url = url
        super().__init__(f"HTTP {http_status} from {url}")


def _url_matches_prefix(url: str, seed_prefix: Optional[str]) -> bool:
    """Check if URL starts with the seed URL prefix.

    Used to limit crawling to pages under the original seed URL path.
    """
    if not seed_prefix:
        return True
    # Normalize: ensure prefix ends without trailing slash for comparison
    normalized_prefix = seed_prefix.rstrip("/")
    # URL must either equal the prefix or start with prefix + "/"
    return url == normalized_prefix or url.startswith(normalized_prefix + "/")


def _parse_html(
    html: str,
    url: str,
    limit_to_path: bool = True,
    seed_url_prefix: Optional[str] = None,
) -> tuple[str, str, List[str]]:
    """Return (title, markdown_text, links) from raw HTML."""
    soup = BeautifulSoup(html, "html.parser")

    title = soup.title.string.strip() if soup.title and soup.title.string else ""

    # Remove scripts / styles before conversion
    for element in soup(["script", "style"]):
        element.decompose()

    # Convert to markdown instead of plain text
    cleaned_html = str(soup)
    text = _h2t.handle(cleaned_html).strip()

    # Process links with same-host filtering included in the loop
    base_domain = urlparse(url).netloc
    same_host_links: list[str] = []

    # Process all links and collect up to MAX_SAME_HOST_LINKS that match our domain
    for tag in soup.find_all("a", href=True):
        if not isinstance(tag, Tag):
            continue

        href = tag.get("href", "")
        if not isinstance(href, str):
            continue

        link = urldefrag(urljoin(url, href))[0]
        if (
            link
            and urlparse(link).netloc == base_domain
            and link not in same_host_links
            and not link.lower().endswith(
                (
                    ".docx",
                    ".doc",
                    ".xlsx",
                    ".xls",
                    ".pptx",
                    ".ppt",
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
            # Apply path prefix filter if enabled
            and (not limit_to_path or _url_matches_prefix(link, seed_url_prefix))
        ):
            same_host_links.append(link)
            if len(same_host_links) >= MAX_SAME_HOST_LINKS:
                break

    return title, text, same_host_links


def _should_try_playwright(html: str, extracted_text: str) -> bool:
    """Detect if a page would benefit from Playwright rendering.

    Covers two cases:
    1. JS shell: low word count + framework markers (e.g. empty React root div)
    2. JS-enhanced: SSR page with framework markers that likely loads additional
       dynamic content via JavaScript (e.g. NRL.com serves nav/headlines via SSR
       but fixtures, scores, and round data are loaded client-side)

    Framework markers are checked regardless of word count because SSR sites
    often serve partial content that Playwright significantly enriches.
    """
    html_lower = html.lower()

    has_framework_markers = any(
        marker.lower() in html_lower for marker in JS_SHELL_MARKERS
    )

    # Framework markers present -- always try Playwright for richer content
    if has_framework_markers:
        return True

    # No framework markers but very low content -- check for noscript JS warnings
    word_count = len(extracted_text.split())
    if word_count < MIN_CONTENT_WORDS:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for noscript in soup.find_all("noscript"):
            noscript_text = noscript.get_text().lower()
            if "javascript" in noscript_text or "enable js" in noscript_text:
                return True

    return False


async def _wait_for_content_stabilisation(page) -> None:
    """Poll body text length until it stops growing, with a 20s ceiling.

    Replaces a fixed post-goto sleep so static pages exit quickly while
    SPAs that fetch content via XHR get however long they need (up to the
    ceiling) for content to settle.
    """
    start = time.monotonic()
    deadline = start + (PLAYWRIGHT_STABILISE_MAX_MS / 1000)
    quiet_window = PLAYWRIGHT_STABILISE_QUIET_MS / 1000

    last_size = 0
    stable_since: Optional[float] = None

    while time.monotonic() < deadline:
        try:
            current_size = await page.evaluate(
                "document.body ? document.body.innerText.length : 0"
            )
        except Exception:
            current_size = last_size

        if current_size > 0 and current_size == last_size:
            if stable_since is None:
                stable_since = time.monotonic()
            elif time.monotonic() - stable_since >= quiet_window:
                logger.info(
                    "Content stabilised",
                    elapsed_ms=round((time.monotonic() - start) * 1000),
                    final_size=current_size,
                )
                return
        else:
            stable_since = None
            last_size = current_size

        await page.wait_for_timeout(PLAYWRIGHT_STABILISE_POLL_MS)

    logger.info(
        "Content stabilisation hit ceiling",
        elapsed_ms=round((time.monotonic() - start) * 1000),
        final_size=last_size,
    )


async def fetch_page_playwright(
    url: str,
    limit_to_path: bool = True,
    seed_url_prefix: Optional[str] = None,
) -> Optional[ScrapedContent]:
    """Fetch a page using Playwright for JS-rendered content."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.error("Playwright not installed, cannot render JS content")
        return None

    browser = None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=PLAYWRIGHT_ARGS,
            )
            page = await browser.new_page(
                user_agent=FALLBACK_USER_AGENT,
            )

            response = await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=PLAYWRIGHT_TIMEOUT_MS,
            )
            await _wait_for_content_stabilisation(page)

            if response is None:
                logger.warning("Playwright navigation returned no response", url=url)
                return None
            if response.status != 200:
                logger.warning(
                    "Playwright non-200 status",
                    url=url,
                    status=response.status,
                )
                raise FetchHttpError(response.status, url)

            html = await page.content()
            # Strip <noscript> tags -- JS has already executed, noscript fallbacks are noise
            pw_soup = BeautifulSoup(html, "html.parser")
            for ns in pw_soup.find_all("noscript"):
                ns.decompose()
            html = str(pw_soup)
            title, text, links = _parse_html(html, url, limit_to_path, seed_url_prefix)
            content = f"# {title}\n\nURL: {url}\n\n{text}"

            logger.info(
                "Playwright fetch successful",
                url=url,
                content_length=len(content),
                word_count=len(text.split()),
            )

            return {
                "title": title,
                "url": url,
                "content": content,
                "content_type": "text/markdown",
                "metadata": {
                    "source": url,
                    "scraped_at": datetime.utcnow().isoformat(),
                    "content_type": "text/html",
                    "renderer": "playwright",
                },
                "links": links,
            }

    except FetchHttpError:
        raise
    except Exception as exc:
        logger.error(
            "Playwright fetch failed",
            url=url,
            error=str(exc),
            exc_info=True,
        )
        return None
    finally:
        if browser:
            await browser.close()


def sanitise_url_for_s3_key(
    url: str, prefix: str = "", seed_url: Optional[str] = None
) -> str:
    """Convert a URL into a safe S3 key, organized by seed URL.

    When seed_url is provided, the folder structure uses the seed URL's
    domain + path (e.g. ``www.nrl.com/draw/``). This groups all pages from
    a single crawl together. Falls back to the target URL's domain if no
    seed URL is given.
    """
    if prefix and not prefix.endswith("/"):
        prefix += "/"

    if seed_url:
        parsed = urlparse(seed_url)
        # domain + path, stripped of trailing slash, then re-added
        folder = f"{parsed.netloc}{parsed.path}".rstrip("/")
    else:
        folder = urlparse(url).netloc

    return f"{prefix}{folder}/{urllib.parse.quote(url, safe='')}"


def _sanitize_metadata(meta: Optional[Dict[str, str]]) -> Dict[str, str]:
    """Coerce metadata dict to ASCII-only strings (S3 requirement)."""
    if not meta:
        return {}
    sanitized: Dict[str, str] = {}
    for k, v in meta.items():
        s = str(v)
        try:
            s.encode("ascii")
            sanitized[k] = s
        except UnicodeEncodeError:
            sanitized[k] = s.encode("ascii", "replace").decode("ascii")
    return sanitized


def _get_required_env(*names: str) -> Dict[str, str]:
    """Ensure required env-vars exist, else raise KeyError with details."""
    missing: List[str] = [n for n in names if n not in os.environ or not os.environ[n]]
    if missing:
        raise KeyError(f"Missing required environment variables: {', '.join(missing)}")
    return {n: os.environ[n] for n in names}


async def fetch_page(
    url: str,
    limit_to_path: bool = True,
    seed_url_prefix: Optional[str] = None,
) -> Optional[ScrapedContent]:
    """Download *url* and return structured information or None on error."""
    user_agents = [PRIMARY_USER_AGENT, FALLBACK_USER_AGENT]

    for attempt, user_agent in enumerate(user_agents, 1):
        try:
            async with httpx.AsyncClient(
                timeout=HTTP_TIMEOUT_SECONDS, verify=_ssl_context
            ) as client:
                r = await client.get(
                    url, headers={"User-Agent": user_agent}, follow_redirects=True
                )

            if r.status_code == 200:
                # Process content immediately inside the successful attempt
                try:
                    if int(r.headers.get("content-length", 0)) > MAX_CONTENT_BYTES:
                        logger.warning("Content too large", url=url)
                        return None

                    raw_html = r.text
                    title, text, links = _parse_html(
                        raw_html, url, limit_to_path, seed_url_prefix
                    )
                    content = f"# {title}\n\nURL: {url}\n\n{text}"

                    if attempt > 1:
                        logger.info(
                            "Retry successful",
                            url=url,
                            attempt=attempt,
                            user_agent=user_agent,
                        )

                    return {
                        "title": title,
                        "url": url,
                        "content": content,
                        "content_type": "text/markdown",
                        "metadata": {
                            "source": url,
                            "scraped_at": datetime.utcnow().isoformat(),
                            "content_type": r.headers.get("content-type", "text/html"),
                        },
                        "links": links,
                        "_raw_html": raw_html,
                    }

                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "Error processing page content",
                        url=url,
                        error=str(exc),
                        exc_info=True,
                    )
                    return None
            else:
                logger.warning(
                    "Non-200 status code",
                    url=url,
                    status_code=r.status_code,
                    attempt=attempt,
                    user_agent=user_agent,
                )
                if attempt == len(user_agents):
                    return None
                continue  # Try next user agent

        except Exception as exc:
            logger.error(
                "Error in fetch attempt",
                url=url,
                attempt=attempt,
                user_agent=user_agent,
                error=str(exc),
            )
            if attempt == len(user_agents):
                return None
            continue

    # This should never be reached, but added for safety
    return None


def enqueue_links(
    links: Sequence[str],
    user_id: str,
    current_depth: int,
    table_name: str,
    crawl_session_id: str,
    kb_id: str = "company",
    limit_to_path: bool = True,
    seed_url_prefix: Optional[str] = None,
) -> int:
    """Push *links* into DynamoDB with decremented depth; returns count enqueued."""
    if current_depth <= 1:
        return 0

    table = dynamodb.Table(table_name)
    now = datetime.utcnow().isoformat()
    new_depth = current_depth - 1
    enqueued = 0

    for link in links:
        try:
            item = {
                "userId": user_id,
                "url": link,
                "title": link,
                "crawlDepth": new_depth,
                "crawlSessionId": crawl_session_id,
                "kbId": kb_id,
                "isSeedUrl": False,
                "limitToPath": limit_to_path,
                "status": "pending",
                "createdAt": now,
                "updatedAt": now,
                "pagesAttempted": 0,
                "pagesSuccessful": 0,
                "linksEnqueued": 0,
            }
            # Propagate seedUrlPrefix to child URLs for consistent filtering
            if seed_url_prefix:
                item["seedUrlPrefix"] = seed_url_prefix

            table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(userId)",
            )
            enqueued += 1
            logger.debug("Enqueued link", url=link, depth=new_depth)
        except ClientError as e:
            # ConditionalCheckFailedException means URL already exists -- skip silently
            if (
                e.response.get("Error", {}).get("Code")
                == "ConditionalCheckFailedException"
            ):
                logger.debug("Link already queued, skipping", url=link)
            else:
                logger.error("Error enqueueing link", link=link, error=str(e))

    return enqueued


def upload_to_s3(
    *, content: str, bucket: str, key: str, metadata: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Upload *content* to S3, returning a success / failure dict."""
    try:
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType="text/markdown",
            ContentEncoding="utf-8",
            Metadata=_sanitize_metadata(metadata),
        )
        return {"success": True, "message": "Upload successful"}  # unchanged
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Unexpected error uploading to S3", bucket=bucket, key=key, error=str(exc)
        )
        return {"success": False, "message": "Unexpected error", "error": str(exc)}


def create_metadata_sidecar(
    bucket: str,
    key: str,
    kb_id: str,
    tenant_id: str,
    preferred_kb: str = "bedrock",
    uploader_id: str = "web-crawler",
) -> bool:
    """Create .metadata.json sidecar file for Bedrock KB filtering.

    This creates a sidecar file alongside uploaded content that Bedrock KB uses
    for metadata filtering. The sidecar contains tenant_id and kb_id attributes
    that enable proper isolation of search results.

    For Q Business clients, skips metadata creation for company KB since Q doesn't
    use metadata sidecars and they can cause indexing issues.
    """
    # Skip metadata for Q Business company KB (Q doesn't use sidecars)
    if preferred_kb == "q" and kb_id == "company":
        logger.debug(
            "Skipping metadata sidecar for Q Business company KB", key=key, kb_id=kb_id
        )
        return True  # Return success (no-op is intentional)

    metadata_key = f"{key}.metadata.json"
    metadata_payload = {
        "metadataAttributes": {
            "tenant_id": tenant_id,
            "kb_id": kb_id,
            "uploader_id": uploader_id,
            "uploaded_at": datetime.utcnow().isoformat(),
        }
    }
    try:
        s3.put_object(
            Bucket=bucket,
            Key=metadata_key,
            Body=json.dumps(metadata_payload, indent=2),
            ContentType="application/json",
        )
        logger.debug("Created metadata sidecar", key=key, metadata_key=metadata_key)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Failed to create metadata sidecar", key=key, error=str(exc), exc_info=True
        )
        return False


async def _stream_chunks(response, chunk_size: int) -> AsyncIterator[bytes]:
    """Stream HTTP response in chunks."""
    async for chunk in response.aiter_bytes(chunk_size):
        yield chunk


async def stream_url_to_s3(
    url: str,
    bucket: str,
    key: str,
    max_size: int = MAX_FILE_SIZE,
    content_type: str = "application/octet-stream",
) -> Dict[str, Any]:
    """Stream URL content directly to S3 without loading into memory."""

    user_agents = [PRIMARY_USER_AGENT, FALLBACK_USER_AGENT]

    for attempt, user_agent in enumerate(user_agents, 1):
        try:
            async with httpx.AsyncClient(
                timeout=HTTP_TIMEOUT_SECONDS, verify=_ssl_context
            ) as client:
                async with client.stream(
                    "GET", url, headers={"User-Agent": user_agent}
                ) as response:

                    if response.status_code != 200:
                        logger.warning(
                            "Non-200 status code in file download",
                            url=url,
                            status_code=response.status_code,
                            attempt=attempt,
                            user_agent=user_agent,
                        )
                        if attempt == len(user_agents):
                            return {
                                "success": False,
                                "error": f"HTTP {response.status_code}",
                            }
                        continue  # Try next user agent

                # Check content length if provided
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > max_size:
                    return {
                        "success": False,
                        "error": f"File too large: {content_length} bytes",
                    }

                # Use S3 multipart upload for streaming
                upload_id = s3.create_multipart_upload(
                    Bucket=bucket,
                    Key=key,
                    ContentType=response.headers.get("content-type", content_type),
                )["UploadId"]

                parts = []
                part_number = 1
                total_size = 0

                try:
                    async for chunk in _stream_chunks(response, CHUNK_SIZE):
                        total_size += len(chunk)

                        # Safety check during streaming
                        if total_size > max_size:
                            # Abort upload and cleanup
                            s3.abort_multipart_upload(
                                Bucket=bucket, Key=key, UploadId=upload_id
                            )
                            return {
                                "success": False,
                                "error": f"File exceeded size limit: {total_size} bytes",
                            }

                        # Upload part
                        part_response = s3.upload_part(
                            Bucket=bucket,
                            Key=key,
                            PartNumber=part_number,
                            UploadId=upload_id,
                            Body=chunk,
                        )

                        parts.append(
                            {"ETag": part_response["ETag"], "PartNumber": part_number}
                        )
                        part_number += 1

                    # Complete multipart upload
                    s3.complete_multipart_upload(
                        Bucket=bucket,
                        Key=key,
                        UploadId=upload_id,
                        MultipartUpload={"Parts": parts},
                    )

                    if attempt > 1:
                        logger.info(
                            "File download retry successful",
                            url=url,
                            attempt=attempt,
                            user_agent=user_agent,
                        )

                    return {
                        "success": True,
                        "file_size": total_size,
                        "parts_uploaded": len(parts),
                    }

                except Exception as e:
                    # Cleanup on error
                    s3.abort_multipart_upload(
                        Bucket=bucket, Key=key, UploadId=upload_id
                    )
                    raise e

        except Exception as e:
            logger.error(
                "Error in file download attempt",
                url=url,
                attempt=attempt,
                user_agent=user_agent,
                error=str(e),
            )
            if attempt == len(user_agents):
                return {"success": False, "error": str(e)}
            continue

    return {"success": False, "error": "All download attempts failed"}


async def process_file_url(
    url: str,
    bucket: str,
    user_id: str,
    prefix: str,
    crawl_session_id: str,
    kb_id: str,
    client_name: str,
    preferred_kb: str = "bedrock",
    seed_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Download file to S3 via streaming, return metadata."""

    s3_key = sanitise_url_for_s3_key(url, prefix, seed_url=seed_url)

    # Stream download to S3
    upload_result = await stream_url_to_s3(url, bucket, s3_key)

    if not upload_result["success"]:
        return {
            "url": url,
            "status": "failed",
            "reason": f"Download failed: {upload_result['error']}",
            "links_enqueued": 0,
        }

    # Create metadata sidecar for Bedrock KB filtering
    create_metadata_sidecar(
        bucket=bucket,
        key=s3_key,
        kb_id=kb_id,
        tenant_id=client_name,
        preferred_kb=preferred_kb,
    )

    file_extension = pathlib.Path(url).suffix.lower()

    logger.info(
        "File download completed",
        url=url,
        user_id=user_id,
        crawl_session_id=crawl_session_id,
        file_type=file_extension,
        file_size=upload_result["file_size"],
    )

    return {
        "url": url,
        "status": "success",
        "s3_key": s3_key,
        "file_type": file_extension,
        "file_size": upload_result["file_size"],
        "links_enqueued": 0,
    }


async def process_url(
    *,
    url: str,
    bucket: str,
    table_name: str,
    user_id: str,
    crawl_depth: int,
    prefix: str,
    crawl_session_id: str,
    kb_id: str = "company",
    client_name: str,
    preferred_kb: str = "bedrock",
    limit_to_path: bool = True,
    seed_url_prefix: Optional[str] = None,
    return_content: bool = False,
    force_playwright: bool = False,
) -> Dict[str, Any]:
    """Fetch, store, and enqueue a single URL."""
    start = datetime.utcnow()

    # Normalize URL by adding https:// if no protocol is present
    if not url.startswith(("http://", "https://")):
        url = f"https://{url.lstrip('/')}"
        logger.info(
            "URL normalized with https:// prefix", original_url=url, normalized_url=url
        )

    # SSRF protection: block internal/private network URLs
    if _is_blocked_url(url):
        logger.warning("Blocked URL targeting internal network", url=url)
        return {
            "url": url,
            "status": "failed",
            "reason": "URL targets an internal or private network address",
            "links_enqueued": 0,
        }

    # File type detection - route to appropriate handler
    file_extension = pathlib.Path(url).suffix.lower()

    if file_extension in EXTRACTABLE_FILE_TYPES:
        # Route to file download handler
        return await process_file_url(
            url,
            bucket,
            user_id,
            prefix,
            crawl_session_id,
            kb_id,
            client_name,
            preferred_kb,
            seed_url=seed_url_prefix,
        )

    # Fetch page content -- Playwright-first or httpx-first with fallback
    scraped: Optional[ScrapedContent] = None
    http_status_failure: Optional[int] = None

    try:
        if force_playwright:
            logger.info("Force Playwright mode", url=url)
            scraped = await fetch_page_playwright(url, limit_to_path, seed_url_prefix)
        else:
            scraped = await fetch_page(url, limit_to_path, seed_url_prefix)

            # Check if the page would benefit from Playwright rendering
            if scraped:
                raw_html = scraped.pop("_raw_html", "")
                content_text = scraped.get("content", "")
                if _should_try_playwright(raw_html, content_text):
                    logger.info(
                        "JS-rendered or JS-enhanced page detected, retrying with Playwright",
                        url=url,
                        word_count=len(content_text.split()),
                    )
                    try:
                        playwright_result = await fetch_page_playwright(
                            url, limit_to_path, seed_url_prefix
                        )
                        if playwright_result:
                            scraped = playwright_result
                    except FetchHttpError as e:
                        # Playwright fallback failed but httpx result is still valid
                        logger.info(
                            "Playwright fallback failed; keeping httpx result",
                            url=url,
                            http_status=e.http_status,
                        )
    except FetchHttpError as e:
        http_status_failure = e.http_status

    if not scraped:
        failure: Dict[str, Any] = {
            "url": url,
            "status": "failed",
            "reason": (
                f"HTTP {http_status_failure} from origin"
                if http_status_failure is not None
                else "Failed to fetch page content"
            ),
            "links_enqueued": 0,
        }
        if http_status_failure is not None:
            failure["http_status"] = http_status_failure
        return failure

    content = scraped.get("content", "")
    title = scraped.get("title", "")

    # Direct content return mode -- skip S3/DynamoDB, return content in response
    if return_content:
        duration = (datetime.utcnow() - start).total_seconds()
        return {
            "url": url,
            "status": "success",
            "content": content,
            "title": title,
            "contentType": "text/markdown",
            "processing_duration": duration,
        }

    s3_key = sanitise_url_for_s3_key(url, prefix, seed_url=seed_url_prefix)

    upload_res = upload_to_s3(
        content=content,
        bucket=bucket,
        key=s3_key,
        metadata={
            "title": title,
            "timestamp": datetime.utcnow().isoformat(),
            "crawlDepth": str(crawl_depth),
        },
    )
    if not upload_res["success"]:
        return {
            "url": url,
            "status": "failed",
            "reason": "Failed to upload content to S3",
            "links_enqueued": 0,
        }

    # Create metadata sidecar for Bedrock KB filtering
    create_metadata_sidecar(
        bucket=bucket,
        key=s3_key,
        kb_id=kb_id,
        tenant_id=client_name,
        preferred_kb=preferred_kb,
    )

    links_enqueued = (
        enqueue_links(
            scraped.get("links", []),
            user_id,
            crawl_depth,
            table_name,
            crawl_session_id,
            kb_id,
            limit_to_path,
            seed_url_prefix,
        )
        if crawl_depth > 1
        else 0
    )

    duration = (datetime.utcnow() - start).total_seconds()
    logger.info(
        "Page processing completed",
        url=url,
        duration_seconds=duration,
        links_found=len(scraped.get("links", [])),
        links_enqueued=links_enqueued,
    )
    return {
        "url": url,
        "status": "success",
        "s3_key": s3_key,
        "title": title,
        "links_enqueued": links_enqueued,
        "processing_duration": duration,
    }


def handler(event: CrawlPageEvent, _: LambdaContext) -> Dict[str, Any]:
    """
    Expected *event* (min):

        {
          "url": "https://example.com",
          "crawlDepth": 3,
          "userId": "user123"
        }

    Direct content return mode (for web search):

        {
          "url": "https://example.com",
          "returnContent": true,
          "forcePlaywright": true
        }
    """
    logger.info("Received event", input=event)

    return_content = event.get("returnContent", False)
    force_playwright = event.get("forcePlaywright", False)

    url = event.get("url")
    if not url:
        return {"status": "error", "message": "URL is missing from the event"}

    # S3/DynamoDB env vars only required for crawler mode (not returnContent)
    if return_content:
        client_name = os.environ.get("CLIENT_NAME", "unknown")
        bucket = ""
        table_name = ""
    else:
        try:
            env = _get_required_env("BUCKET_NAME", "TABLE_NAME", "CLIENT_NAME")
        except KeyError as exc:
            return {
                "status": "error",
                "message": str(exc),
                "url": url,
            }
        client_name = env["CLIENT_NAME"]
        bucket = env["BUCKET_NAME"]
        table_name = env["TABLE_NAME"]

    # Get preferred knowledge base (optional, defaults to bedrock)
    preferred_kb = os.environ.get("PREFERRED_KNOWLEDGE_BASE", "bedrock")

    crawl_depth = int(event.get("crawlDepth", 1))
    user_id = event.get("userId", "anonymous")
    crawl_session_id = event.get("crawlSessionId", "unknown")
    kb_id = event.get("kbId", "company")
    limit_to_path = event.get("limitToPath", True)
    seed_url_prefix = event.get("seedUrlPrefix")

    # Use KB-aware prefix for web crawler content
    if kb_id == "company":
        prefix = "documents/company/web-crawler/"
    else:
        prefix = f"documents/kb-{kb_id}/web-crawler/"

    try:
        result = asyncio.run(
            process_url(
                url=url,
                bucket=bucket,
                table_name=table_name,
                user_id=user_id,
                crawl_depth=crawl_depth,
                prefix=prefix,
                crawl_session_id=crawl_session_id,
                kb_id=kb_id,
                client_name=client_name,
                preferred_kb=preferred_kb,
                limit_to_path=limit_to_path,
                seed_url_prefix=seed_url_prefix,
                return_content=return_content,
                force_playwright=force_playwright,
            )
        )

        # Direct content return mode -- return result directly (not wrapped in event)
        if return_content:
            return result

        return {
            **event,
            "process_result": result,
            "pagesAttempted": 1,
            "pagesSuccessful": 1 if result["status"] == "success" else 0,
            "linksEnqueued": result.get("links_enqueued", 0),
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Error in handler", error=str(exc), exc_info=True)
        if return_content:
            return {
                "url": url,
                "status": "error",
                "reason": f"Handler error: {exc}",
            }
        return {
            **event,
            "process_result": {
                "url": url,
                "status": "error",
                "reason": f"Handler error: {exc}",
                "linksEnqueued": 0,
            },
            "pagesAttempted": 1,
            "pagesSuccessful": 0,
            "linksEnqueued": 0,
        }
