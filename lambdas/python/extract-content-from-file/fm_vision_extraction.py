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
from typing import Any, Dict, List
from urllib.parse import urlparse

import boto3
import fitz  # type: ignore[import-untyped]  # PyMuPDF
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError
from PIL import Image


@dataclasses.dataclass
class DocumentPage:
    page_number: int = 0
    num_words: int = 0
    text: str = ""


@dataclasses.dataclass
class Document:
    name: str = ""
    num_pages: int = 0
    total_num_words: int = 0
    pages: List[DocumentPage] = dataclasses.field(default_factory=list)


AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Vision model type mapping - maps config values to actual model IDs
VISION_MODEL_MAP = {
    "haiku": "anthropic.claude-3-haiku-20240307-v1:0",
    "nova-pro": "amazon.nova-pro-v1:0",
}

# Get vision model type from config (environment variable set by infrastructure)
vision_model_type = os.environ.get("VISION_MODEL_TYPE", "haiku")

# Map config value to actual model ID
VISION_MODEL_ID = VISION_MODEL_MAP.get(vision_model_type, VISION_MODEL_MAP["haiku"])

# Model-specific configurations
MODEL_CONFIGS = {
    "anthropic.claude-3-haiku-20240307-v1:0": {
        "max_tokens": 4096,
        "max_images_per_call": 5,
        "anthropic_version": "bedrock-2023-05-31",
    },
    "amazon.nova-pro-v1:0": {
        "max_tokens": 4096,
        "max_images_per_call": 5,
        "anthropic_version": None,  # Nova uses different format
    },
}

# Get current model config
CURRENT_MODEL_CONFIG = MODEL_CONFIGS.get(
    VISION_MODEL_ID, MODEL_CONFIGS["anthropic.claude-3-haiku-20240307-v1:0"]
)

MAX_TOKENS = CURRENT_MODEL_CONFIG["max_tokens"]  # type: ignore[index]
MAX_IMAGES_PER_CALL = CURRENT_MODEL_CONFIG["max_images_per_call"]  # type: ignore[index]
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_IMAGE_SIZE = 3.75 * 1024 * 1024  # 3.75MB
MAX_IMAGE_DIMENSION = 8000  # 8000px

# Vision extraction prompt - works for both single and multiple images
VISION_EXTRACTION_PROMPT = (
    "Extract all visible text from the provided document image(s). Also describe any diagrams, figures, tables, "
    "or other visual elements in detail, so that a reader can reconstruct the original layout and content purely "
    "from the text. Use accurate descriptions and preserve any embedded text. "
    "If multiple images are provided, return the content in logical page order with clear page markers like "
    "`[Page 1]`, `[Page 2]`, and so on. "
    "Do not skip any content. Do not summarise or paraphrase. Your goal is to faithfully reconstruct the full "
    "document in text form, including all written and visual elements, in their correct order."
)

# Adaptive scaling: (max_pages, target_workers, pages_per_batch_range)
# Note: API limit varies by model, so max batch size is model-dependent
SCALING_CONFIG = [
    (2, 1, (2, 2)),
    (5, 2, (2, 3)),
    (7, 3, (2, 3)),
    (10, 4, (2, 3)),
    (20, 8, (3, 4)),
    (50, 15, (3, 4)),
    (100, 20, (4, 5)),
    (200, 40, (4, 5)),
    (float("inf"), 60, (4, 5)),
]

logger = structlog.get_logger(__name__)
s3_client = boto3.client("s3", config=Config(max_pool_connections=50))
bedrock_client = boto3.client(
    "bedrock-runtime", region_name=AWS_REGION, config=Config(max_pool_connections=50)
)


def _parse_s3_uri(s3_uri: str) -> tuple[str, str]:
    """Parse S3 URI and return bucket and key"""
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ValueError(f"Invalid S3 URI: {s3_uri}")
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


def extract_content(input_bucket: str, input_key: str) -> Document:
    """Extract text from PDF or image files using Claude Haiku 3"""

    s3_response = s3_client.get_object(Bucket=input_bucket, Key=input_key)
    file_content = s3_response["Body"].read()

    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large: {len(file_content):,} bytes")
    file_extension = os.path.splitext(input_key.lower())[1]

    if file_extension in [".png", ".jpg", ".jpeg"]:
        text = _process_image(file_content, file_extension)
        return _create_document(text, input_key)
    elif file_extension == ".pdf":
        return _process_pdf(file_content, input_key, input_bucket)
    else:
        raise ValueError(f"Unsupported format: {file_extension}")


def _process_image(file_content: bytes, file_extension: str) -> str:
    """Process single image with foundation model"""
    return _process_image_batch([file_content], [file_extension])


def _process_image_batch(file_contents: List[bytes], file_extensions: List[str]) -> str:
    """Process multiple images with foundation model in a single API call"""

    if len(file_contents) > MAX_IMAGES_PER_CALL:
        raise ValueError(
            f"Cannot process more than {MAX_IMAGES_PER_CALL} images per API call"
        )

    # Use unified prompt for all cases
    text_prompt = VISION_EXTRACTION_PROMPT

    # Build content based on model type
    content: List[Dict[str, Any]] = []
    if VISION_MODEL_ID.startswith("amazon.nova"):
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

    # Build request based on model type
    if VISION_MODEL_ID.startswith("amazon.nova"):
        request = {
            "schemaVersion": "messages-v1",
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ],
            "inferenceConfig": {
                "maxTokens": MAX_TOKENS,
            },
        }
    else:
        # Anthropic format (default)
        request = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": MAX_TOKENS,
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ],
        }

    response = bedrock_client.invoke_model(
        modelId=VISION_MODEL_ID, body=json.dumps(request)
    )

    result = json.loads(response["body"].read())

    # Extract response based on model type
    if VISION_MODEL_ID.startswith("amazon.nova"):
        response_text = result["output"]["message"]["content"][0]["text"]
    else:
        # Anthropic format (default)
        response_text = result["content"][0]["text"]
    logger.info(
        f"Received API response with {len(response_text)} characters for {len(file_contents)} images"
    )

    return response_text


def _distribute_pages_evenly(total_pages: int, num_workers: int) -> List[int]:
    base_size = total_pages // num_workers
    extra_pages = total_pages % num_workers
    batch_sizes = [base_size] * num_workers
    for i in range(extra_pages):
        batch_sizes[i] += 1
    return batch_sizes


def _calculate_optimal_scaling(total_pages: int) -> tuple[int, List[int]]:
    """Calculate optimal workers and batch sizes for given page count"""
    for max_pages, target_workers, (min_batch, _) in SCALING_CONFIG:
        if total_pages <= max_pages:
            if target_workers is None:
                workers = min(25, max(1, total_pages // min_batch))
            else:
                workers = min(target_workers, total_pages)
            batch_sizes = _distribute_pages_evenly(total_pages, workers)
            return workers, batch_sizes
    return 1, [total_pages]


def _process_pdf(file_content: bytes, input_key: str, input_bucket: str) -> Document:
    """Process PDF with concurrent page processing"""

    batch_id = str(uuid.uuid4())
    temp_prefix = f"temp-pdf/{batch_id}"

    try:
        image_uris = _pdf_to_images(file_content, input_bucket, temp_prefix)
        complete_text = _process_pages_concurrent(image_uris)
        total_words = len(complete_text.split())
        document_page = DocumentPage(
            page_number=1, text=complete_text, num_words=total_words
        )

        return Document(
            name=os.path.basename(input_key),
            num_pages=len(image_uris),
            pages=[document_page],
            total_num_words=total_words,
        )

    finally:
        _cleanup_s3_files(input_bucket, temp_prefix)


def _process_pages_concurrent(image_uris: List[str]) -> str:
    """Process PDF pages concurrently with adaptive batching and worker scaling"""

    total_pages = len(image_uris)
    max_workers, batch_sizes = _calculate_optimal_scaling(total_pages)

    logger.info(
        f"Processing {total_pages} pages with {max_workers} workers, batch sizes: {batch_sizes}"
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

    def _retry_with_backoff(func, *args, max_retries=3):
        """Execute function with exponential backoff retry"""
        last_error = None

        for attempt in range(max_retries + 1):
            try:
                return func(*args)
            except Exception as e:
                last_error = e

                if attempt == max_retries or not _is_retryable_error(e):
                    raise e

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

    def _process_image_batch_with_retry(contents: List[bytes], extensions: List[str]):
        """Process image batch with retry logic"""
        return _process_image_batch(contents, extensions)

    def process_page_batch(batch_data):
        """Process a batch of 5 pages in a single API call"""
        start_idx, batch_uris = batch_data

        try:
            contents = []
            extensions = []

            for uri in batch_uris:
                bucket, key = _parse_s3_uri(uri)

                obj = _retry_with_backoff(_get_s3_object_with_retry, bucket, key)
                content = obj["Body"].read()
                contents.append(content)
                extensions.append(".jpg")

            batch_text = _retry_with_backoff(
                _process_image_batch_with_retry, contents, extensions
            )
            return (start_idx, batch_text)

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            logger.error(
                f"Batch starting at page {start_idx + 1} AWS error [{error_code}]: {e}"
            )
            return (
                start_idx,
                f"[AWS Error in batch starting at page {start_idx + 1}: {error_code}]",
            )

        except Exception as e:
            logger.error(f"Batch starting at page {start_idx + 1} failed: {e}")
            return (start_idx, f"[Error in batch starting at page {start_idx + 1}]")

    batches = []
    start_idx = 0
    for batch_size in batch_sizes:
        batch_uris = image_uris[start_idx : start_idx + batch_size]
        batches.append((start_idx, batch_uris))
        start_idx += batch_size

    batch_texts = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(process_page_batch, batch): batch[0] for batch in batches
        }

        for future in as_completed(futures):
            start_idx, batch_text = future.result()
            batch_texts[start_idx] = batch_text
            time.sleep(0.1)

    ordered_text_parts = []
    start_idx = 0
    for batch_size in batch_sizes:
        if start_idx in batch_texts:
            ordered_text_parts.append(batch_texts[start_idx])
        start_idx += batch_size

    combined_text = "\n\n".join(ordered_text_parts).strip()
    logger.info(
        f"Combined all batches into document with {len(combined_text)} total characters"
    )

    return combined_text


def _pdf_to_images(file_content: bytes, bucket: str, temp_prefix: str) -> List[str]:
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


def _cleanup_s3_files(bucket: str, prefix: str):
    """Clean up temporary S3 files"""

    try:
        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix)

        if "Contents" in response:
            objects = [{"Key": obj["Key"]} for obj in response["Contents"]]
            if objects:
                s3_client.delete_objects(Bucket=bucket, Delete={"Objects": objects})
                logger.info(f"Cleaned up {len(objects)} temp files")
    except Exception as e:
        logger.warning(f"Cleanup failed: {e}")


def _create_document(text: str, input_key: str) -> Document:
    """Create Document from text"""

    words = len(text.split())
    page = DocumentPage(page_number=1, num_words=words, text=text)

    return Document(
        name=os.path.basename(input_key),
        num_pages=1,
        pages=[page],
        total_num_words=words,
    )
