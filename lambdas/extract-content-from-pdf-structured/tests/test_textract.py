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

        # Expected document structure
        expected_document = textract.Document(
            name="test-key",
            num_pages=2,
            total_num_words=5,
            text=[
                textract.DocumentPage(page_number=1, num_words=2, text="Sample text\n"),
                textract.DocumentPage(
                    page_number=2, num_words=3, text="Another page text\n"
                ),
            ],
        )

        self.assertEqual(result.name, expected_document.name)
        self.assertEqual(result.num_pages, expected_document.num_pages)
        self.assertEqual(result.total_num_words, expected_document.total_num_words)
        self.assertEqual(len(result.text), len(expected_document.text))

        for i, page in enumerate(result.text):
            self.assertEqual(page.page_number, expected_document.text[i].page_number)
            self.assertEqual(page.num_words, expected_document.text[i].num_words)
            self.assertEqual(page.text, expected_document.text[i].text)

        start_job_mock.assert_called_once_with("test-bucket", "test-key")
        get_blocks_mock.assert_called_once_with("job_id")

    @patch("textract._get_blocks")
    @patch("textract._start_job")
    def test_extract_empty_document(self, start_job_mock, get_blocks_mock):
        # Simulate an empty document (no lines)
        start_job_mock.return_value = "job_id"
        get_blocks_mock.return_value = []

        result = textract.get_text_from_document("test-bucket", "empty-document")

        # Expected result should be a document with zero pages and zero words
        self.assertEqual(result.name, "empty-document")
        self.assertEqual(result.num_pages, 0)
        self.assertEqual(result.total_num_words, 0)
        self.assertEqual(result.text, [])

        start_job_mock.assert_called_once_with("test-bucket", "empty-document")
        get_blocks_mock.assert_called_once_with("job_id")

    @patch("textract.textract_client.start_document_text_detection")
    def test_start_job_failure(self, start_document_mock):
        # Simulate failure in starting the Textract job
        start_document_mock.side_effect = Exception(
            "Textract job did not start properly."
        )

        with self.assertRaises(Exception) as context:
            textract._start_job("test-bucket", "test-key")

        self.assertEqual(str(context.exception), "Textract job did not start properly.")

    @patch("textract._get_blocks", side_effect=Exception("Textract job failed."))
    @patch("textract._start_job", return_value="job_id")
    def test_textract_job_failure(self, start_job_mock, get_blocks_mock):
        # Simulate a job failure scenario
        with self.assertRaises(Exception) as context:
            textract.get_text_from_document("test-bucket", "test-key")

        self.assertEqual(str(context.exception), "Textract job failed.")
        start_job_mock.assert_called_once_with("test-bucket", "test-key")
        get_blocks_mock.assert_called_once_with("job_id")


if __name__ == "__main__":
    unittest.main()
