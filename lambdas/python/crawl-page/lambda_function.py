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
import urllib.parse
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence, TypedDict
from urllib.parse import urldefrag, urljoin, urlparse

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
MAX_SAME_HOST_LINKS = 40  # Maximum number of same-host links to collect

# File streaming constants
CHUNK_SIZE = 8 * 1024 * 1024  # 8MB chunks for faster downloads
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB limit

# Supported file types for knowledge base ingestion
EXTRACTABLE_FILE_TYPES = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
}


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


async def fetch_page(
    url: str,
    limit_to_path: bool = True,
    seed_url_prefix: Optional[str] = None,
) -> Optional[ScrapedContent]:
    """Download *url* and return structured information or None on error."""
    user_agents = [PRIMARY_USER_AGENT, FALLBACK_USER_AGENT]

    for attempt, user_agent in enumerate(user_agents, 1):
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                r = await client.get(
                    url, headers={"User-Agent": user_agent}, follow_redirects=True
                )

            if r.status_code == 200:
                # Process content immediately inside the successful attempt
                try:
                    if int(r.headers.get("content-length", 0)) > MAX_CONTENT_BYTES:
                        logger.warning("Content too large", url=url)
                        return None

                    title, text, links = _parse_html(
                        r.text, url, limit_to_path, seed_url_prefix
                    )
                    content = f"Title: {title}\nURL: {url}\n\n{text}"

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
                        "content_type": "text/html",
                        "metadata": {
                            "source": url,
                            "scraped_at": datetime.utcnow().isoformat(),
                            "content_type": r.headers.get("content-type", "text/html"),
                        },
                        "links": links,
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

            table.put_item(Item=item)
            enqueued += 1
            logger.debug("Enqueued link", url=link, depth=new_depth)
        except ClientError as e:  # noqa: BLE001
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
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
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
) -> Dict[str, Any]:
    """Download file to S3 via streaming, return metadata."""

    s3_key = sanitise_url_for_s3_key(url, prefix)

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
) -> Dict[str, Any]:
    """Fetch, store, and enqueue a single URL."""
    start = datetime.utcnow()

    # Normalize URL by adding https:// if no protocol is present
    if not url.startswith(("http://", "https://")):
        url = f"https://{url.lstrip('/')}"
        logger.info(
            "URL normalized with https:// prefix", original_url=url, normalized_url=url
        )

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
        )

    # Existing HTML processing logic with path filtering
    scraped = await fetch_page(url, limit_to_path, seed_url_prefix)
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
          "crawl_depth": 3,
          "user_id": "user123"
        }
    """
    logger.info("Received event", input=event)

    try:
        env = _get_required_env("BUCKET_NAME", "TABLE_NAME", "CLIENT_NAME")
    except KeyError as exc:
        return {
            "status": "error",
            "message": str(exc),
            "url": event.get("url", "unknown"),
        }

    # Get preferred knowledge base (optional, defaults to bedrock)
    preferred_kb = os.environ.get("PREFERRED_KNOWLEDGE_BASE", "bedrock")

    url = event.get("url")
    if not url:
        return {"status": "error", "message": "URL is missing from the event"}

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
                bucket=env["BUCKET_NAME"],
                table_name=env["TABLE_NAME"],
                user_id=user_id,
                crawl_depth=crawl_depth,
                prefix=prefix,
                crawl_session_id=crawl_session_id,
                kb_id=kb_id,
                client_name=env["CLIENT_NAME"],
                preferred_kb=preferred_kb,
                limit_to_path=limit_to_path,
                seed_url_prefix=seed_url_prefix,
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
