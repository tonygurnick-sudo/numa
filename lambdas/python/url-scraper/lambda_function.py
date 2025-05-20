"""
URL Scraper Lambda Function.

This Lambda scrapes content from provided URLs and uploads them to S3.
It's designed to be called from the frontend to process user-submitted URLs.
"""

# pylint: disable=broad-exception-caught

import json
import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

import boto3
import botocore.exceptions
import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.config import Config
from bs4 import BeautifulSoup

logger = structlog.get_logger()
s3 = boto3.client(
    "s3",
    config=Config(
        signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}
    ),
)


class ScrapeRequest(TypedDict):
    """Type definition for URL scraper request parameters."""

    urls: List[str]
    bucket: str
    prefix: Optional[str]


def sanitise_url_for_s3_key(url: str, prefix: str = "") -> str:
    """
    Convert a URL into a safe S3 key.

    Args:
        url: The URL to convert
        prefix: Optional prefix to add to the key

    Returns:
        A sanitized string suitable for use as an S3 key
    """
    # Ensure prefix is always included
    if not prefix.endswith("/"):
        prefix += "/"

    # Encode URL using standard URL encoding

    key = urllib.parse.quote(url, safe="")

    # Add prefix
    key = f"{prefix}{key}"

    return key


def scrape_page(url: str) -> Optional[Dict[str, str]]:
    """
    Scrape content from a web page.

    Args:
        url: URL of the page to scrape

    Returns:
        Dictionary containing title, URL, and content
    """
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/91.0.4472.124 Safari/537.36"
            )
        }
        response = httpx.get(url, headers=headers, follow_redirects=True, timeout=10)

        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")

            # Extract title
            title = (
                soup.title.string.strip() if soup.title and soup.title.string else ""
            )

            # Remove script and style elements
            for element in soup(["script", "style"]):
                element.decompose()

            # Get text content
            text = soup.get_text(separator="\n", strip=True)

            # Create structured content
            content = f"Title: {title}\nURL: {url}\n\n{text}"

            return {
                "title": title,
                "url": url,
                "content": content,
                "content_type": "text/html",
                "metadata": {
                    "source": url,
                    "scraped_at": datetime.utcnow().isoformat(),
                    "content_type": response.headers.get("content-type", "text/html"),
                },  # type: ignore
            }

        logger.warning("Non-200 status code", url=url, status_code=response.status_code)
        return None

    except Exception as e:
        logger.error("Error scraping page", url=url, error=str(e))
        return None


def upload_to_s3(
    content: str,
    bucket: str,
    key: str,
    metadata: Optional[Dict[str, str]] = None,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Upload content to S3

    Args:
        content: The content to upload
        bucket: The S3 bucket name
        key: The S3 object key
        metadata: Metadata to include with the object
        url: The original URL to include as a tag

    Returns:
        A dictionary containing the upload result
    """
    try:
        # Add URL as a tag if provided
        if url:
            # URL-encode the tag value to handle special characters
            encoded_url = urllib.parse.quote(url, safe="")
            tagging = f"url={encoded_url}"
        else:
            tagging = None

        # Prepare arguments for put_object
        put_args = {
            "Bucket": bucket,
            "Key": key,
            "Body": content,
            "ContentType": "text/html",
            "ContentEncoding": "utf-8",
        }

        # Add metadata if provided
        if metadata is not None:
            put_args["Metadata"] = metadata  # type: ignore

        # Add tagging if provided
        if tagging is not None:
            put_args["Tagging"] = tagging

        # Upload to S3
        s3.put_object(**put_args)

        return {"success": True, "message": "Upload successful"}
    except botocore.exceptions.ClientError as e:
        logger.error("S3 client error", bucket=bucket, key=key, error=str(e))
        return {"success": False, "message": "S3 client error", "error": str(e)}
    except botocore.exceptions.NoCredentialsError as e:
        logger.error("S3 credentials error", bucket=bucket, key=key, error=str(e))
        return {"success": False, "message": "S3 credentials error", "error": str(e)}
    except Exception as e:
        logger.error(
            "Unexpected error uploading to S3", bucket=bucket, key=key, error=str(e)
        )
        return {"success": False, "message": "Unexpected error", "error": str(e)}


def parse_request(event: Dict) -> Dict:
    """
    Parse and validate the incoming request.

    Args:
        event: The Lambda event

    Returns:
        Dict containing:
        - request: The parsed ScrapeRequest if successful
        - headers: HTTP headers for the response
        - error_response: Error response dict if parsing failed, None if successful
    """
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": True,
    }

    try:
        # Handle raw string event
        if isinstance(event, str):
            try:
                event = json.loads(event)
            except json.JSONDecodeError as e:
                logger.error("Failed to parse event as JSON", error=str(e))
                return {
                    "headers": headers,
                    "error_response": {
                        "statusCode": 400,
                        "body": json.dumps(
                            {
                                "error": "Invalid JSON in request body",
                                "details": str(e),
                                "success": False,
                            }
                        ),
                    },
                }

        # Handle CloudFront/ApiGateway event
        if "body" in event:
            try:
                # For CloudFront events, the body is already a string
                if isinstance(event["body"], str):
                    event = json.loads(event["body"])
                # For direct Lambda invocations
                elif isinstance(event["body"], dict):
                    event = event["body"]
                else:
                    logger.error(
                        "Unexpected body type", body_type=str(type(event["body"]))
                    )
                    return {
                        "headers": headers,
                        "error_response": {
                            "statusCode": 400,
                            "body": json.dumps(
                                {
                                    "success": False,
                                    "error": "Invalid request body format",
                                    "details": "Expected string or dict, got "
                                    + str(type(event["body"])),
                                }
                            ),
                        },
                    }
            except (json.JSONDecodeError, TypeError) as e:
                logger.error("Failed to parse request body", error=str(e))
                return {
                    "headers": headers,
                    "error_response": {
                        "statusCode": 400,
                        "body": json.dumps(
                            {
                                "success": False,
                                "error": "Invalid JSON in request body",
                                "details": str(e),
                            }
                        ),
                    },
                }

        request: ScrapeRequest = {
            "urls": event.get("urls", []),
            "bucket": event.get("bucket", ""),
            "prefix": event.get("prefix", ""),
        }

        # Validate required fields
        if not request["bucket"] or not request["urls"]:
            error_msg = (
                "No bucket specified" if not request["bucket"] else "No URLs provided"
            )
            details = (
                "Please specify an S3 bucket to store the scraped content"
                if not request["bucket"]
                else "Please provide at least one URL to scrape"
            )

            if not request["bucket"]:
                logger.error("No bucket specified in request")

            return {
                "headers": headers,
                "error_response": {
                    "statusCode": 400,
                    "body": json.dumps(
                        {"success": False, "error": error_msg, "details": details}
                    ),
                },
            }

        # If we got here, request is valid
        return {"request": request, "headers": headers, "error_response": None}

    except Exception as e:
        logger.error("Error processing request", error=str(e), exc_info=True)
        return {
            "headers": headers,
            "error_response": {
                "statusCode": 500,
                "body": json.dumps(
                    {
                        "success": False,
                        "error": "Internal server error",
                        "details": str(e),
                    }
                ),
            },
        }


# pylint: disable=too-many-return-statements
def process_url(url: str, bucket: str, prefix: str) -> Dict:
    """
    Process a single URL - validate, scrape, and upload to S3.

    Args:
        url: The URL to process
        bucket: S3 bucket to upload to
        prefix: S3 key prefix

    Returns:
        Dict containing the result of processing the URL
    """
    try:
        # Validate URL format
        if not url.startswith(("http://", "https://")):
            logger.warning("Invalid URL format", url=url)
            return {
                "url": url,
                "status": "failed",
                "reason": "Invalid URL format - must start with http:// or https://",
            }

        # Scrape the page
        try:
            scraped = scrape_page(url)
            if not scraped:
                logger.warning("Failed to scrape URL", url=url)
                return {
                    "url": url,
                    "status": "failed",
                    "reason": "Failed to scrape page content",
                }
        except Exception as e:
            logger.error("Error scraping URL", url=url, error=str(e), exc_info=True)
            return {
                "url": url,
                "status": "error",
                "reason": f"Scraping error: {str(e)}",
            }

        try:
            # Generate S3 key with prefix
            s3_key = sanitise_url_for_s3_key(url, prefix)

            # Upload to S3
            upload_result = upload_to_s3(
                content=scraped["content"],
                bucket=bucket,
                key=s3_key,
                metadata={"title": scraped["title"], "timestamp": str(datetime.now())},
                url=url,  # Add URL parameter for tagging
            )

            if upload_result["success"]:
                return {
                    "url": url,
                    "status": "success",
                    "s3_key": s3_key,
                    "title": scraped["title"],
                }

            # If upload was not successful
            logger.error("Failed to upload to S3", bucket=bucket, key=s3_key)
            return {
                "url": url,
                "status": "failed",
                "reason": "Failed to upload content to S3",
            }

        except Exception as e:
            logger.error("Error uploading to S3", url=url, error=str(e), exc_info=True)
            return {
                "url": url,
                "status": "error",
                "reason": f"S3 upload error: {str(e)}",
            }

    except Exception as e:
        logger.error(
            "Unexpected error processing URL", url=url, error=str(e), exc_info=True
        )
        return {"url": url, "status": "error", "reason": f"Unexpected error: {str(e)}"}


def format_response(results: List[Dict], headers: Dict) -> Dict:
    """
    Format the final response based on URL processing results.

    Args:
        results: List of URL processing results
        headers: HTTP headers for the response

    Returns:
        Formatted Lambda response
    """
    # Calculate overall status based on results
    success_count = sum(1 for r in results if r["status"] == "success")
    failed_count = sum(1 for r in results if r["status"] == "failed")
    error_count = sum(1 for r in results if r["status"] == "error")

    # Determine overall status
    if error_count > 0:
        overall_status = "error"
    elif failed_count > 0:
        overall_status = "partial"
    else:
        overall_status = "completed"

    # Prepare response
    response_body = {
        "status": overall_status,
        "results": results,
        "summary": {
            "total": len(results),
            "success": success_count,
            "failed": failed_count,
            "errors": error_count,
        },
        "timestamp": datetime.utcnow().isoformat(),
    }

    return {
        "statusCode": 200,
        "headers": headers,
        "body": json.dumps(response_body),
        "isBase64Encoded": False,
    }


def lambda_handler(event: Dict, _: LambdaContext) -> Dict:
    """
    Lambda handler function for URL scraping.

    Expected event format:
    {
        "urls": ["https://example.com"],
        "bucket": "my-s3-bucket",
        "prefix": "optional/prefix/"
    }
    """

    # Parse and validate the request
    parsed = parse_request(event)

    # If there was an error parsing the request, return early
    if parsed.get("error_response"):
        return {**parsed["error_response"], "headers": parsed["headers"]}

    # Extract the validated request and headers
    request = parsed["request"]
    headers = parsed["headers"]

    # Process each URL
    results = []
    for url in request["urls"]:
        result = process_url(url, request["bucket"], request["prefix"])
        results.append(result)

    # Format and return the response
    return format_response(results, headers)
