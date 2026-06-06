"""
Tests for the proactive /workdir disk-space guard and the backend upload
size cap added to numa_workspace_agent.main.

Covers:
- get_workspace_free_bytes() via mocked os.statvfs
- _ensure_workspace_has_room() margin logic and fail-open behaviour
- _build_workspace_quota_error_payload() shape (mirrors ENOSPC envelope)
- MAX_UPLOAD_BYTES cap in _handle_upload (base64 path) and
  _handle_upload_complete (direct-S3 path), including the S3 HEAD
  size-mismatch defence.
"""

import errno
import os
from collections import namedtuple
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from numa_workspace_agent import main as m

# os.statvfs returns a struct with f_bavail and f_frsize among others.
_FakeStatvfs = namedtuple("FakeStatvfs", ["f_bavail", "f_frsize"])


def _statvfs_with_free(free_bytes: int) -> _FakeStatvfs:
    # 4096-byte fragments; f_bavail blocks gives the requested free bytes.
    frsize = 4096
    return _FakeStatvfs(f_bavail=free_bytes // frsize, f_frsize=frsize)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_max_upload_bytes_matches_frontend_500mb():
    assert m.MAX_UPLOAD_BYTES == 500 * 1024 * 1024


def test_get_workspace_free_bytes_reads_statvfs():
    with patch.object(os, "statvfs", return_value=_statvfs_with_free(2 * 1024**3)):
        free = m.get_workspace_free_bytes()
    # Rounded to the 4096 fragment, ~2 GB.
    assert free is not None
    assert abs(free - 2 * 1024**3) < 4096


def test_get_workspace_free_bytes_returns_none_on_oserror():
    with patch.object(os, "statvfs", side_effect=OSError("no such path")):
        assert m.get_workspace_free_bytes() is None


def test_ensure_room_passes_when_plenty_free():
    # 2 GB free, need 100 MB + 100 MB margin -> fits.
    with patch.object(m, "get_workspace_free_bytes", return_value=2 * 1024**3):
        assert m._ensure_workspace_has_room(100 * 1024 * 1024) is None


def test_ensure_room_rejects_when_insufficient():
    # 50 MB free, need 100 MB + margin -> reject.
    with patch.object(m, "get_workspace_free_bytes", return_value=50 * 1024 * 1024):
        err = m._ensure_workspace_has_room(100 * 1024 * 1024)
    assert err is not None
    assert err["errno"] == errno.ENOSPC
    assert err["type"] == "error"
    assert "disk full" in err["error"].lower()


def test_ensure_room_respects_margin():
    needed = 100 * 1024 * 1024
    # Free space exactly equal to needed but below needed+margin -> reject.
    with patch.object(m, "get_workspace_free_bytes", return_value=needed):
        assert m._ensure_workspace_has_room(needed) is not None
    # Free space at needed+margin -> pass.
    with patch.object(
        m,
        "get_workspace_free_bytes",
        return_value=needed + m.WORKSPACE_FREE_SPACE_MARGIN_BYTES,
    ):
        assert m._ensure_workspace_has_room(needed) is None


def test_ensure_room_fails_open_when_free_unknown():
    # statvfs failed -> None -> don't block (reactive ENOSPC is the backstop).
    with patch.object(m, "get_workspace_free_bytes", return_value=None):
        assert m._ensure_workspace_has_room(10 * 1024**3) is None


def test_ensure_room_noop_for_zero_or_negative():
    # Should not even call statvfs for a non-positive write.
    with patch.object(m, "get_workspace_free_bytes") as free:
        assert m._ensure_workspace_has_room(0) is None
        free.assert_not_called()


def test_quota_payload_mirrors_enospc_envelope():
    payload = m._build_workspace_quota_error_payload(
        needed_bytes=600 * 1024 * 1024, free_bytes=10 * 1024 * 1024
    )
    # Same keys/shape the reactive ENOSPC handler produces.
    assert set(payload) == {"type", "error", "error_type", "errno", "timestamp"}
    assert payload["errno"] == errno.ENOSPC
    assert payload["error_type"] == "OSError"
    assert "600.0 MB" in payload["error"]
    assert "10.0 MB" in payload["error"]


# ---------------------------------------------------------------------------
# _handle_upload (base64 path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_upload_rejects_oversized():
    import base64

    # 600 MB of zero bytes, base64-encoded. Build cheaply.
    big = b"\0" * (600 * 1024 * 1024)
    body = {"filename": "big.bin", "fileContent": base64.b64encode(big).decode()}
    with pytest.raises(HTTPException) as exc:
        await m._handle_upload(body, "user-sub", "conv-1")
    assert exc.value.status_code == 413
    assert "upload limit" in exc.value.detail


@pytest.mark.asyncio
async def test_handle_upload_rejects_when_disk_full():
    import base64

    small = base64.b64encode(b"hello world").decode()
    body = {"filename": "ok.txt", "fileContent": small}
    with patch.object(
        m,
        "_ensure_workspace_has_room",
        return_value={"error": "Workspace disk full: ..."},
    ):
        with pytest.raises(HTTPException) as exc:
            await m._handle_upload(body, "user-sub", "conv-1")
    assert exc.value.status_code == 507


# ---------------------------------------------------------------------------
# _handle_upload_complete (direct-to-S3 path)
# ---------------------------------------------------------------------------


def _good_complete_body(size: int) -> dict:
    return {
        "filename": "doc.pdf",
        "s3Key": "numa-chat/workspace/user-sub/conversations/conv-1/uploads/doc.pdf",
        "size": size,
    }


@pytest.mark.asyncio
async def test_upload_complete_rejects_oversized_reported_size():
    # Reported size over the cap must be rejected before any S3 work, so we
    # don't even need a bucket/S3 client configured.
    body = _good_complete_body(600 * 1024 * 1024)
    with pytest.raises(HTTPException) as exc:
        await m._handle_upload_complete(body, "user-sub", "conv-1")
    assert exc.value.status_code == 413


@pytest.mark.asyncio
async def test_upload_complete_rejects_size_mismatch():
    # Reported 1 MB but the real object is 50 MB -> mismatch rejection.
    body = _good_complete_body(1 * 1024 * 1024)
    fake_s3 = MagicMock()
    fake_s3.head_object.return_value = {"ContentLength": 50 * 1024 * 1024}
    with patch(
        "numa_workspace_agent.s3_workspace.OUTPUTS_BUCKET", "bucket", create=True
    ), patch.object(m.boto3, "client", return_value=fake_s3), patch.object(
        m, "get_workspace_free_bytes", return_value=10 * 1024**3
    ):
        with pytest.raises(HTTPException) as exc:
            await m._handle_upload_complete(body, "user-sub", "conv-1")
    assert exc.value.status_code == 400
    assert "does not match" in exc.value.detail
    fake_s3.download_file.assert_not_called()


@pytest.mark.asyncio
async def test_upload_complete_rejects_actual_over_cap():
    # Reported tiny, but the real S3 object is over the 500 MB cap.
    body = _good_complete_body(1024)
    fake_s3 = MagicMock()
    fake_s3.head_object.return_value = {"ContentLength": 600 * 1024 * 1024}
    with patch(
        "numa_workspace_agent.s3_workspace.OUTPUTS_BUCKET", "bucket", create=True
    ), patch.object(m.boto3, "client", return_value=fake_s3), patch.object(
        m, "get_workspace_free_bytes", return_value=10 * 1024**3
    ):
        with pytest.raises(HTTPException) as exc:
            await m._handle_upload_complete(body, "user-sub", "conv-1")
    assert exc.value.status_code == 413
    fake_s3.download_file.assert_not_called()


@pytest.mark.asyncio
async def test_upload_complete_rejects_when_disk_full():
    body = _good_complete_body(50 * 1024 * 1024)
    fake_s3 = MagicMock()
    fake_s3.head_object.return_value = {"ContentLength": 50 * 1024 * 1024}
    with patch(
        "numa_workspace_agent.s3_workspace.OUTPUTS_BUCKET", "bucket", create=True
    ), patch.object(m.boto3, "client", return_value=fake_s3), patch.object(
        m, "get_workspace_free_bytes", return_value=10 * 1024 * 1024  # only 10 MB free
    ):
        with pytest.raises(HTTPException) as exc:
            await m._handle_upload_complete(body, "user-sub", "conv-1")
    assert exc.value.status_code == 507
    fake_s3.download_file.assert_not_called()
