# pylint: disable=protected-access
import dataclasses
import io
import json
import unittest
from unittest.mock import MagicMock, patch

import docx
from docx.enum.text import WD_BREAK

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
    @patch("pdf.process_pdf_document", return_value={1: "Sample pdf content"})
    def test_handler_pdf(
        self,
        mock_pdf_process,
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

        # s3_client.get_object should not be called as pdf.process_pdf_document handles the S3 interaction
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
        # Verify that pdf.process_pdf_document was called with the correct arguments
        mock_pdf_process.assert_called_once_with("test-bucket", "test.pdf")
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


class TestDocxExtraction(unittest.TestCase):
    def test_extract_docx_pages_empty_document(self):
        """
        A document with no (non-empty) paragraphs.
        We expect one 'page' that is empty, because the fallback logic
        treats a completely empty doc as a single page.
        """
        doc = docx.Document()
        # No paragraphs added
        f = io.BytesIO()
        doc.save(f)
        file_content = f.getvalue()

        pages = lambda_function.extract_docx_pages(file_content)

        # Expect exactly 1 page with empty text
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[1], "")

    def test_extract_docx_pages_only_page_break(self):
        """Edge case:
        A document with one paragraph that contains only a manual page break.
        This should result in 1 page, which are empty. We intentionally don't
        add a second empty page for no reason despite the manual page break.
        """
        doc = docx.Document()
        p = doc.add_paragraph("")  # an empty paragraph
        run = p.add_run()
        run.add_break(WD_BREAK.PAGE)

        f = io.BytesIO()
        doc.save(f)
        file_content = f.getvalue()

        pages = lambda_function.extract_docx_pages(file_content)

        # Expect 1 page empty
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[1].strip(), "")

    def test_extract_docx_pages_text_then_page_break(self):
        """Edge case:
        A document with some text in the first paragraph, then a manual page break,
        and no text after that. We expect 1 page with text. We intentionally don't
        add a second empty page for no reason despite the manual page break.
        """
        doc = docx.Document()
        p = doc.add_paragraph("This is some text on page 1.")
        run = p.add_run()
        run.add_break(WD_BREAK.PAGE)
        # No more paragraphs

        f = io.BytesIO()
        doc.save(f)
        file_content = f.getvalue()

        pages = lambda_function.extract_docx_pages(file_content)

        # Expect 2 pages
        self.assertEqual(len(pages), 1)
        # Page 1 should contain the text
        self.assertIn("This is some text on page 1.", pages[1])

    def create_test_docx_two_pages(self) -> bytes:
        """
        Creates an in-memory DOCX file with two pages.
        Page 1: Two paragraphs. The second paragraph includes a manual page break.
        Page 2: One paragraph.
        """
        doc = docx.Document()
        # Page 1, first paragraph.
        doc.add_paragraph("This is page 1, first paragraph.")
        # Page 1, second paragraph with a manual page break.
        p = doc.add_paragraph("This is page 1, second paragraph.")
        run = p.add_run()
        run.add_break(WD_BREAK.PAGE)
        # Page 2, first paragraph.
        doc.add_paragraph("This is page 2, first paragraph.")

        f = io.BytesIO()
        doc.save(f)
        return f.getvalue()

    def test_extract_docx_pages_with_two_pages_of_text(self):
        """
        A document with a page break in the middle, both pages contain text.
        """
        file_content = self.create_test_docx_two_pages()
        pages = lambda_function.extract_docx_pages(file_content)

        # Verify that two pages are returned.
        self.assertEqual(len(pages), 2)

        # Extract text for each page.
        page1 = pages[1]
        page2 = pages[2]

        # Check that page 1 contains the two paragraphs from page 1.
        self.assertIn("This is page 1, first paragraph.", page1)
        self.assertIn("This is page 1, second paragraph.", page1)
        # Check that page 2 contains the expected paragraph.
        self.assertIn("This is page 2, first paragraph.", page2)

    def test_extract_docx_pages_paragraph_with_break_in_middle(self):
        """
        Creates a DOCX with one paragraph that contains text before a manual page break and then text after.
        The test verifies that the full text ("Hello, world!") is captured in one page.
        """
        doc = docx.Document()
        p = doc.add_paragraph()
        # Add first run with text "Hello, "
        run1 = p.add_run("Hello, ")
        # Insert a manual page break
        run1.add_break(WD_BREAK.PAGE)
        # Add additional text after the break
        p.add_run("world!")

        # Save document to an in-memory bytes buffer.
        f = io.BytesIO()
        doc.save(f)
        file_content = f.getvalue()

        pages = lambda_function.extract_docx_pages(file_content)

        # Concatenate the text from all pages.
        full_text = "".join(pages[i] for i in sorted(pages.keys()))
        self.assertEqual(full_text.strip(), "Hello, world!")

        # Verify that the text is in one page.
        self.assertEqual(len(pages), 1)


if __name__ == "__main__":
    unittest.main()
