"""Tests for the image_resize_hook PreToolUse hook."""

import asyncio
import logging
from pathlib import Path

import pytest
from numa_workspace_agent.hooks import image_resize as ir_mod
from numa_workspace_agent.hooks.image_resize import (
    _build_additional_context,
    _is_image_path,
    image_resize_hook,
)
from PIL import Image


@pytest.fixture(autouse=True)
def isolated_resized_dir(tmp_path, monkeypatch):
    """Redirect RESIZED_DIR to a tmp path so tests don't need /workdir."""
    target = tmp_path / "resized"
    monkeypatch.setattr(ir_mod, "RESIZED_DIR", target)
    return target


def _write_png(path: Path, w: int, h: int, color=(200, 100, 50)) -> Path:
    img = Image.new("RGB", (w, h), color=color)
    img.save(path, format="PNG")
    return path


# ── _is_image_path ────────────────────────────────────────────────────────────


class TestIsImagePath:
    @pytest.mark.parametrize(
        "path",
        [
            "/workdir/outputs/foo.png",
            "/workdir/outputs/foo.PNG",
            "/workdir/outputs/foo.jpg",
            "/workdir/outputs/foo.JPEG",
            "/workdir/outputs/foo.webp",
            "/workdir/outputs/foo.tif",
            "/workdir/outputs/foo.tiff",
            "/workdir/outputs/foo.bmp",
            "/workdir/outputs/foo.gif",
        ],
    )
    def test_recognises_image_extensions(self, path):
        assert _is_image_path(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "/workdir/outputs/foo.txt",
            "/workdir/outputs/foo.bin",
            "/workdir/outputs/foo.pdf",
            "/workdir/outputs/foo",
            "",
        ],
    )
    def test_rejects_non_images(self, path):
        assert _is_image_path(path) is False


# ── No-op cases ───────────────────────────────────────────────────────────────


class TestNoOps:
    async def test_non_read_tool(self):
        result = await image_resize_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls"}},
            tool_use_id="t1",
            context={},
        )
        assert result == {}

    async def test_missing_file_path(self):
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {}},
            tool_use_id="t1",
            context={},
        )
        assert result == {}

    async def test_non_image_extension(self, tmp_path):
        target = tmp_path / "data.txt"
        target.write_text("hello")
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(target)}},
            tool_use_id="t1",
            context={},
        )
        assert result == {}

    async def test_nonexistent_file(self):
        result = await image_resize_hook(
            {
                "tool_name": "Read",
                "tool_input": {"file_path": "/does/not/exist.png"},
            },
            tool_use_id="t1",
            context={},
        )
        assert result == {}

    async def test_under_cap_passes_through(self, tmp_path, isolated_resized_dir):
        src = _write_png(tmp_path / "small.png", 1000, 800)
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="t1",
            context={},
        )
        assert result == {}
        assert not isolated_resized_dir.exists() or not list(
            isolated_resized_dir.iterdir()
        )


# ── Resize math + hook return shape ───────────────────────────────────────────


class TestResize:
    async def test_oversized_long_side_resized_to_cap(
        self, tmp_path, isolated_resized_dir
    ):
        src = _write_png(tmp_path / "big.png", 5788, 4093)
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu1",
            context={},
        )
        assert "hookSpecificOutput" in result
        out = result["hookSpecificOutput"]
        assert out["hookEventName"] == "PreToolUse"
        new_path = Path(out["updatedInput"]["file_path"])
        assert new_path.exists()
        assert new_path.parent == isolated_resized_dir
        with Image.open(new_path) as img:
            new_w, new_h = img.size
        assert max(new_w, new_h) <= 2000
        # Aspect ratio preserved (within rounding)
        assert abs((new_w / new_h) - (5788 / 4093)) < 0.01

    async def test_extra_input_fields_preserved(self, tmp_path):
        src = _write_png(tmp_path / "big.png", 3000, 2500)
        original_input = {
            "file_path": str(src),
            "limit": 2000,
            "offset": 0,
        }
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": original_input},
            tool_use_id="tu1",
            context={},
        )
        out = result["hookSpecificOutput"]
        assert out["updatedInput"]["limit"] == 2000
        assert out["updatedInput"]["offset"] == 0
        # file_path was rewritten
        assert out["updatedInput"]["file_path"] != str(src)


# ── EXIF orientation ──────────────────────────────────────────────────────────


class TestEXIFOrientation:
    async def test_exif_rotated_image_baked_in(self, tmp_path):
        # Source is 3000 wide × 2500 tall, with EXIF orientation=6 (rotate 90 CW).
        # After exif_transpose, the visual orientation is 2500×3000 — long
        # side along height. The resized PNG should reflect that.
        src_path = tmp_path / "rotated.jpg"
        img = Image.new("RGB", (3000, 2500), color=(10, 20, 30))
        # Build a minimal EXIF block with Orientation=6
        exif = img.getexif()
        exif[0x0112] = 6  # Orientation tag
        img.save(src_path, format="JPEG", exif=exif.tobytes())

        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src_path)}},
            tool_use_id="tu1",
            context={},
        )
        new_path = Path(result["hookSpecificOutput"]["updatedInput"]["file_path"])
        with Image.open(new_path) as out_img:
            w, h = out_img.size
        # After exif_transpose + thumbnail to 2000, the long side is height
        assert h >= w


# ── Idempotency ───────────────────────────────────────────────────────────────


class TestIdempotency:
    async def test_second_call_same_dst_no_reencode(self, tmp_path):
        src = _write_png(tmp_path / "big.png", 4000, 3000)
        r1 = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu1",
            context={},
        )
        dst1 = Path(r1["hookSpecificOutput"]["updatedInput"]["file_path"])
        mtime_before = dst1.stat().st_mtime_ns

        r2 = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu2",
            context={},
        )
        dst2 = Path(r2["hookSpecificOutput"]["updatedInput"]["file_path"])
        assert dst1 == dst2
        # File should not have been rewritten
        assert dst2.stat().st_mtime_ns == mtime_before

    async def test_source_change_invalidates_cache(self, tmp_path):
        src = tmp_path / "big.png"
        _write_png(src, 4000, 3000, color=(10, 10, 10))
        r1 = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu1",
            context={},
        )
        dst1 = Path(r1["hookSpecificOutput"]["updatedInput"]["file_path"])

        # Rewrite source — different content, different size, different mtime
        _write_png(src, 4500, 3500, color=(200, 200, 200))
        r2 = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu2",
            context={},
        )
        dst2 = Path(r2["hookSpecificOutput"]["updatedInput"]["file_path"])
        assert dst1 != dst2


# ── Concurrency ───────────────────────────────────────────────────────────────


class TestConcurrency:
    async def test_parallel_calls_produce_valid_file(self, tmp_path):
        src = _write_png(tmp_path / "big.png", 5000, 4000)
        results = await asyncio.gather(
            *[
                image_resize_hook(
                    {
                        "tool_name": "Read",
                        "tool_input": {"file_path": str(src)},
                    },
                    tool_use_id=f"tu{i}",
                    context={},
                )
                for i in range(8)
            ]
        )
        dsts = {r["hookSpecificOutput"]["updatedInput"]["file_path"] for r in results}
        # All point at the same deterministic destination
        assert len(dsts) == 1
        dst = Path(next(iter(dsts)))
        # And the final file is a valid PNG
        with Image.open(dst) as img:
            img.verify()


# ── Error path ────────────────────────────────────────────────────────────────


class TestErrorPaths:
    async def test_corrupt_image_returns_empty(self, tmp_path, caplog):
        src = tmp_path / "corrupt.png"
        # PNG-ish header followed by garbage so PIL header read fails
        src.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)
        with caplog.at_level(logging.WARNING):
            result = await image_resize_hook(
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": str(src)},
                },
                tool_use_id="tu1",
                context={},
            )
        assert result == {}
        assert any(
            getattr(rec, "_name", None) == "IMAGE_RESIZE_HOOK_ERROR"
            for rec in caplog.records
        )


# ── additionalContext gating ──────────────────────────────────────────────────


class TestAdditionalContextThreshold:
    async def test_marginal_resize_no_tiling_hint(self, tmp_path):
        # 2200px long side ⇒ ratio 1.1, below the 1.5x threshold
        src = _write_png(tmp_path / "marginal.png", 2200, 1500)
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu1",
            context={},
        )
        out = result["hookSpecificOutput"]
        assert "additionalContext" not in out

    async def test_aggressive_resize_includes_tiling_hint(self, tmp_path):
        # 5800px ⇒ ratio 2.9, well above the 1.5x threshold
        src = _write_png(tmp_path / "huge.png", 5800, 942)
        result = await image_resize_hook(
            {"tool_name": "Read", "tool_input": {"file_path": str(src)}},
            tool_use_id="tu1",
            context={},
        )
        out = result["hookSpecificOutput"]
        assert "additionalContext" in out
        ctx = out["additionalContext"]
        assert "5800" in ctx
        assert "sub-region" in ctx or "tile" in ctx.lower()

    def test_build_additional_context_unit(self):
        # Pure-function check on the threshold logic
        assert _build_additional_context((2200, 1500), (2000, 1364)) is None
        assert _build_additional_context((3001, 1000), (2000, 666)) is not None


# ── Telemetry ─────────────────────────────────────────────────────────────────


class TestTelemetry:
    async def test_applied_log_emitted(self, tmp_path, caplog):
        src = _write_png(tmp_path / "big.png", 4000, 3000)
        with caplog.at_level(logging.WARNING):
            await image_resize_hook(
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": str(src)},
                },
                tool_use_id="tu_log",
                context={},
            )
        applied = [
            rec
            for rec in caplog.records
            if "IMAGE_RESIZE_HOOK_APPLIED" in rec.getMessage()
        ]
        assert applied, "expected IMAGE_RESIZE_HOOK_APPLIED log"
        msg = applied[0].getMessage()
        assert "4000x3000" in msg
        assert "->" in msg
