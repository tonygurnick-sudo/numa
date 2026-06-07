"""Canonical atomic, integrity-preserving file I/O for the /workdir boundary.

Single source of truth for every byte that crosses the AgentCore MicroVM
``/workdir`` edge. The whole point of routing writes through here:

- **Atomic:** every write lands via a temp file in the *same directory* +
  ``fsync`` + ``os.replace`` (atomic on POSIX). A crash/partial transfer can
  never leave a truncated file at the final path for a later read to consume.
- **Verified:** streamed downloads can be sha256-checked end-to-end; on any
  mismatch we raise and discard the temp file, so corrupt bytes never appear
  at the destination.
- **Streamed:** downloads chunk through a fixed buffer, never whole-file RAM.

Do not write into ``/workdir`` any other way. ``open(..., "wb")`` /
``Path.write_bytes`` / ``Path.write_text`` directly to a final path are
non-atomic and must be replaced with these helpers.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
import uuid
from pathlib import Path
from typing import Union

_CHUNK = 1024 * 1024  # 1 MiB streaming window

PathLike = Union[str, "os.PathLike[str]"]


class FileIntegrityError(Exception):
    """A streamed transfer failed sha256/size verification (bytes discarded)."""


def _tmp_for(dest: Path) -> Path:
    # Same directory so os.replace is a pure rename (one filesystem, atomic).
    # Leading dot + uuid so concurrent writers to the same final path never
    # collide and the partial is hidden from listings.
    return dest.parent / f".{dest.name}.part-{uuid.uuid4().hex}"


def _discard(tmp: Path) -> None:
    try:
        os.unlink(tmp)
    except OSError:
        pass


def atomic_write_bytes(data: bytes, dest: PathLike) -> None:
    """Write *data* to *dest* atomically (temp + fsync + os.replace)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = _tmp_for(dest)
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, dest)
    except BaseException:
        _discard(tmp)
        raise


def atomic_write_text(text: str, dest: PathLike, encoding: str = "utf-8") -> None:
    """Write *text* to *dest* atomically. Convenience over atomic_write_bytes."""
    atomic_write_bytes(text.encode(encoding), dest)


def verify_bytes_sha256(data: bytes, expected_sha256: str | None) -> None:
    """Raise FileIntegrityError if sha256(data) != expected. No-op if expected is falsy."""
    if not expected_sha256:
        return
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected_sha256:
        raise FileIntegrityError(
            f"sha256 mismatch: expected {expected_sha256}, got {actual} "
            f"over {len(data)} bytes."
        )


def verify_file_sha256(path: PathLike, expected_sha256: str | None) -> None:
    """Re-hash the file on disk; raise + delete it on mismatch. No-op if expected falsy."""
    if not expected_sha256:
        return
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != expected_sha256:
        _discard(Path(path))
        raise FileIntegrityError(
            f"sha256 mismatch on {path}: expected {expected_sha256}, got {actual}. "
            "Deleted the corrupt file."
        )


def atomic_download_url(
    url: str,
    dest: PathLike,
    *,
    expected_sha256: str | None = None,
    expected_size: int | None = None,
) -> int:
    """Stream *url* into *dest* atomically; verify sha256/size if supplied.

    Returns the number of bytes written. On a sha256 or size mismatch the temp
    file is discarded and FileIntegrityError is raised, so the final path is
    never populated with unverified/partial bytes.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = _tmp_for(dest)
    digest = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(url) as resp, open(tmp, "wb") as f:
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                f.write(chunk)
                digest.update(chunk)
                total += len(chunk)
            f.flush()
            os.fsync(f.fileno())
        if expected_sha256 and digest.hexdigest() != expected_sha256:
            raise FileIntegrityError(
                f"sha256 mismatch on download: expected {expected_sha256}, "
                f"got {digest.hexdigest()} over {total} bytes."
            )
        if expected_size is not None and total != expected_size:
            raise FileIntegrityError(
                f"size mismatch on download: expected {expected_size} bytes, "
                f"got {total}."
            )
        os.replace(tmp, dest)
        return total
    except BaseException:
        _discard(tmp)
        raise
