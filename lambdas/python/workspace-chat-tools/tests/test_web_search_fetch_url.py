"""Tests for web_search fetch_url result propagation.

Focus: the binary/S3-reference shape returned by browser-lambda when it
sniffs a binary served from an extensionless URL must be propagated to the
caller intact (no `content` field, carrying the S3 reference), alongside the
existing text-page and error paths staying backward compatible.
"""

import unittest
from unittest.mock import patch

from tools.web_search import _handle_fetch_url


class TestHandleFetchUrl(unittest.TestCase):
    def test_binary_file_result_is_propagated(self):
        browser_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_type": "",
            "file_size": 1234,
            "links_enqueued": 0,
        }
        with patch(
            "tools.web_search._invoke_browser_lambda", return_value=browser_result
        ):
            out = _handle_fetch_url({"url": "https://example.com/report"})

        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result_type"], "binary_file")
        self.assertEqual(out["content_type"], "application/pdf")
        self.assertEqual(out["s3_key"], browser_result["s3_key"])
        self.assertEqual(out["file_size"], 1234)
        # Critically: no decoded text content for a binary
        self.assertNotIn("content", out)

    def test_binary_file_download_url_is_propagated(self):
        """The presigned download_url from browser-lambda is forwarded so the
        agent-side handler can stream the bytes into the workspace."""
        browser_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_type": "",
            "file_size": 1234,
            "download_url": "https://signed.example/get?sig=abc",
            "links_enqueued": 0,
        }
        with patch(
            "tools.web_search._invoke_browser_lambda", return_value=browser_result
        ):
            out = _handle_fetch_url({"url": "https://example.com/report"})

        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result_type"], "binary_file")
        self.assertEqual(out["download_url"], "https://signed.example/get?sig=abc")

    def test_binary_file_without_download_url_omits_key(self):
        """Older browser-lambda omits download_url; the key must not be
        fabricated (tolerant reader downstream)."""
        browser_result = {
            "url": "https://example.com/report",
            "status": "success",
            "result_type": "binary_file",
            "content_type": "application/pdf",
            "s3_key": "documents/company/web-crawler/example.com/report",
            "file_type": "",
            "file_size": 1234,
            "links_enqueued": 0,
        }
        with patch(
            "tools.web_search._invoke_browser_lambda", return_value=browser_result
        ):
            out = _handle_fetch_url({"url": "https://example.com/report"})

        self.assertEqual(out["status"], "success")
        self.assertNotIn("download_url", out)

    def test_text_page_result_is_unchanged(self):
        browser_result = {
            "url": "https://example.com/page",
            "status": "success",
            "content": "# Title\n\nbody text",
            "title": "Title",
            "contentType": "text/markdown",
        }
        with patch(
            "tools.web_search._invoke_browser_lambda", return_value=browser_result
        ):
            out = _handle_fetch_url({"url": "https://example.com/page"})

        self.assertEqual(out["status"], "success")
        self.assertEqual(out["content"], "# Title\n\nbody text")
        self.assertEqual(out["content_type"], "text/markdown")
        self.assertNotIn("result_type", out)

    def test_failed_result_surfaces_error(self):
        browser_result = {
            "url": "https://example.com/missing",
            "status": "failed",
            "reason": "HTTP 404 from origin",
            "http_status": 404,
        }
        with patch(
            "tools.web_search._invoke_browser_lambda", return_value=browser_result
        ):
            out = _handle_fetch_url({"url": "https://example.com/missing"})

        self.assertEqual(out["status"], "error")
        self.assertEqual(out["http_status"], 404)
        self.assertEqual(out["content"], "")

    def test_missing_url_raises(self):
        with self.assertRaises(ValueError):
            _handle_fetch_url({})


if __name__ == "__main__":
    unittest.main()
