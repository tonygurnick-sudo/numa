import importlib
import os

"""Focused tests for the workspace-chat-agent-proxy security/cleanup fixes.

These import the Lambda module, which pulls in fastapi/boto3/jwt/requests. When
those runtime deps aren't installed (e.g. a bare checkout with no poetry env)
the whole module is skipped so the suite still collects cleanly; in CI (where
`poetry install` has run) the real assertions execute.
"""

import threading
import unittest

import pytest

# Skip the entire module if the Lambda's runtime deps aren't available.
lf = pytest.importorskip(
    "lambda_function",
    reason="workspace-chat-agent-proxy runtime deps (fastapi/boto3/...) not installed",
)

from fastapi import HTTPException  # noqa: E402  (after importorskip on purpose)


class ValidateCloudfrontSecretTest(unittest.TestCase):
    """FEAT-009: the CloudFront secret must be required whenever it's configured.

    A direct Function-URL call carrying only an Authorization header must NOT be
    accepted unless ALLOW_DIRECT_INVOKE is explicitly enabled.
    """

    def setUp(self) -> None:
        # Snapshot module globals we mutate so each test is isolated.
        self._orig_secret = lf.CLOUDFRONT_SECRET
        self._orig_allow = lf.ALLOW_DIRECT_INVOKE

    def tearDown(self) -> None:
        lf.CLOUDFRONT_SECRET = self._orig_secret
        lf.ALLOW_DIRECT_INVOKE = self._orig_allow

    def test_valid_secret_passes(self):
        lf.CLOUDFRONT_SECRET = "topsecret"
        lf.ALLOW_DIRECT_INVOKE = False
        # Should not raise.
        lf.validate_cloudfront_secret("topsecret", authorization=None)

    def test_wrong_secret_rejected(self):
        lf.CLOUDFRONT_SECRET = "topsecret"
        lf.ALLOW_DIRECT_INVOKE = False
        with self.assertRaises(HTTPException) as ctx:
            lf.validate_cloudfront_secret("nope", authorization="Bearer jwt")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_no_secret_with_auth_is_rejected_by_default(self):
        """The core FEAT-009 fix: JWT alone no longer bypasses the secret."""
        lf.CLOUDFRONT_SECRET = "topsecret"
        lf.ALLOW_DIRECT_INVOKE = False
        with self.assertRaises(HTTPException) as ctx:
            lf.validate_cloudfront_secret(None, authorization="Bearer valid-jwt")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_no_secret_no_auth_rejected(self):
        lf.CLOUDFRONT_SECRET = "topsecret"
        lf.ALLOW_DIRECT_INVOKE = False
        with self.assertRaises(HTTPException):
            lf.validate_cloudfront_secret(None, authorization=None)

    def test_allow_direct_invoke_restores_jwt_bypass(self):
        """Explicit opt-in lets a direct call through, but still needs auth."""
        lf.CLOUDFRONT_SECRET = "topsecret"
        lf.ALLOW_DIRECT_INVOKE = True
        # With Authorization → allowed.
        lf.validate_cloudfront_secret(None, authorization="Bearer valid-jwt")
        # Without Authorization → still rejected.
        with self.assertRaises(HTTPException):
            lf.validate_cloudfront_secret(None, authorization=None)

    def test_unconfigured_secret_skips_validation(self):
        lf.CLOUDFRONT_SECRET = ""
        lf.ALLOW_DIRECT_INVOKE = False
        # Dev mode: no secret configured → always allowed.
        lf.validate_cloudfront_secret(None, authorization=None)


class _FakeStreamingBody:
    """Minimal botocore StreamingBody stand-in for the reader-cleanup test.

    iter_chunks blocks on a never-released event after yielding the seeded
    chunks, simulating a slow/long-lived upstream stream. close() releases it
    (this is what unblocks a reader parked inside iter_chunks). ``reader_done``
    is set when the iterator actually finishes — i.e. the background reader
    function has returned, which is exactly what BUG-258 must guarantee.
    """

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self._block = threading.Event()
        self.closed = False
        self.reader_done = threading.Event()

    def iter_chunks(self, chunk_size=128):
        try:
            for chunk in self._chunks:
                yield chunk
            # Block until close() is called — mimics waiting on more upstream data.
            self._block.wait(timeout=10)
        finally:
            self.reader_done.set()

    def close(self):
        self.closed = True
        self._block.set()


class StreamReaderCleanupTest(unittest.IsolatedAsyncioTestCase):
    """BUG-258: the background reader must not leak when the client disconnects.

    Before the fix the reader thread stayed parked inside iter_chunks forever
    (the future was dropped, nothing closed the body). After the fix the
    generator's finally block sets a stop flag and closes the body, so the
    reader returns promptly.
    """

    async def test_reader_stops_on_client_disconnect(self):
        body = _FakeStreamingBody([b"data: hello\n\n"])
        resp = lf._stream_response({"response": body, "statusCode": 200})

        agen = resp.body_iterator
        # Pull the first real chunk so the reader thread is up and parked on the
        # blocking wait inside iter_chunks.
        first = await agen.__anext__()
        self.assertEqual(first, b"data: hello\n\n")
        self.assertFalse(
            body.reader_done.is_set(), "reader should still be running mid-stream"
        )

        # Simulate the client disconnecting: closing the async generator throws
        # GeneratorExit into it, which must trigger the finally-block cleanup.
        await agen.aclose()

        # Cleanup must have closed the upstream body and let the reader finish.
        self.assertTrue(body.closed, "streaming body was not closed on disconnect")
        self.assertTrue(
            body.reader_done.wait(timeout=5),
            "reader thread did not terminate after client disconnect (leak)",
        )


def _load_module(env: dict):
    """(Re)import lambda_function with a controlled environment.

    The module reads configuration into module-level constants at import time,
    so each scenario needs a fresh import under the desired env.
    """
    saved = {
        k: os.environ.get(k)
        for k in (
            "COGNITO_USER_POOL_ID",
            "COGNITO_CLIENT_ID",
            "ADDITIONAL_COGNITO_CLIENT_IDS",
        )
    }
    try:
        for key in saved:
            os.environ.pop(key, None)
        os.environ.update(env)
        import lambda_function

        return importlib.reload(lambda_function)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class DummyTest(unittest.TestCase):
    def test_dummy(self):
        always_true = True
        self.assertTrue(always_true)


class SecurityHardeningTest(unittest.TestCase):
    """Covers the fail-closed fixes: BUG-007 and BUG-259."""

    def test_extract_user_sub_fails_closed_without_pool_id(self):
        # BUG-007: with no COGNITO_USER_POOL_ID we must reject (401) rather than
        # fall back to an unverified decode that accepts any token.
        mod = _load_module({"COGNITO_CLIENT_ID": "client-abc"})
        # A structurally-valid but unsigned JWT (header.payload.signature).
        forged = (
            "eyJhbGciOiJub25lIn0."  # {"alg":"none"}
            "eyJzdWIiOiJhdHRhY2tlciJ9."  # {"sub":"attacker"}
            "sig"
        )
        with self.assertRaises(mod.HTTPException) as ctx:
            mod.extract_user_sub(f"Bearer {forged}")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_allowed_client_ids_drops_empty_strings(self):
        # BUG-259: an unset client id must not leave "" in the audience set,
        # which would make PyJWT skip audience validation.
        mod = _load_module({"COGNITO_CLIENT_ID": ""})
        self.assertNotIn("", mod.ALLOWED_CLIENT_IDS)
        self.assertEqual(mod.ALLOWED_CLIENT_IDS, set())

    def test_allowed_client_ids_keeps_real_ids(self):
        mod = _load_module(
            {
                "COGNITO_CLIENT_ID": "primary",
                "ADDITIONAL_COGNITO_CLIENT_IDS": "extra-1, ,extra-2",
            }
        )
        self.assertEqual(mod.ALLOWED_CLIENT_IDS, {"primary", "extra-1", "extra-2"})

    def test_redirect_slashes_disabled(self):
        # BUG-178: trailing-slash redirects leak the Function URL origin.
        mod = _load_module({"COGNITO_CLIENT_ID": "client-abc"})
        self.assertFalse(mod.app.router.redirect_slashes)


if __name__ == "__main__":
    unittest.main()
