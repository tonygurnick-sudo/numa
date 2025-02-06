import os
import unittest
from unittest.mock import MagicMock, patch

import structlog

import s3_helpers

logger = structlog.getLogger(__name__)


class TestRead(unittest.TestCase):
    @patch.dict(os.environ, {})
    def test_no_bucket_env_variable(self) -> None:
        with self.assertRaises(KeyError):
            s3_helpers.read("key")

    @patch.dict(os.environ, {"BUCKET": "test-bucket"})
    @patch("s3_helpers.s3_client")
    def test_read(self, s3_client_mock) -> None:
        s3_client_mock.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"test content")
        }

        result = s3_helpers.read("test-key")

        self.assertEqual(result, b"test content")

        s3_client_mock.get_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="test-key",
        )


class TestWrite(unittest.TestCase):
    @patch.dict(os.environ, {})
    def test_no_bucket_env_variable(self) -> None:
        with self.assertRaises(KeyError):
            s3_helpers.write("key", b"string")

    @patch.dict(os.environ, {"BUCKET": "test-bucket"})
    @patch("s3_helpers.s3_client")
    def test_write(self, s3_client_mock) -> None:
        s3_helpers.write("test-key", b"test content")

        s3_client_mock.put_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="test-key",
            Body=b"test content",
            ContentType="text/plain",
        )


if __name__ == "__main__":
    unittest.main()
