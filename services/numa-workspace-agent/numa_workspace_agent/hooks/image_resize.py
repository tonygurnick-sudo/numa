"""
PreToolUse hook that downsamples oversized images before they reach the model.

The Anthropic vision API enforces a 2000px max long-side per image once a
request contains >20 images. The bundled Claude Code CLI's own auto-resize is
flaky under parallel `Read` calls, so we run our own resize here as a backstop:
when `Read` targets an image whose long side exceeds 2000px, we write a
downsampled copy under /workdir/outputs/.resized/ and rewrite the tool input to
point at that copy via PreToolUseHookSpecificOutput.updatedInput.
"""

import logging
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from claude_agent_sdk import HookContext
except ImportError:
    HookContext = Any  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

MAX_DIMENSION = 2000
TILING_HINT_RATIO = 1.5
RESIZED_DIR = Path("/workdir/outputs/.resized")
IMAGE_EXTENSIONS = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"}
)


def _is_image_path(path: str) -> bool:
    """Cheap extension-based image check — avoids opening every Read target."""
    if not path:
        return False
    return Path(path).suffix.lower() in IMAGE_EXTENSIONS


def _compute_resized_path(src: Path, size: int, mtime_ns: int) -> Path:
    """
    Deterministic resized-file path embedding source (size, mtime_ns).

    Encoding stat into the filename gives natural idempotency: file exists ⇒
    skip work, no stat-comparison race. Stale resizes fall out of the path
    automatically when the source changes.
    """
    return RESIZED_DIR / f"{src.stem}.r{size}-{mtime_ns}.png"


def _resize_to_cap(
    src: Path, dst: Path, cap: int = MAX_DIMENSION
) -> tuple[tuple[int, int], tuple[int, int]]:
    """
    Resize `src` to fit within (cap × cap) and save as PNG at `dst` atomically.

    Returns ((orig_w, orig_h), (new_w, new_h)). Bakes EXIF rotation into pixels
    so the SDK doesn't re-rotate then re-shrink. Saves via temp + os.replace
    so two parallel calls cannot produce a partial file.
    """
    # Imported lazily so module import is cheap and test envs without Pillow
    # still load the file (the hook short-circuits on PIL ImportError below).
    from PIL import Image, ImageOps

    with Image.open(src) as img:
        if getattr(img, "n_frames", 1) > 1:
            logger.warning(
                "Multi-frame image will be saved as single-frame PNG",
                extra={
                    "_name": "IMAGE_RESIZE_HOOK_MULTIFRAME",
                    "phase": "sdk",
                    "src": str(src),
                    "n_frames": img.n_frames,
                },
            )
        img = ImageOps.exif_transpose(img)
        orig_size = img.size
        img.thumbnail((cap, cap), Image.LANCZOS)
        new_size = img.size

        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_name = tempfile.mkstemp(
            prefix=f"{dst.stem}.",
            suffix=f".{os.getpid()}.{secrets.token_hex(4)}.tmp",
            dir=str(dst.parent),
        )
        os.close(tmp_fd)
        tmp_path = Path(tmp_name)
        try:
            img.save(tmp_path, format="PNG", optimize=False)
            os.replace(tmp_path, dst)
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    return orig_size, new_size


def _build_additional_context(
    orig: tuple[int, int], new: tuple[int, int]
) -> str | None:
    """Tiling hint, but only when the downsample loses material detail."""
    orig_long = max(orig)
    if orig_long / MAX_DIMENSION <= TILING_HINT_RATIO:
        return None
    return (
        f"Image was originally {orig[0]}×{orig[1]}; downsampled to "
        f"{new[0]}×{new[1]} to fit the 2000px API cap. To read fine detail "
        f"(small dimensions, dense text), render a sub-region with `fitz` "
        f"instead of the full page — see the high-resolution section of the "
        f"`pdf-handling` skill."
    )


async def image_resize_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """
    PreToolUse hook: downsample oversized images before `Read` runs.

    No-op for non-Read tools, non-image paths, missing/unreadable files, and
    images already within the 2000px cap. Otherwise writes a downsampled copy
    under /workdir/outputs/.resized/ and rewrites the tool input to point at
    it via `updatedInput`.
    """
    if input_data.get("tool_name") != "Read":
        return {}

    tool_input = input_data.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path", "")
    if not _is_image_path(file_path):
        return {}

    src = Path(file_path)
    try:
        stat = src.stat()
    except OSError:
        return {}

    try:
        from PIL import Image
    except ImportError:
        logger.warning(
            "Pillow unavailable; image_resize_hook is a no-op",
            extra={"_name": "IMAGE_RESIZE_HOOK_NO_PIL", "phase": "sdk"},
        )
        return {}

    try:
        with Image.open(src) as img:
            orig_w, orig_h = img.size
    except Exception as exc:  # noqa: BLE001 — any PIL failure should fall through
        logger.warning(
            f"Failed to read image header for {src}: {exc}",
            extra={
                "_name": "IMAGE_RESIZE_HOOK_ERROR",
                "phase": "sdk",
                "src": str(src),
                "error": str(exc),
            },
        )
        return {}

    if max(orig_w, orig_h) <= MAX_DIMENSION:
        return {}

    dst = _compute_resized_path(src, stat.st_size, stat.st_mtime_ns)

    if not dst.exists():
        try:
            orig_size, new_size = _resize_to_cap(src, dst)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"Failed to resize {src}: {exc}",
                extra={
                    "_name": "IMAGE_RESIZE_HOOK_ERROR",
                    "phase": "sdk",
                    "src": str(src),
                    "error": str(exc),
                },
            )
            return {}
    else:
        # Idempotent path: file already resized for this exact source state.
        from PIL import Image

        with Image.open(dst) as img:
            new_size = img.size
        orig_size = (orig_w, orig_h)

    logger.warning(
        f"IMAGE_RESIZE_HOOK_APPLIED: {orig_size[0]}x{orig_size[1]} -> "
        f"{new_size[0]}x{new_size[1]} | {src.name} -> {dst.name}",
        extra={
            "_name": "IMAGE_RESIZE_HOOK_APPLIED",
            "phase": "sdk",
            "tool_use_id": tool_use_id,
            "src": str(src),
            "dst": str(dst),
            "orig": list(orig_size),
            "new": list(new_size),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )

    output: dict[str, Any] = {
        "hookEventName": "PreToolUse",
        "updatedInput": {**tool_input, "file_path": str(dst)},
    }
    additional_context = _build_additional_context(orig_size, new_size)
    if additional_context is not None:
        output["additionalContext"] = additional_context

    return {"hookSpecificOutput": output}
