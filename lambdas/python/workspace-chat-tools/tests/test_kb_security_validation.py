import unittest
from typing import cast
from unittest.mock import patch

from aws_lambda_powertools.utilities.typing import LambdaContext

from lambda_function import handler
from tools.knowledge_base import handle_add_to_kb, handle_retrieve_kb_file
from tools.list_kb_files import handle_list_kb_files


class TestKbSecurityValidation(unittest.TestCase):
    def test_add_to_kb_rejects_path_in_filename(self):
        with self.assertRaises(ValueError) as ctx:
            handle_add_to_kb(
                {
                    "filename": "../../secret.txt",
                    "kb_id": "company",
                    "content_base64": "dGVzdA==",
                    "__allowed_kbs": ["company"],
                    "__user_sub": "user-123",
                }
            )

        self.assertIn("path separators", str(ctx.exception))

    def test_retrieve_requires_user_identity(self):
        with patch("tools.knowledge_base.DATA_BUCKET_NAME", "test-data-bucket"):
            with self.assertRaises(ValueError) as ctx:
                handle_retrieve_kb_file(
                    {
                        "mode": "list",
                        "kb_id": "company",
                        "__allowed_kbs": ["company"],
                    }
                )

        self.assertIn("User identity required", str(ctx.exception))

    def test_retrieve_rejects_folder_path_traversal(self):
        with patch("tools.knowledge_base.DATA_BUCKET_NAME", "test-data-bucket"):
            with self.assertRaises(ValueError) as ctx:
                handle_retrieve_kb_file(
                    {
                        "mode": "download_folder",
                        "kb_id": "company",
                        "folder_path": "../secrets",
                        "__allowed_kbs": ["company"],
                        "__user_sub": "user-123",
                    }
                )

        self.assertIn("path traversal", str(ctx.exception))

    def test_retrieve_rejects_traversal_in_uri(self):
        with patch("tools.knowledge_base.DATA_BUCKET_NAME", "test-data-bucket"):
            with patch("tools.knowledge_base.verify_kb_access", return_value=True):
                with self.assertRaises(ValueError) as ctx:
                    handle_retrieve_kb_file(
                        {
                            "mode": "download",
                            "uri": "s3://test-data-bucket/documents/company/../other-kb/secret.txt",
                            "__allowed_kbs": ["company"],
                            "__user_sub": "user-123",
                        }
                    )

        self.assertIn("path traversal", str(ctx.exception))

    def test_list_kb_files_requires_user_identity(self):
        with self.assertRaises(ValueError) as ctx:
            handle_list_kb_files({"kb_ids": ["company"]})

        self.assertIn("User identity required", str(ctx.exception))

    def test_lambda_handler_denies_retrieve_without_user_sub(self):
        event = {
            "tool": "retrieve_kb_file",
            "allowed_kbs": ["company"],
            "params": {"mode": "list", "kb_id": "company"},
        }

        context = cast(LambdaContext, object())
        response = handler(event, context)

        self.assertEqual(response["status"], "error")
        self.assertIn("User authentication required", response["error"])


if __name__ == "__main__":
    unittest.main()
