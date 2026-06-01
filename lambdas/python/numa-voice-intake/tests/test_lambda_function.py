"""Unit tests for numa-voice-intake.

Covers the audit blockers/contracts: case-insensitive extension handling,
the source-bucket guard, unsafe-filename rejection, and — critically — that a
copy-to-KB failure PROPAGATES (so S3 retries) instead of being silently swallowed
and losing the prospect upload.
"""

import pytest

import lambda_function as lf


def test_pure_path_helpers():
    assert lf._filename("a/b/prospects.xlsx") == "prospects.xlsx"
    assert (
        lf._kb_s3_key("prospects.xlsx")
        == "documents/company/voice/intake/prospects.xlsx"
    )
    assert lf._intake_file("prospects.xlsx") == "voice/intake/prospects.xlsx"


def test_handle_record_rejects_unsafe_filename():
    # _filename strips path segments; a key resolving to '..' must be refused
    # before any copy/emit happens.
    assert lf._handle_record("bucket", "a/..", "etag") is None


def _s3_event(bucket, key):
    return {
        "Records": [
            {"s3": {"bucket": {"name": bucket}, "object": {"key": key, "eTag": "etag"}}}
        ]
    }


def test_handler_skips_non_spreadsheet(monkeypatch):
    monkeypatch.setattr(lf, "INTAKE_BUCKET", "intake")
    assert lf.handler(_s3_event("intake", "notes.txt"), None)["processed"] == 0


def test_handler_ignores_unexpected_bucket(monkeypatch):
    monkeypatch.setattr(lf, "INTAKE_BUCKET", "intake")
    assert (
        lf.handler(_s3_event("some-other-bucket", "prospects.xlsx"), None)["processed"]
        == 0
    )


def test_handler_accepts_uppercase_extension(monkeypatch):
    # The blocker fix relies on the case-insensitive check (the S3 filterSuffix
    # was removed); .XLSX must be processed.
    monkeypatch.setattr(lf, "INTAKE_BUCKET", "intake")
    monkeypatch.setattr(
        lf, "_copy_to_kb", lambda b, k, f: "documents/company/voice/intake/" + f
    )
    emitted: list[str] = []
    monkeypatch.setattr(
        lf, "_emit_prospect_event", lambda filename, ts, etag: emitted.append(filename)
    )
    res = lf.handler(_s3_event("intake", "Prospects.XLSX"), None)
    assert res["processed"] == 1
    assert emitted == ["Prospects.XLSX"]


def test_copy_failure_propagates_for_s3_retry(monkeypatch):
    # The blocker fix: a copy failure must NOT be swallowed (was silently losing
    # the prospect upload); it propagates so S3's async retry re-delivers.
    monkeypatch.setattr(lf, "INTAKE_BUCKET", "intake")

    def _boom(_bucket, _key, _filename):
        raise RuntimeError("copy failed")

    monkeypatch.setattr(lf, "_copy_to_kb", _boom)
    with pytest.raises(RuntimeError):
        lf.handler(_s3_event("intake", "prospects.xlsx"), None)
