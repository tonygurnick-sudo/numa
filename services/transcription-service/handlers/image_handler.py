"""Native image extraction using Pillow + optional Bedrock vision."""

import base64
import io
import json
import os

import structlog
from PIL import Image

logger = structlog.get_logger(__name__)

# Formats that may have multiple frames
MULTI_FRAME_EXTS = {".tiff", ".tif", ".gif"}
MAX_DIMENSION = 8000
MAX_JPEG_SIZE = 3_750_000  # 3.75 MB Bedrock limit


def _resize_if_needed(img: Image.Image) -> Image.Image:
    """Resize image if it exceeds max dimensions."""
    w, h = img.size
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        ratio = min(MAX_DIMENSION / w, MAX_DIMENSION / h)
        new_w, new_h = int(w * ratio), int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    return img


def _to_jpeg_bytes(img: Image.Image) -> bytes:
    """Convert image to JPEG bytes, compressing until under size limit."""
    if img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    for quality in (90, 70, 50, 30, 15):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        data = buf.getvalue()
        if len(data) <= MAX_JPEG_SIZE:
            return data
    return data  # Return last attempt even if oversized


def _extract_with_bedrock(img_bytes: bytes, page_label: str) -> str:
    """Use Bedrock vision to extract text from an image."""
    region = os.environ.get("REGION", "us-east-1")

    try:
        import boto3

        bedrock = boto3.client("bedrock-runtime", region_name=region)
    except Exception as e:
        return f"({page_label}: Bedrock client unavailable — {e})"

    b64 = base64.b64encode(img_bytes).decode("utf-8")

    # Try Claude Haiku 3 first (best for extraction)
    model_id = "anthropic.claude-3-haiku-20240307-v1:0"
    # Use cross-region if in AP
    if region.startswith("ap-"):
        model_id = f"apac.{model_id}"
    elif region.startswith("eu-"):
        model_id = f"eu.{model_id}"
    elif region.startswith("us-"):
        model_id = f"us.{model_id}"

    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "Extract ALL text content from this image. Preserve the original structure "
                                "including headings, paragraphs, lists, and tables. Format tables using "
                                "markdown pipe syntax (| col1 | col2 |). Do not summarize — extract everything."
                            ),
                        },
                    ],
                }
            ],
        }
    )

    try:
        response = bedrock.invoke_model(
            modelId=model_id, body=body, contentType="application/json"
        )
        result = json.loads(response["body"].read())
        text_blocks = [
            b["text"] for b in result.get("content", []) if b.get("type") == "text"
        ]
        return (
            "\n".join(text_blocks)
            if text_blocks
            else f"({page_label}: no text extracted)"
        )
    except Exception as e:
        logger.warning("Bedrock vision failed", error=str(e), page=page_label)
        return f"({page_label}: vision extraction failed — {e})"


def extract_image(file_path: str, ext: str) -> list[dict]:
    """Extract text from an image file using Pillow + Bedrock vision."""
    try:
        # HEIC/HEIF support
        if ext in (".heic", ".heif"):
            from pillow_heif import register_heif_opener

            register_heif_opener()

        img = Image.open(file_path)
    except Exception as e:
        logger.error("Failed to open image", error=str(e))
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to open image: {e})"}
        ]

    pages: list[dict] = []

    # Handle multi-frame images (TIFF, GIF)
    if ext in MULTI_FRAME_EXTS:
        try:
            n_frames = getattr(img, "n_frames", 1)
        except Exception:
            n_frames = 1

        for frame_idx in range(n_frames):
            try:
                img.seek(frame_idx)
                frame = _resize_if_needed(img.copy())
                jpeg_bytes = _to_jpeg_bytes(frame)
                text = _extract_with_bedrock(jpeg_bytes, f"Frame {frame_idx + 1}")
                pages.append(
                    {
                        "page_number": frame_idx + 1,
                        "num_words": len(text.split()),
                        "text": text,
                    }
                )
            except Exception as e:
                pages.append(
                    {
                        "page_number": frame_idx + 1,
                        "num_words": 0,
                        "text": f"(Frame {frame_idx + 1}: extraction failed — {e})",
                    }
                )
    else:
        # Single image
        img = _resize_if_needed(img)
        jpeg_bytes = _to_jpeg_bytes(img)
        text = _extract_with_bedrock(jpeg_bytes, "Image")
        pages.append({"page_number": 1, "num_words": len(text.split()), "text": text})

    img.close()
    logger.info("Image extraction complete", frames=len(pages))
    return pages
