# pylint: disable=protected-access
import dataclasses
import json
import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestException(Exception):
    pass


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    @patch("bedrock.get_text_from_image")
    @patch("textract.get_pages_from_document")
    def test_handler_txt_file(
        self,
        mock_textract,
        mock_bedrock,
        mock_s3_client,
    ):
        mock_s3_client.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"Sample text content")
        }
        event = {
            "input_bucket": "test-bucket",
            "input_key": "test.txt",
            "return_content": True,
        }

        response = lambda_function.handler(event, {})

        self.assertEqual(response["content"], "Sample text content\n")

        mock_s3_client.get_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="test.txt",
        )
        mock_s3_client.put_object.assert_called_once()
        kwargs = mock_s3_client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], "test-bucket")
        self.assertEqual(kwargs["Key"], "test.txt.json")
        self.assertDictEqual(
            json.loads(kwargs["Body"]),
            {
                "name": "test.txt",
                "num_pages": 1,
                "pages": [
                    {"num_words": 3, "page_number": 1, "text": "Sample text content"}
                ],
                "total_num_words": 3,
            },
        )
        mock_textract.assert_not_called()
        mock_bedrock.assert_not_called()

    @patch("lambda_function.s3_client")
    @patch("bedrock.get_text_from_image")
    @patch("textract.get_pages_from_document")
    def test_handler_empty_txt_file(
        self,
        mock_textract,
        mock_bedrock,
        mock_s3_client,
    ):
        mock_s3_client.get_object.return_value = {
            "Body": MagicMock(read=lambda: b""),
        }
        event = {
            "input_bucket": "test-bucket",
            "input_key": "empty.txt",
            "return_content": True,
        }

        response = lambda_function.handler(event, {})

        self.assertEqual(response["content"], "\n")

        mock_s3_client.get_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="empty.txt",
        )
        mock_s3_client.put_object.assert_called_once()
        kwargs = mock_s3_client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], "test-bucket")
        self.assertEqual(kwargs["Key"], "empty.txt.json")
        self.assertDictEqual(
            json.loads(kwargs["Body"]),
            {
                "name": "empty.txt",
                "num_pages": 1,
                "pages": [{"num_words": 0, "page_number": 1, "text": ""}],
                "total_num_words": 0,
            },
        )
        mock_textract.assert_not_called()
        mock_bedrock.assert_not_called()

    @patch("lambda_function.s3_client")
    def test_handler_unsupported_filetype_error(
        self,
        mock_s3_client,
    ):
        event = {
            "input_bucket": "test-bucket",
            "input_key": "unsupported.xyz",
        }

        with self.assertRaises(lambda_function.UnsupportedFileFormat):
            lambda_function.handler(event, {})

        mock_s3_client.get_object.assert_not_called()
        mock_s3_client.put_object.assert_not_called()

    @patch("lambda_function.s3_client")
    @patch("textract.get_pages_from_document")
    @patch("bedrock.get_text_from_image")
    def test_handler_s3_exception(
        self,
        mock_bedrock,
        mock_textract,
        mock_s3_client,
    ):
        # Test overall exception handling with unexpected error
        mock_s3_client.get_object.side_effect = TestException("S3 error")
        event = {
            "input_bucket": "test-bucket",
            "input_key": "error.txt",
        }

        with self.assertRaises(TestException):
            lambda_function.handler(event, {})

        mock_s3_client.get_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="error.txt",
        )
        mock_textract.assert_not_called()
        mock_bedrock.assert_not_called()

    @patch("lambda_function.s3_client")
    @patch("bedrock.get_text_from_image", return_value="Sample image content")
    @patch("textract.get_pages_from_document")
    def test_handler_image(
        self,
        mock_textract,
        mock_bedrock,
        mock_s3_client,
    ):
        event = {
            "input_bucket": "test-bucket",
            "input_key": "test.png",
            "return_content": True,
        }

        response = lambda_function.handler(event, {})

        self.assertEqual(response["content"], "Sample image content\n")

        mock_s3_client.get_object.assert_not_called()
        mock_s3_client.put_object.assert_called_once()
        kwargs = mock_s3_client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], "test-bucket")
        self.assertEqual(kwargs["Key"], "test.png.json")
        self.assertDictEqual(
            json.loads(kwargs["Body"]),
            {
                "name": "test.png",
                "num_pages": 1,
                "pages": [
                    {"num_words": 3, "page_number": 1, "text": "Sample image content"}
                ],
                "total_num_words": 3,
            },
        )
        mock_textract.assert_not_called()
        mock_bedrock.assert_called_once()

    @patch("lambda_function.s3_client")
    @patch("bedrock.get_text_from_image")
    @patch("textract.get_pages_from_document", return_value={1: "Sample pdf content"})
    def test_handler_pdf(
        self,
        mock_textract,
        mock_bedrock,
        mock_s3_client,
    ):
        event = {
            "input_bucket": "test-bucket",
            "input_key": "test.pdf",
            "return_content": True,
        }

        response = lambda_function.handler(event, {})

        self.assertEqual(response["content"], "Sample pdf content\n")

        mock_s3_client.get_object.assert_not_called()
        mock_s3_client.put_object.assert_called_once()
        kwargs = mock_s3_client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], "test-bucket")
        self.assertEqual(kwargs["Key"], "test.pdf.json")
        self.assertDictEqual(
            json.loads(kwargs["Body"]),
            {
                "name": "test.pdf",
                "num_pages": 1,
                "pages": [
                    {"num_words": 3, "page_number": 1, "text": "Sample pdf content"}
                ],
                "total_num_words": 3,
            },
        )
        mock_textract.assert_called_once()
        mock_bedrock.assert_not_called()


class TestTextractConversion(unittest.TestCase):
    def test(self):
        document = lambda_function._textract_pages_to_document(
            {
                1: "First Page",
                2: "Second Page with more words",
            },
            "some-key",
        )
        self.assertDictEqual(
            dataclasses.asdict(document),
            {
                "name": "some-key",
                "num_pages": 2,
                "pages": [
                    {"num_words": 2, "page_number": 1, "text": "First Page"},
                    {
                        "num_words": 5,
                        "page_number": 2,
                        "text": "Second Page with more words",
                    },
                ],
                "total_num_words": 7,
            },
        )


if __name__ == "__main__":
    unittest.main()
