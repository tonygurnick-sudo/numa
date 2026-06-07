"""Tests for binary-vs-text sniffing in browser-lambda.

Verifies that binary payloads (PDF, ZIP/OOXML, images, ...) served from
extensionless URLs are routed to the stream-to-S3 path instead of being
UTF-8-decoded via ``r.text`` (which corrupts them into mojibake HTML).
"""

import hashlib
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

import lambda_function as lf


def _make_async_client_returning(response: httpx.Response):
    """Build a fake httpx.AsyncClient context manager whose .get() returns response."""

    class _FakeClient:
        async def get(self, *args, **kwargs):
            return response

    @asynccontextmanager
    async def _factory(*args, **kwargs):
        yield _FakeClient()

    return _factory


async def _run_fetch_page(response: httpx.Response):
    factory = _make_async_client_returning(response)
    with patch.object(lf.httpx, "AsyncClient", factory):
        return await lf.fetch_page("https://example.com/download")


class TestLooksBinary(unittest.TestCase):
    def test_pdf_magic_is_binary(self):
        self.assertTrue(lf._looks_binary(b"%PDF-1.7\n%abc", "text/html"))

    def test_zip_ooxml_magic_is_binary(self):
        # PK\x03\x04 is the ZIP / OOXML (docx/xlsx/pptx) signature
        self.assertTrue(lf._looks_binary(b"PK\x03\x04\x14\x00", "text/html"))

    def test_png_magic_is_binary(self):
        self.assertTrue(lf._looks_binary(b"\x89PNG\r\n\x1a\n", "text/plain"))

    def test_jpeg_magic_is_binary(self):
        self.assertTrue(lf._looks_binary(b"\xff\xd8\xff\xe0", "application/json"))

    def test_gzip_magic_is_binary(self):
        self.assertTrue(lf._looks_binary(b"\x1f\x8b\x08", ""))

    def test_html_body_is_text(self):
        self.assertFalse(
            lf._looks_binary(b"<!DOCTYPE html><html>", "text/html; charset=utf-8")
        )

    def test_json_content_type_is_text(self):
        self.assertFalse(lf._looks_binary(b'{"a": 1}', "application/json"))

    def test_plain_text_no_content_type_is_text(self):
        self.assertFalse(lf._looks_binary(b"just some words here", ""))

    def test_octet_stream_content_type_is_binary(self):
        # No magic match, but a non-text content-type => binary
        self.assertTrue(lf._looks_binary(b"raw bytes blob", "application/octet-stream"))

    def test_pdf_content_type_is_binary(self):
        self.assertTrue(lf._looks_binary(b"random", "application/pdf"))

    def test_unknown_text_subtype_is_text(self):
        # text/* subtypes we don't explicitly allowlist are still text
        self.assertFalse(lf._looks_binary(b"col1,col2\n1,2", "text/something-new"))

    def test_nul_byte_no_content_type_is_binary(self):
        self.assertTrue(lf._looks_binary(b"abc\x00def", ""))


class TestDecodeText(unittest.TestCase):
    def test_honours_declared_charset(self):
        body = "<html>café</html>".encode("iso-8859-1")
        resp = httpx.Response(
            200,
            headers={"content-type": "text/html; charset=iso-8859-1"},
            content=body,
        )
        self.assertEqual(lf._decode_text(resp), "<html>café</html>")

    def test_utf8_fallback_does_not_raise(self):
        # Invalid bytes for the declared charset must not raise; replacement kicks in
        resp = httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            content=b"\xff\xfe not valid utf8 \xc3",
        )
        # Should not raise
        out = lf._decode_text(resp)
        self.assertIsInstance(out, str)


class TestFetchPageRouting(unittest.IsolatedAsyncioTestCase):
    async def test_pdf_from_extensionless_url_returns_binary_sentinel(self):
        resp = httpx.Response(
            200,
            headers={"content-type": "application/octet-stream"},
            content=b"%PDF-1.7\nthis is a real pdf body, not html",
        )
        with patch.object(lf, "_parse_html") as parse_mock:
            result = await _run_fetch_page(resp)
        # Must NOT have attempted to parse as HTML/text
        parse_mock.assert_not_called()
        self.assertIsInstance(result, dict)
        self.assertTrue(result.get("_binary"))
        self.assertEqual(result.get("url"), "https://example.com/download")
        self.assertNotIn("content", result)

    async def test_zip_from_extensionless_url_returns_binary_sentinel(self):
        resp = httpx.Response(
            200,
            headers={"content-type": "text/html"},  # lying header -- magic wins
            content=b"PK\x03\x04\x14\x00\x06\x00 docx bytes here",
        )
        with patch.object(lf, "_parse_html") as parse_mock:
            result = await _run_fetch_page(resp)
        parse_mock.assert_not_called()
        self.assertTrue(result.get("_binary"))

    async def test_html_page_is_decoded_normally(self):
        html = b"<html><head><title>Hi</title></head><body>hello world</body></html>"
        resp = httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            content=html,
        )
        result = await _run_fetch_page(resp)
        self.assertIsInstance(result, dict)
        self.assertFalse(result.get("_binary"))
        self.assertIn("content", result)
        self.assertEqual(result.get("content_type"), "text/markdown")


class TestProcessUrlBinaryRouting(unittest.IsolatedAsyncioTestCase):
    async def test_sniffed_binary_routes_to_stream_to_s3(self):
        """A binary sniffed from an extensionless URL must stream to S3 and
        return the binary_file shape -- never text content."""
        binary_resp: lf.BinaryResponse = {
            "_binary": True,
            "url": "https://example.com/report",
            "content_type": "application/pdf",
        }

        digest = hashlib.sha256(b"the streamed pdf bytes").hexdigest()
        with patch.object(
            lf, "fetch_page", new=AsyncMock(return_value=binary_resp)
        ), patch.object(
            lf,
            "stream_url_to_s3",
            new=AsyncMock(
                return_value={
                    "success": True,
                    "file_size": 4242,
                    "sha256": digest,
                }
            ),
        ) as stream_mock, patch.object(
            lf, "create_metadata_sidecar", return_value=True
        ), patch.object(
            lf.s3,
            "generate_presigned_url",
            return_value="https://signed.example/get?sig=abc",
        ) as presign_mock:
            result = await lf.process_url(
                url="https://example.com/report",
                bucket="test-bucket",
                table_name="test-table",
                user_id="u1",
                crawl_depth=1,
                prefix="documents/company/web-crawler/",
                crawl_session_id="sess",
                kb_id="company",
                client_name="acme",
                return_content=True,
            )

        # Streamed to S3 -- not decoded as text
        stream_mock.assert_awaited_once()
        # Content-type was forwarded so the S3 object is typed correctly
        _, kwargs = stream_mock.call_args
        self.assertEqual(kwargs.get("content_type"), "application/pdf")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["result_type"], "binary_file")
        self.assertEqual(result["content_type"], "application/pdf")
        self.assertEqual(result["file_size"], 4242)
        self.assertIn("s3_key", result)
        # End-to-end integrity digest from the streamer is surfaced so the
        # agent can verify the bytes it pulls down are byte-exact.
        self.assertEqual(result["download_sha256"], digest)
        # A presigned GET was generated against the same bucket + key so the
        # agent can pull the bytes into its workspace.
        presign_mock.assert_called_once()
        _, presign_kwargs = presign_mock.call_args
        self.assertEqual(presign_kwargs["Params"]["Bucket"], "test-bucket")
        self.assertEqual(presign_kwargs["Params"]["Key"], result["s3_key"])
        self.assertEqual(presign_kwargs["ExpiresIn"], 900)
        self.assertEqual(result["download_url"], "https://signed.example/get?sig=abc")
        # Critically: no corrupted text content
        self.assertNotIn("content", result)

    async def test_presign_failure_still_returns_result_without_download_url(self):
        """If presigning fails, the binary_file result is still returned (with
        s3_key) so the delivery path never breaks -- just no download_url."""
        binary_resp: lf.BinaryResponse = {
            "_binary": True,
            "url": "https://example.com/report",
            "content_type": "application/pdf",
        }

        digest = hashlib.sha256(b"bytes regardless of presign").hexdigest()
        with patch.object(
            lf, "fetch_page", new=AsyncMock(return_value=binary_resp)
        ), patch.object(
            lf,
            "stream_url_to_s3",
            new=AsyncMock(
                return_value={
                    "success": True,
                    "file_size": 4242,
                    "sha256": digest,
                }
            ),
        ), patch.object(
            lf, "create_metadata_sidecar", return_value=True
        ), patch.object(
            lf.s3,
            "generate_presigned_url",
            side_effect=Exception("presign boom"),
        ):
            result = await lf.process_url(
                url="https://example.com/report",
                bucket="test-bucket",
                table_name="test-table",
                user_id="u1",
                crawl_depth=1,
                prefix="documents/company/web-crawler/",
                crawl_session_id="sess",
                kb_id="company",
                client_name="acme",
                return_content=True,
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["result_type"], "binary_file")
        self.assertIn("s3_key", result)
        self.assertNotIn("download_url", result)
        self.assertNotIn("content", result)
        # The integrity digest is independent of presigning: even when the
        # presigned URL fails, the agent still gets the SHA-256 (it can fall
        # back to s3_key for the bytes).
        self.assertEqual(result["download_sha256"], digest)

    async def test_sniffed_binary_without_bucket_fails_cleanly(self):
        """returnContent mode with no bucket must fail clearly, not decode."""
        binary_resp: lf.BinaryResponse = {
            "_binary": True,
            "url": "https://example.com/report",
            "content_type": "application/zip",
        }
        with patch.object(
            lf, "fetch_page", new=AsyncMock(return_value=binary_resp)
        ), patch.object(lf, "stream_url_to_s3", new=AsyncMock()) as stream_mock:
            result = await lf.process_url(
                url="https://example.com/report",
                bucket="",  # no bucket
                table_name="",
                user_id="u1",
                crawl_depth=1,
                prefix="",
                crawl_session_id="sess",
                kb_id="company",
                client_name="acme",
                return_content=True,
            )
        stream_mock.assert_not_called()
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("content", result)


def _make_stream_client(status_code: int, headers: dict, chunks: list[bytes]):
    """Build a fake httpx.AsyncClient whose .stream() yields a streaming
    response exposing the given chunks via .aiter_bytes()."""

    class _FakeStreamResponse:
        def __init__(self):
            self.status_code = status_code
            self.headers = headers

        async def aiter_bytes(self, chunk_size):  # noqa: ARG002
            for chunk in chunks:
                yield chunk

    class _FakeClient:
        @asynccontextmanager
        async def stream(self, *args, **kwargs):
            yield _FakeStreamResponse()

    @asynccontextmanager
    async def _factory(*args, **kwargs):
        yield _FakeClient()

    return _factory


class TestStreamUrlToS3Sha256(unittest.IsolatedAsyncioTestCase):
    """The streamed-to-S3 digest must be the SHA-256 of the EXACT bytes that
    land in S3 -- accumulated chunk-by-chunk, never buffering the whole file."""

    async def test_sha256_matches_streamed_bytes_across_chunks(self):
        # Multiple chunks so we exercise incremental hashing, not a single blob.
        chunks = [b"%PDF-1.7\n", b"part-two-bytes", b"\x00\x01\x02 tail bytes"]
        body = b"".join(chunks)
        expected = hashlib.sha256(body).hexdigest()

        fake_s3 = MagicMock()
        fake_s3.create_multipart_upload.return_value = {"UploadId": "uid-123"}
        # Each upload_part needs a distinct ETag echoed back.
        fake_s3.upload_part.side_effect = [
            {"ETag": f'"etag-{i}"'} for i in range(len(chunks))
        ]
        fake_s3.complete_multipart_upload.return_value = {}

        factory = _make_stream_client(200, {"content-type": "application/pdf"}, chunks)
        with patch.object(lf, "s3", fake_s3), patch.object(
            lf.httpx, "AsyncClient", factory
        ):
            result = await lf.stream_url_to_s3(
                "https://example.com/report", "test-bucket", "key/report.pdf"
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["file_size"], len(body))
        # The digest is over exactly the bytes that were uploaded.
        self.assertEqual(result["sha256"], expected)
        # And every chunk really was uploaded (digest covers all of them).
        uploaded = b"".join(
            call.kwargs["Body"] for call in fake_s3.upload_part.call_args_list
        )
        self.assertEqual(uploaded, body)
        self.assertEqual(hashlib.sha256(uploaded).hexdigest(), result["sha256"])


if __name__ == "__main__":
    unittest.main()
