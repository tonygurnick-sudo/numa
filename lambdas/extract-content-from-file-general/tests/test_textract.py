# pylint: disable=protected-access
import unittest
from unittest.mock import patch

import textract


class TestTextract(unittest.TestCase):
    def test_get_text_on_pages(self):
        blocks = [
            {"BlockType": "LINE", "Text": "Sample text", "Page": 1},
            {"BlockType": "LINE", "Text": "Another line", "Page": 1},
        ]
        extracted_text = textract._get_text_on_pages(blocks)
        self.assertEqual(extracted_text, {1: "Sample text\nAnother line\n"})

    def test_get_page_count(self):
        blocks = [
            {"BlockType": "LINE", "Text": "Sample text", "Page": 1},
            {"BlockType": "LINE", "Text": "Another page text", "Page": 2},
        ]
        page_count = textract._get_page_count(blocks)
        self.assertEqual(page_count, 2)

    @patch("textract._get_blocks")
    @patch("textract._start_job")
    def test_extract_text_success(self, start_job_mock, get_blocks_mock):
        start_job_mock.return_value = "job_id"
        get_blocks_mock.return_value = [
            {"BlockType": "LINE", "Text": "Sample text", "Page": 1},
            {"BlockType": "LINE", "Text": "Another page text", "Page": 2},
        ]

        result = textract.get_text_from_document("test-bucket", "test-key")

        expected_result = (
            "Title: test-key\n\n"
            "Page 1:\nSample text\n\n"
            "Page 2:\nAnother page text\n\n"
        )

        self.assertEqual(result, expected_result)
        start_job_mock.assert_called_once_with("test-bucket", "test-key")
        get_blocks_mock.assert_called_once_with("job_id")


if __name__ == "__main__":
    unittest.main()
