"""Configurable foundation model vision extraction with concurrent PDF processing"""

import base64
import dataclasses
import io
import json
import os
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Semaphore
from typing import Any, Dict, List, Sequence, Union
from urllib.parse import urlparse

import fitz  # type: ignore[import-untyped]  # PyMuPDF
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError
from opentelemetry import trace
from opentelemetry.instrumentation.threading import ThreadingInstrumentor
from PIL import Image

from prm import client as prm_client

tracer = trace.get_tracer(__name__)
ThreadingInstrumentor().instrument()


@dataclasses.dataclass
class DocumentPage:
    page_number: int = 0
    num_words: int = 0
    text: str = ""


@dataclasses.dataclass(frozen=True)
class Document:
    name: str = ""
    num_pages: int = 0
    total_num_words: int = 0
    pages: Sequence[DocumentPage] = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class ModelConfig:
    max_tokens: int = 4096
    max_images_per_call: int = 1
    anthropic_version: Union[str, None] = "bedrock-2023-05-31"


AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Rate limiting constants (balanced for 800 RPM cross-region inference)
MAX_CONCURRENT_WORKERS = 25  # Thread pool size
MAX_BEDROCK_CONCURRENT = 10  # Concurrent Bedrock API calls (semaphore)
CONNECTION_POOL_SIZE = 100  # boto3 connection pool
MAX_RETRIES = 5  # Retry attempts for transient failures

_CROSS_REGION_PREFIX = (
    "apac"
    if AWS_REGION == "ap-southeast-2"
    else "global" if AWS_REGION == "ap-southeast-3" else "us"
)

# Newer Anthropic models (Claude 4.5+) use a different cross-region inference
# profile prefix in ap-southeast-2 (``au.*``) than the older ``apac.*`` used
# by Claude 3.x and Nova v1. Keep them in sync with sdk_config.REGIONAL_MODEL_MAP.
_HAIKU_4_5_PREFIX = (
    "au"
    if AWS_REGION == "ap-southeast-2"
    else "global" if AWS_REGION == "ap-southeast-3" else "us"
)

VISION_MODEL_MAP = {
    # The "haiku" slot previously pointed at Claude 3 Haiku (March 2024),
    # which Bedrock has since marked Legacy and starts returning
    # ResourceNotFoundException for accounts that haven't called it in 30+
    # days. Use Claude 4.5 Haiku — current, vision-capable, different
    # inference-profile prefix in ap-southeast-2.
    "haiku": f"{_HAIKU_4_5_PREFIX}.anthropic.claude-haiku-4-5-20251001-v1:0",
    # Nova 2 Lite is published as a global cross-region inference profile —
    # there's no ``apac.amazon.nova-2-lite-v1:0`` (returns ValidationException),
    # only ``global.amazon.nova-2-lite-v1:0``. The global profile works from
    # any AWS region.
    "nova-pro": "global.amazon.nova-2-lite-v1:0",
}

# Get vision model type from config (environment variable set by infrastructure)
vision_model_type = os.environ.get("VISION_MODEL_TYPE", "haiku")

# Map config value to actual model ID
VISION_MODEL_ID = VISION_MODEL_MAP.get(vision_model_type, VISION_MODEL_MAP["haiku"])
FALLBACK_MODEL_ID = VISION_MODEL_MAP[
    "nova-pro" if vision_model_type == "haiku" else "haiku"
]

# Model-specific configurations
MODEL_CONFIGS = {
    VISION_MODEL_MAP["haiku"]: ModelConfig(),
    # Nova uses different format
    VISION_MODEL_MAP["nova-pro"]: ModelConfig(anthropic_version=None),
}

# Fallback model configuration for quota/throttling errors
FALLBACK_MODELS = [VISION_MODEL_ID, FALLBACK_MODEL_ID]

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_IMAGE_SIZE = 3.75 * 1024 * 1024  # 3.75MB
MAX_IMAGE_DIMENSION = 8000  # 8000px

VISION_EXTRACTION_PROMPT_TEMPLATE = (
    "Extract all visible text from the provided document image and format as clean Markdown.\n\n"
    "Formatting requirements:\n"
    "- Use # ## ### for headings matching the document hierarchy\n"
    "- Format tables using Markdown syntax: | col1 | col2 | with |---| separator row\n"
    "- Use **bold** and *italic* for emphasis as shown in the original\n"
    "- Use bullet points (-) and numbered lists (1.) as appropriate\n"
    "- Use > for blockquotes\n"
    "- Use ``` for code blocks\n"
    "- Describe images/diagrams/figures as: [Image: detailed description]\n\n"
    "Do not skip any content. Do not summarize or paraphrase. "
    "Faithfully reconstruct the full document in Markdown, preserving all text, structure, and visual elements."
)

# Legacy prompt for single images without page context
VISION_EXTRACTION_PROMPT_SINGLE = (
    "Extract all visible text from the provided image and format as clean Markdown.\n\n"
    "Formatting requirements:\n"
    "- Use # ## ### for headings matching the document hierarchy\n"
    "- Format tables using Markdown syntax: | col1 | col2 | with |---| separator row\n"
    "- Use **bold** and *italic* for emphasis as shown in the original\n"
    "- Use bullet points (-) and numbered lists (1.) as appropriate\n"
    "- Describe images/diagrams/figures as: [Image: detailed description]\n\n"
    "Do not skip any content. Do not summarize. Faithfully reconstruct in Markdown."
)

# Translation prompt - extracts content AND translates to English
VISION_EXTRACTION_PROMPT_TRANSLATE_TEMPLATE = (
    "Extract all visible text from the provided document image, TRANSLATE IT TO ENGLISH, "
    "and format as clean Markdown.\n\n"
    "IMPORTANT: Regardless of the original document language (e.g., Bahasa Indonesia, French, Spanish), "
    "ALL extracted text must be translated to English. Preserve the meaning and tone accurately.\n\n"
    "Formatting requirements:\n"
    "- Use # ## ### for headings matching the document hierarchy\n"
    "- Format tables using Markdown syntax: | col1 | col2 | with |---| separator row\n"
    "- Use **bold** and *italic* for emphasis as shown in the original\n"
    "- Use bullet points (-) and numbered lists (1.) as appropriate\n"
    "- Use > for blockquotes\n"
    "- Use ``` for code blocks\n"
    "- Describe images/diagrams/figures as: [Image: detailed description]\n\n"
    "Do not skip any content. Do not summarize or paraphrase. "
    "Faithfully reconstruct the full document in Markdown IN ENGLISH, preserving all text, structure, and visual elements."
)

# Translation prompt for single images
VISION_EXTRACTION_PROMPT_TRANSLATE_SINGLE = (
    "Extract all visible text from the provided image, TRANSLATE IT TO ENGLISH, "
    "and format as clean Markdown.\n\n"
    "IMPORTANT: Regardless of the original document language, ALL extracted text must be translated to English.\n\n"
    "Formatting requirements:\n"
    "- Use # ## ### for headings matching the document hierarchy\n"
    "- Format tables using Markdown syntax: | col1 | col2 | with |---| separator row\n"
    "- Use **bold** and *italic* for emphasis as shown in the original\n"
    "- Use bullet points (-) and numbered lists (1.) as appropriate\n"
    "- Describe images/diagrams/figures as: [Image: detailed description]\n\n"
    "Do not skip any content. Do not summarize. Faithfully reconstruct in Markdown IN ENGLISH."
)

logger = structlog.get_logger(__name__)
s3_client = prm_client("s3", config=Config(max_pool_connections=CONNECTION_POOL_SIZE))

# Cross-account Bedrock support: if BEDROCK_ACCOUNT is set, assume the
# bedrock-quota-sharing role in the shared account and create the Bedrock
# client with those credentials.  This is needed for client accounts (e.g.
# Nolia in Jakarta) that don't have direct Bedrock model access.
_BEDROCK_ACCOUNT = os.environ.get("BEDROCK_ACCOUNT")


def _create_bedrock_client():
    """Create a Bedrock runtime client, optionally using cross-account credentials."""
    bedrock_config = Config(max_pool_connections=CONNECTION_POOL_SIZE)

    if _BEDROCK_ACCOUNT:
        try:
            sts = prm_client("sts", region=AWS_REGION)
            response = sts.assume_role(
                RoleArn=f"arn:aws:iam::{_BEDROCK_ACCOUNT}:role/bedrock-quota-sharing",
                RoleSessionName="extract-content-lambda",
            )
            creds = response["Credentials"]
            logger.info(
                "Using cross-account Bedrock credentials",
                bedrock_account=_BEDROCK_ACCOUNT,
            )
            import boto3

            return boto3.client(
                "bedrock-runtime",
                region_name=AWS_REGION,
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
                config=bedrock_config,
            )
        except Exception as e:
            logger.error(
                "Failed to assume cross-account role, falling back to default credentials",
                bedrock_account=_BEDROCK_ACCOUNT,
                error=str(e),
            )

    return prm_client("bedrock-runtime", region=AWS_REGION, config=bedrock_config)


bedrock_client = _create_bedrock_client()

# Semaphore to limit concurrent Bedrock API calls across all threads
_bedrock_semaphore = Semaphore(MAX_BEDROCK_CONCURRENT)


def _parse_s3_uri(s3_uri: str) -> tuple[str, str]:
    """Parse S3 URI and return bucket and key"""
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ValueError(f"Invalid S3 URI: {s3_uri}")
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


@tracer.start_as_current_span("extract_content")
def extract_content(
    input_bucket: str, input_key: str, file_name: str | None
) -> Document:
    """Extract text from PDF or image files using Claude Haiku 3"""

    s3_response = s3_client.get_object(Bucket=input_bucket, Key=input_key)
    file_content = s3_response["Body"].read()

    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large: {len(file_content):,} bytes")
    file_extension = os.path.splitext(input_key.lower())[1]

    if file_extension in [".png", ".jpg", ".jpeg"]:
        text = _process_image(file_content, file_extension)
        return _create_document(text, input_key, file_name)
    elif file_extension == ".pdf":
        return _process_pdf(file_content, input_key, input_bucket, file_name)
    else:
        raise ValueError(f"Unsupported format: {file_extension}")


def _process_image(
    file_content: bytes, file_extension: str, model_id: str = VISION_MODEL_ID
) -> str:
    """Process single image with foundation model.

    Automatically resizes and compresses large images to meet Bedrock's limits:
    - Maximum image size: 3.75 MB (to stay under 5 MB base64 limit)
    - Maximum dimension: 8000 pixels
    """
    # Check if image needs preprocessing (resize/compress)
    if len(file_content) > MAX_IMAGE_SIZE:
        logger.info(
            f"Image size {len(file_content):,} bytes exceeds limit, compressing..."
        )
        img: Image.Image = Image.open(io.BytesIO(file_content))

        # Convert to RGB if necessary (handles RGBA, P mode, etc.)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Resize if dimensions exceed maximum
        if max(img.size) > MAX_IMAGE_DIMENSION:
            img.thumbnail(
                (MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS
            )
            logger.info(f"Resized image to {img.size}")

        # Compress to JPEG under size limit
        file_content = _compress_image(img)
        file_extension = ".jpg"
        logger.info(f"Compressed image to {len(file_content):,} bytes")

    return _process_image_batch(
        [file_content], [file_extension], model_id, start_page=None, end_page=None
    )


@tracer.start_as_current_span("_process_image_batch")
def _process_image_batch(
    file_contents: List[bytes],
    file_extensions: List[str],
    model_id: str,
    start_page: int | None = None,
    end_page: int | None = None,
    translate_to_english: bool = False,
) -> str:
    """Process multiple images with foundation model in a single API call.

    Args:
        file_contents: List of image file contents as bytes
        file_extensions: List of file extensions for each image
        model_id: Bedrock model ID to use
        start_page: Starting page number for this batch (1-indexed), None for single images
        end_page: Ending page number for this batch (1-indexed), None for single images
        translate_to_english: If True, use translation prompts to translate content to English

    Returns:
        Extracted text in Markdown format with page markers
    """
    current_model_id = model_id

    # Get model config for the current model
    current_model_config = MODEL_CONFIGS.get(
        current_model_id, MODEL_CONFIGS[VISION_MODEL_MAP["haiku"]]
    )
    max_images_per_call = current_model_config.max_images_per_call

    if len(file_contents) > max_images_per_call:
        raise ValueError(
            f"Cannot process more than {max_images_per_call} images per API call"
        )

    # Select appropriate prompt based on translation flag and page context
    if start_page is not None and end_page is not None:
        if translate_to_english:
            text_prompt = VISION_EXTRACTION_PROMPT_TRANSLATE_TEMPLATE.format(
                start_page=start_page, end_page=end_page
            )
        else:
            text_prompt = VISION_EXTRACTION_PROMPT_TEMPLATE.format(
                start_page=start_page, end_page=end_page
            )
    else:
        if translate_to_english:
            text_prompt = VISION_EXTRACTION_PROMPT_TRANSLATE_SINGLE
        else:
            text_prompt = VISION_EXTRACTION_PROMPT_SINGLE

    # Build content based on model type
    content: List[Dict[str, Any]] = []
    if "amazon.nova" in current_model_id:
        # Nova format - images with format and source structure
        for file_content, file_extension in zip(file_contents, file_extensions):
            # Map file extension to Nova format
            image_format = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg"}.get(
                file_extension.lstrip("."), "jpeg"
            )

            content.append(
                {
                    "image": {
                        "format": image_format,
                        "source": {"bytes": base64.b64encode(file_content).decode()},
                    }
                }
            )
        content.append({"text": text_prompt})
    else:
        # Anthropic format (default)
        for file_content, file_extension in zip(file_contents, file_extensions):
            mime_type = {
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
            }.get(file_extension.lstrip("."), "image/jpeg")
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64.b64encode(file_content).decode(),
                    },
                }
            )
        content.append({"type": "text", "text": text_prompt})

    # Content already built above based on model type

    request: Dict[str, Any]
    # Build request based on model type
    if "amazon.nova" in current_model_id:
        request = {
            "schemaVersion": "messages-v1",
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ],
            "inferenceConfig": {
                "maxTokens": current_model_config.max_tokens,
            },
        }
    else:
        # Anthropic format (default)
        request = {
            "anthropic_version": "bedrock-2023-05-31",
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ],
            "max_tokens": current_model_config.max_tokens,
        }

    response = bedrock_client.invoke_model(
        modelId=current_model_id, body=json.dumps(request)
    )

    result = json.loads(response["body"].read())

    # Extract response based on model type
    if "amazon.nova" in current_model_id:
        response_text = result["output"]["message"]["content"][0]["text"]
    else:
        # Anthropic format (default)
        response_text = result["content"][0]["text"]
    logger.info(
        f"Received API response with {len(response_text)} characters for {len(file_contents)} images"
    )

    return response_text


@tracer.start_as_current_span("_process_pdf")
def _process_pdf(
    file_content: bytes, input_key: str, input_bucket: str, file_name: str | None
) -> Document:
    """Process PDF with concurrent page processing.

    Returns a Document with per-page content extracted as Markdown with page markers.
    Each page is returned as a separate DocumentPage with correct page_number.
    """
    batch_id = str(uuid.uuid4())
    temp_prefix = f"temp-pdf/{batch_id}"

    try:
        image_uris = pdf_to_images(file_content, input_bucket, temp_prefix)
        num_pdf_pages = len(image_uris)

        # Process pages concurrently - returns DocumentPage objects with page numbers
        # assigned from PDF position (not parsed from text)
        pages = process_pages_concurrent(image_uris)

        total_words = sum(p.num_words for p in pages)

        return Document(
            name=file_name or os.path.basename(input_key),
            num_pages=num_pdf_pages,
            pages=pages,
            total_num_words=total_words,
        )

    finally:
        cleanup_s3_files(input_bucket, temp_prefix)


@tracer.start_as_current_span("process_pages_concurrent")
def process_pages_concurrent(
    image_uris: List[str],
    page_offset: int = 0,
    translate_to_english: bool = False,
) -> List[DocumentPage]:
    """Process PDF pages concurrently with adaptive batching and worker scaling.

    Args:
        image_uris: List of S3 URIs for page images
        page_offset: Offset to add to page numbers (0-indexed). For chunk processing,
                     pass start_page - 1 so page numbers are calculated correctly.
                     E.g., for pages 101-200, pass page_offset=100.
        translate_to_english: If True, translate extracted content to English.

    Returns:
        List of DocumentPage objects with page_number assigned from PDF position.
    """

    total_pages = len(image_uris)
    max_workers = min(MAX_CONCURRENT_WORKERS, total_pages)

    logger.info(
        f"Processing {total_pages} pages with {max_workers} workers, "
        f"{MAX_BEDROCK_CONCURRENT} max concurrent Bedrock calls"
    )

    def _is_retryable_error(error: Exception) -> bool:
        """Determine if an error is worth retrying based on HTTP status codes"""
        if isinstance(error, ClientError):
            http_status = error.response.get("ResponseMetadata", {}).get(
                "HTTPStatusCode"
            )
            if http_status:
                if http_status in [429, 503, 500, 502, 504]:
                    return True
                if 400 <= http_status < 500:
                    return False
            error_code = error.response.get("Error", {}).get("Code", "")
            retryable_codes = {"RequestTimeout", "InternalFailure"}
            return error_code in retryable_codes

        error_str = str(error).lower()
        return "timeout" in error_str or "connection" in error_str

    def _is_throttling_error(error: Exception) -> bool:
        """Determine if an error is related to throttling/quota limits.

        Note: Bedrock uses 503 ServiceUnavailableException for throttling,
        not just 429. See: https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes
        """
        if isinstance(error, ClientError):
            http_status = error.response.get("ResponseMetadata", {}).get(
                "HTTPStatusCode"
            )
            # Bedrock uses both 429 and 503 for throttling
            if http_status in (429, 503):
                return True
            error_code = error.response.get("Error", {}).get("Code", "")
            throttling_codes = {
                "ThrottlingException",
                "RequestLimitExceeded",
                "QuotaExceeded",
                "ServiceUnavailableException",
            }
            return error_code in throttling_codes

        error_str = str(error).lower()
        return (
            "throttl" in error_str
            or "quota" in error_str
            or "limit" in error_str
            or "unavailable" in error_str
        )

    def _is_model_unavailable_error(error: Exception) -> bool:
        """Determine if an error indicates the requested model itself is
        unavailable for this account/region — i.e. retrying against the
        same model will keep failing, but switching to a fallback model
        may succeed.

        Covers AWS-side model lifecycle and access errors:
          - ``ResourceNotFoundException`` — model retired (e.g. Bedrock's
            "marked by provider as Legacy and you have not been actively
            using the model in the last 30 days") or not present in the
            current region/inference profile.
          - ``AccessDeniedException`` — IAM/cross-account access to this
            specific model has been revoked or never granted.
          - ``ValidationException`` — usually fires when the model ID
            doesn't exist in the region or the cross-region inference
            profile. Worth a fallback attempt; if both models hit this,
            the retry loop will exhaust and raise.
        """
        if isinstance(error, ClientError):
            error_code = error.response.get("Error", {}).get("Code", "")
            return error_code in {
                "ResourceNotFoundException",
                "AccessDeniedException",
                "ValidationException",
            }
        return False

    def _retry_with_backoff(
        func, *args, max_retries=MAX_RETRIES, use_fallback_models=False, **kwargs
    ):
        """Execute function with exponential backoff retry and optional model fallback"""
        last_error = None
        current_model_index = 0

        for attempt in range(max_retries + 1):
            try:
                if use_fallback_models:
                    model_id = FALLBACK_MODELS[
                        current_model_index % len(FALLBACK_MODELS)
                    ]
                    return func(*args, model_id=model_id, **kwargs)
                else:
                    return func(*args, **kwargs)
            except Exception as e:
                last_error = e

                model_unavailable = _is_model_unavailable_error(e)
                # Model-unavailable errors are a 4xx that _is_retryable_error
                # would otherwise abort on — but with fallback enabled the
                # right move is to swap models and try again, not bail. Without
                # this carve-out, a deprecated/retired primary model corrupts
                # every page silently (the per-page handler embeds the error
                # string as text). See INC discussion for ngaitahu staging
                # 2026-04-24, where Claude 3 Haiku hit the 30-day-inactive
                # legacy-model retirement.
                retryable = _is_retryable_error(e) or (
                    use_fallback_models and model_unavailable
                )

                if attempt == max_retries or not retryable:
                    raise e

                # Switch models on either throttling (load-shed to a
                # different model) or model-unavailable (the current model
                # is dead for this account — fallback is the only way out).
                if use_fallback_models and (
                    _is_throttling_error(e) or model_unavailable
                ):
                    current_model_index += 1
                    next_model = FALLBACK_MODELS[
                        current_model_index % len(FALLBACK_MODELS)
                    ]
                    reason = (
                        "Model unavailable"
                        if model_unavailable
                        else "Throttling detected"
                    )
                    logger.warning(
                        f"{reason} on attempt {attempt + 1}. Switching to model: {next_model}"
                    )

                wait_time = (2**attempt) + random.uniform(0.1, 0.5)
                logger.warning(
                    f"Attempt {attempt + 1} failed: {e}. Retrying in {wait_time:.1f}s"
                )
                time.sleep(wait_time)

        if last_error:
            raise last_error
        raise RuntimeError("Retry failed with no recorded error")

    def _get_s3_object_with_retry(bucket: str, key: str):
        """Get S3 object with retry logic"""
        return s3_client.get_object(Bucket=bucket, Key=key)

    def _process_image_batch_with_retry(
        contents: List[bytes],
        extensions: List[str],
        model_id: str,
        start_page: int,
        end_page: int,
        translate: bool = False,
    ):
        """Process image batch with retry logic"""
        return _process_image_batch(
            contents,
            extensions,
            model_id,
            start_page=start_page,
            end_page=end_page,
            translate_to_english=translate,
        )

    @tracer.start_as_current_span("process_page_batch")
    def process_page_batch(batch_data):
        """Process a single page and return (page_number, text)"""
        start_idx, batch_uris = batch_data
        page_number = start_idx + 1 + page_offset

        try:
            uri = batch_uris[0]
            bucket, key = _parse_s3_uri(uri)

            obj = _retry_with_backoff(_get_s3_object_with_retry, bucket, key)
            content = obj["Body"].read()

            # Use semaphore to limit concurrent Bedrock API calls
            with _bedrock_semaphore:
                page_text = _retry_with_backoff(
                    _process_image_batch_with_retry,
                    [content],
                    [".jpg"],
                    use_fallback_models=True,
                    start_page=page_number,
                    end_page=page_number,
                    translate=translate_to_english,
                )
            return (page_number, page_text)

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            logger.error(f"Page {page_number} AWS error [{error_code}]: {e}")
            return (page_number, f"[AWS Error on page {page_number}: {error_code}]")

        except Exception as e:
            logger.error(f"Page {page_number} failed: {e}")
            return (page_number, f"[Error on page {page_number}]")

    # Create 1-page batches since max_images_per_call = 1
    # Each batch is (page_index, [uri]) so process_page_batch processes every page
    batches = [(i, [uri]) for i, uri in enumerate(image_uris)]

    page_results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(process_page_batch, batch): batch[0] for batch in batches
        }

        for future in as_completed(futures):
            page_number, page_text = future.result()
            page_results[page_number] = page_text

    pages = []
    for page_number in sorted(page_results.keys()):
        text = page_results[page_number]
        pages.append(
            DocumentPage(
                page_number=page_number,
                text=text,
                num_words=len(text.split()),
            )
        )

    logger.info(f"Extracted {len(pages)} pages")

    return pages


@tracer.start_as_current_span("pdf_to_images")
def pdf_to_images(file_content: bytes, bucket: str, temp_prefix: str) -> List[str]:
    """Convert PDF pages to optimized images in S3"""

    pdf = fitz.open(stream=file_content, filetype="pdf")
    uris = []

    try:
        for i in range(pdf.page_count):
            page = pdf[i]
            pix = page.get_pixmap(  # type: ignore[attr-defined]
                matrix=fitz.Matrix(1.5, 1.5)
            )
            img: Image.Image = Image.open(io.BytesIO(pix.tobytes("ppm")))
            if img.mode != "RGB":
                img = img.convert("RGB")

            if max(img.size) > MAX_IMAGE_DIMENSION:
                img.thumbnail(
                    (MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS
                )

            img_bytes = _compress_image(img)

            key = f"{temp_prefix}/page_{i:04d}.jpg"
            s3_client.put_object(
                Bucket=bucket, Key=key, Body=img_bytes, ContentType="image/jpeg"
            )
            uris.append(f"s3://{bucket}/{key}")

        logger.info(f"Created {len(uris)} page images")
        return uris

    finally:
        pdf.close()


@tracer.start_as_current_span("_compress_image")
def _compress_image(img: Image.Image) -> bytes:
    """Compress image to meet Bedrock size limits"""

    for quality in range(95, 10, -10):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= MAX_IMAGE_SIZE:
            return buf.getvalue()

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=10, optimize=True)
    return buf.getvalue()


@tracer.start_as_current_span("cleanup_s3_files")
def cleanup_s3_files(bucket: str, prefix: str):
    """Clean up temporary S3 files with pagination support for >1000 objects"""

    try:
        total_deleted = 0
        continuation_token: str | None = None

        while True:
            if continuation_token:
                response = s3_client.list_objects_v2(
                    Bucket=bucket, Prefix=prefix, ContinuationToken=continuation_token
                )
            else:
                response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix)

            if "Contents" in response:
                objects = [
                    {"Key": obj["Key"]} for obj in response["Contents"] if "Key" in obj
                ]
                if objects:
                    s3_client.delete_objects(
                        Bucket=bucket, Delete={"Objects": objects}  # type: ignore[typeddict-item]
                    )
                    total_deleted += len(objects)

            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")

        if total_deleted > 0:
            logger.info(f"Cleaned up {total_deleted} temp files")
    except Exception as e:
        logger.warning(f"Cleanup failed: {e}")


def _create_document(text: str, input_key: str, file_name: str | None) -> Document:
    """Create Document from text"""

    words = len(text.split())
    page = DocumentPage(page_number=1, num_words=words, text=text)

    return Document(
        name=file_name or os.path.basename(input_key),
        num_pages=1,
        pages=[page],
        total_num_words=words,
    )
