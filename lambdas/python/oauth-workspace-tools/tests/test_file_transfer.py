"""Tests for the shared connector-download transfer helper.

Guards the 6 MB Lambda-response hex-truncation bug: large downloads must be
staged to S3 (file_content_url) rather than hex-encoded inline (file_content).
"""

import importlib
import unittest
from unittest import mock


class TestBuildDownloadPayload(unittest.TestCase):
    def _load_module(self):
        """Import file_transfer with OUTPUTS_BUCKET set and S3 stubbed."""
        import tools.file_transfer as ft

        # reload() mutates the module in place — don't rebind. Its return type is the
        # generic ModuleType, which loses the OUTPUTS_BUCKET symbol and makes pyright
        # reject the assignment below (reportAttributeAccessIssue).
        importlib.reload(ft)
        ft.OUTPUTS_BUCKET = "test-outputs-bucket"
        return ft

    def test_small_file_stays_inline_as_hex(self) -> None:
        ft = self._load_module()
        content = b"hello world"
        payload = ft.build_download_payload(content, "x.txt", "user-1", "synergy")
        self.assertIn("file_content", payload)
        self.assertNotIn("file_content_url", payload)
        self.assertEqual(payload["file_content"], content.hex())
        self.assertIn("content_sha256", payload)

    def test_large_file_returns_url_not_inline(self) -> None:
        ft = self._load_module()
        # 3 MB > OAUTH_INLINE_MAX (2 MB): must stage to S3, never hex inline.
        content = b"\x00" * (3 * 1024 * 1024)
        with mock.patch.object(ft, "s3_client") as s3:
            s3.generate_presigned_url.return_value = "https://signed.example/get"
            payload = ft.build_download_payload(content, "big.bin", "user-1", "synergy")
        self.assertNotIn("file_content", payload)
        self.assertIn("file_content_url", payload)
        self.assertIn("content_sha256", payload)
        self.assertIn("s3_key", payload)
        s3.put_object.assert_called_once()

    def test_inline_threshold_boundary(self) -> None:
        ft = self._load_module()
        # Exactly at the cap -> still inline (<=).
        content = b"\x01" * ft.OAUTH_INLINE_MAX
        payload = ft.build_download_payload(content, "edge.bin", "user-1", "syn")
        self.assertIn("file_content", payload)
        self.assertNotIn("file_content_url", payload)


if __name__ == "__main__":
    unittest.main()
