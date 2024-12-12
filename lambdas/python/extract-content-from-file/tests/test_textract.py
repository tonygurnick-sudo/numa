# pylint: disable=protected-access
import unittest
from unittest.mock import patch

import textract


class TestTextract(unittest.TestCase):
    def test_get_text_on_one_page(self):
        blocks = [
            {"BlockType": "LINE", "Text": "Text", "Page": 1},
            {"BlockType": "LINE", "Text": "Text on another line", "Page": 1},
        ]
        pages = textract._get_pages(blocks)
        self.assertEqual(
            pages,
            {
                1: "Text\nText on another line\n",
            },
        )

    def test_get_text_on_two_pages(self):
        blocks = [
            {"BlockType": "LINE", "Text": "Text", "Page": 1},
            {"BlockType": "LINE", "Text": "Text on another page", "Page": 2},
        ]
        pages = textract._get_pages(blocks)
        self.assertEqual(
            pages,
            {
                1: "Text\n",
                2: "Text on another page\n",
            },
        )

    @patch(
        "textract.textract_client.start_document_text_detection",
        side_effect=Exception("Textract job did not start properly."),
    )
    def test_start_job_failure(self, _start_document_mock):
        with self.assertRaises(Exception) as context:
            textract._start_job("test-bucket", "test-key")

        self.assertEqual(str(context.exception), "Textract job did not start properly.")

    @patch(
        "textract._get_blocks",
        side_effect=Exception("Textract job failed."),
    )
    @patch("textract._start_job", return_value="test_job_id")
    def test_textract_job_failure(self, start_job_mock, get_blocks_mock):
        with self.assertRaises(Exception) as context:
            textract.get_pages_from_document("test-bucket", "test-key")

        self.assertEqual(str(context.exception), "Textract job failed.")
        start_job_mock.assert_called_once_with("test-bucket", "test-key")
        get_blocks_mock.assert_called_once_with("test_job_id")


if __name__ == "__main__":
    unittest.main()
