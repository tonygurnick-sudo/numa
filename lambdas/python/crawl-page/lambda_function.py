"""
Crawl-Page Lambda Function.

This Lambda scrapes content from a URL, uploads it to S3, and discovers links.
It's the second step in the web crawler Step Function workflow.
"""

from __future__ import annotations

import asyncio
import os
import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, TypedDict
from urllib.parse import urldefrag, urljoin, urlparse

import boto3
import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from bs4 import BeautifulSoup, Tag


class CrawlPageEvent(TypedDict, total=False):
    """Type definition for the Crawl Page Lambda event."""

    url: str
    crawlDepth: int
    userId: str
    title: str


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/91.0.4472.124 Safari/537.36"
)
HTTP_TIMEOUT_SECONDS = 8
MAX_CONTENT_BYTES = 5_242_880  # 5 MiB
MAX_SAME_HOST_LINKS = 40  # Maximum number of same-host links to collect


logger = structlog.get_logger()
s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


class ScrapedContent(TypedDict):
    title: str
    url: str
    content: str
    content_type: str
    metadata: Dict[str, str]
    links: List[str]


def _parse_html(html: str, url: str) -> tuple[str, str, List[str]]:
    """Return (title, cleaned_text, links) from raw HTML."""
    soup = BeautifulSoup(html, "html.parser")

    title = soup.title.string.strip() if soup.title and soup.title.string else ""

    # Remove scripts / styles then get plain text
    for element in soup(["script", "style"]):
        element.decompose()
    text = soup.get_text(separator="\n", strip=True)

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
        ):
            same_host_links.append(link)
            if len(same_host_links) >= MAX_SAME_HOST_LINKS:
                break

    return title, text, same_host_links


def sanitise_url_for_s3_key(url: str, prefix: str = "") -> str:
    """Convert a URL into a safe S3 key, organized by domain."""
    if prefix and not prefix.endswith("/"):
        prefix += "/"

    parsed = urlparse(url)
    domain = parsed.netloc

    domain_prefix = f"{prefix}{domain}/"

    return f"{domain_prefix}{urllib.parse.quote(url, safe='')}"


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


async def fetch_page(url: str) -> Optional[ScrapedContent]:
    """Download *url* and return structured information or None on error."""
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            r = await client.get(
                url, headers={"User-Agent": USER_AGENT}, follow_redirects=True
            )

        if r.status_code != 200:
            logger.warning("Non-200 status code", url=url, status_code=r.status_code)
            return None

        if int(r.headers.get("content-length", 0)) > MAX_CONTENT_BYTES:
            logger.warning("Content too large", url=url)
            return None

        title, text, links = _parse_html(r.text, url)
        content = f"Title: {title}\nURL: {url}\n\n{text}"

        return {
            "title": title,
            "url": url,
            "content": content,
            "content_type": "text/html",
            "metadata": {
                "source": url,
                "scraped_at": datetime.utcnow().isoformat(),
                "content_type": r.headers.get("content-type", "text/html"),
            },
            "links": links,
        }

    except Exception as exc:  # noqa: BLE001
        logger.error("Error fetching page", url=url, error=str(exc), exc_info=True)
        return None


def enqueue_links(
    links: Sequence[str], user_id: str, current_depth: int, table_name: str
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
            table.put_item(
                Item={
                    "userId": user_id,
                    "url": link,
                    "title": link,
                    "crawlDepth": new_depth,
                    "status": "pending",
                    "createdAt": now,
                    "updatedAt": now,
                    "pagesAttempted": 0,
                    "pagesSuccessful": 0,
                    "linksEnqueued": 0,
                },
                ConditionExpression="attribute_not_exists(#url)",
                ExpressionAttributeNames={"#url": "url"},
            )
            enqueued += 1
            logger.debug("Enqueued link", url=link, depth=new_depth)
        except ClientError as e:  # noqa: BLE001
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code != "ConditionalCheckFailedException":
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
            ContentType="text/html",
            ContentEncoding="utf-8",
            Metadata=_sanitize_metadata(metadata),
        )
        return {"success": True, "message": "Upload successful"}  # unchanged
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Unexpected error uploading to S3", bucket=bucket, key=key, error=str(exc)
        )
        return {"success": False, "message": "Unexpected error", "error": str(exc)}


async def process_url(
    *,
    url: str,
    bucket: str,
    table_name: str,
    user_id: str,
    crawl_depth: int,
    prefix: str,
) -> Dict[str, Any]:
    """Fetch, store, and enqueue a single URL."""
    start = datetime.utcnow()

    # Normalize URL by adding https:// if no protocol is present
    if not url.startswith(("http://", "https://")):
        url = f"https://{url.lstrip('/')}"
        logger.info(
            "URL normalized with https:// prefix", original_url=url, normalized_url=url
        )

    scraped = await fetch_page(url)
    if not scraped:
        return {
            "url": url,
            "status": "failed",
            "reason": "Failed to fetch page content",
            "links_enqueued": 0,
        }

    s3_key = sanitise_url_for_s3_key(url, prefix)
    content = scraped.get("content", "")
    title = scraped.get("title", "")

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

    links_enqueued = (
        enqueue_links(scraped.get("links", []), user_id, crawl_depth, table_name)
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
          "crawl_depth": 3,
          "user_id": "user123"
        }
    """
    logger.info("Received event", input=event)

    try:
        env = _get_required_env("BUCKET_NAME", "TABLE_NAME")
    except KeyError as exc:
        return {
            "status": "error",
            "message": str(exc),
            "url": event.get("url", "unknown"),
        }

    url = event.get("url")
    if not url:
        return {"status": "error", "message": "URL is missing from the event"}

    crawl_depth = int(event.get("crawlDepth", 1))
    user_id = event.get("userId", "anonymous")
    # Use a consistent prefix for all web crawler content
    prefix = "web-crawler/"

    try:
        result = asyncio.run(
            process_url(
                url=url,
                bucket=env["BUCKET_NAME"],
                table_name=env["TABLE_NAME"],
                user_id=user_id,
                crawl_depth=crawl_depth,
                prefix=prefix,
            )
        )
        return {
            **event,
            "process_result": result,
            "pagesAttempted": 1,
            "pagesSuccessful": 1 if result["status"] == "success" else 0,
            "linksEnqueued": result.get("links_enqueued", 0),
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Error in handler", error=str(exc), exc_info=True)
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
