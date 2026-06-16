"""
view_image — describe a workspace image with a vision model.

The non-multimodal "Numa Standard Model" has no native image understanding:
it cannot read charts, screenshots, scanned pages, or slides directly. This
tool gives it eyes — it reads the image from the conversation's workspace S3
prefix and runs it through a dedicated vision model (Haiku 4.5 by default) via
the Bedrock Converse API, returning a textual description the text model can
then reason over.

Vision model: VISION_MODEL_ID, default Haiku 4.5. Deliberately NOT Nova — the
benchmark A/B showed Nova reading low-contrast slide layouts backwards and
hallucinating on dense heatmaps; Haiku flagged the same slides correctly. The
env var is decoupled from FAST_MODEL_ID so the vision model can be tuned
independently.

S3 path: mirrors transcribe.py / convert_document.py —
    {S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}
with user_sub + conversation_id injected by the dispatcher as
__user_sub / __conversation_id.

Returns: {"description": <str>}. The dispatcher wraps this in the standard
{status, result, error} envelope.
"""

import os
from pathlib import Path
from typing import Any, Dict

import structlog
from botocore.exceptions import ClientError

from prm import client as prm_client

logger = structlog.get_logger()

# ── Configuration ────────────────────────────────────────────────────────────

REGION = os.getenv("AWS_REGION", "us-east-1")
OUTPUTS_BUCKET_NAME = os.getenv("OUTPUTS_BUCKET_NAME", "")

# Haiku 4.5 — NOT Nova (the bench A/B showed Nova reads layouts backwards and
# hallucinates on dense visuals). Decoupled from FAST_MODEL_ID on purpose.
VISION_MODEL_ID = os.getenv(
    "VISION_MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0"
)

# Same workspace constants the other workspace-file tools use.
S3_PREFIX = "numa-chat/workspace"
WORKSPACE_ROOT = "/workdir"

# Extension → Bedrock Converse image `format` token. The Converse ImageBlock
# accepts: png | jpeg | gif | webp.
EXT_TO_IMAGE_FORMAT = {
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".gif": "gif",
    ".webp": "webp",
}
SUPPORTED_EXTENSIONS = set(EXT_TO_IMAGE_FORMAT.keys())

# Guard rail — Bedrock image payloads have hard caps; reject oversized files
# before we pull them through the Lambda.
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

# Default instruction when the caller doesn't pass a specific question.
DEFAULT_PROMPT = (
    "Describe this image in detail. Capture any text verbatim, the layout and "
    "structure (tables, charts, columns, headings), figures and their axes or "
    "legends, and anything a reader who cannot see the image would need to "
    "understand it. Do not invent content that is not present."
)

VISION_MAX_TOKENS = 4000


def handle_view_image(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Describe a workspace image using a vision model.

    Parameters:
        file_path (str): Workspace path to the image (e.g. /workdir/uploads/slide.png)
        prompt (str): Optional question / instruction. Defaults to a full description.
        __user_sub (str): User's Cognito sub (injected by router)
        __conversation_id (str): Conversation ID (injected by router)

    Returns:
        Dict with {"description": str}
    """
    file_path = params.get("file_path", "")
    prompt = (params.get("prompt") or "").strip() or DEFAULT_PROMPT
    user_sub = params.get("__user_sub", "")
    conversation_id = params.get("__conversation_id", "")

    if not file_path:
        raise ValueError("Missing required parameter: file_path")
    if not user_sub or not conversation_id:
        raise ValueError("Missing user context (user_sub or conversation_id)")
    if not OUTPUTS_BUCKET_NAME:
        raise ValueError("OUTPUTS_BUCKET_NAME not configured")

    ext = Path(file_path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported image format: {ext or '(none)'}. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
    image_format = EXT_TO_IMAGE_FORMAT[ext]

    # Build the S3 key the same way transcribe / convert_document do.
    rel_path = file_path
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        rel_path = file_path[len(WORKSPACE_ROOT) + 1 :]
    image_s3_key = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"

    s3_client = prm_client("s3", region=REGION)

    # Read the image bytes from the workspace prefix.
    try:
        response = s3_client.get_object(Bucket=OUTPUTS_BUCKET_NAME, Key=image_s3_key)
        image_bytes = response["Body"].read()
    except ClientError as e:
        logger.warning(
            "Image not found in workspace S3",
            file_path=file_path,
            s3_key=image_s3_key,
            error=str(e),
        )
        raise ValueError(f"Image not found in workspace: {file_path}") from e

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large: {len(image_bytes) / 1024 / 1024:.1f} MB "
            f"(max {MAX_IMAGE_BYTES / 1024 / 1024:.0f} MB)"
        )

    logger.info(
        "Viewing image",
        file_path=file_path,
        format=image_format,
        size_bytes=len(image_bytes),
        model_id=VISION_MODEL_ID,
        user_sub=user_sub[:8] + "...",
    )

    # Bedrock Converse image block: source.bytes takes RAW bytes (the SDK
    # handles transport encoding) — distinct from the InvokeModel JSON path,
    # which wants base64.
    bedrock_client = prm_client("bedrock-runtime", region=REGION)
    try:
        converse_response = bedrock_client.converse(
            modelId=VISION_MODEL_ID,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "image": {
                                "format": image_format,
                                "source": {"bytes": image_bytes},
                            }
                        },
                        {"text": prompt},
                    ],
                }
            ],
            inferenceConfig={"maxTokens": VISION_MAX_TOKENS, "temperature": 0.0},
        )
    except ClientError as e:
        logger.error(
            "Vision model call failed",
            file_path=file_path,
            model_id=VISION_MODEL_ID,
            error=str(e),
        )
        raise ValueError(f"Failed to analyse image: {e}") from e

    # Pull the text out of the Converse response (same shape web_search reads).
    content = converse_response.get("output", {}).get("message", {}).get("content", [])
    description = ""
    for item in content:
        if "text" in item:
            description = item["text"].strip()
            break

    if not description:
        logger.warning("Vision model returned no text", file_path=file_path)
        raise ValueError("The vision model returned no description for this image.")

    logger.info(
        "Image described",
        file_path=file_path,
        description_length=len(description),
    )

    return {"description": description}
