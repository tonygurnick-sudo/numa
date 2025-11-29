# pylint: disable=protected-access
import os
import sys
import unittest
import unittest.mock

# Add the lib directory to the Python path to find the modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/aws-transcribe"))
sys.path.append(os.path.join(project_root, "lib/helpers"))

# Mock JWT module
sys.modules["jwt"] = unittest.mock.Mock()  # type: ignore
sys.modules["aws_transcribe"] = unittest.mock.Mock()  # type: ignore

# Mock external dependencies before importing fm_vision_extraction
sys.modules["boto3"] = unittest.mock.Mock()
sys.modules["fitz"] = unittest.mock.Mock()
sys.modules["structlog"] = unittest.mock.Mock()
sys.modules["PIL"] = unittest.mock.Mock()

# Import AFTER mocking
import fm_vision_extraction  # pylint: disable=wrong-import-position


class TestHaikuExtractor(unittest.TestCase):
    def test_document_page_creation(self):
        """Test DocumentPage can be created"""
        page = fm_vision_extraction.DocumentPage(
            page_number=1, num_words=5, text="This is test text"
        )
        self.assertEqual(page.page_number, 1)
        self.assertEqual(page.num_words, 5)
        self.assertEqual(page.text, "This is test text")

    def test_document_creation(self):
        """Test Document can be created"""
        page = fm_vision_extraction.DocumentPage(
            page_number=1, num_words=5, text="test"
        )
        doc = fm_vision_extraction.Document(
            name="test.pdf", num_pages=1, total_num_words=5, pages=[page]
        )
        self.assertEqual(doc.name, "test.pdf")
        self.assertEqual(doc.num_pages, 1)
        self.assertEqual(doc.total_num_words, 5)
        self.assertEqual(len(doc.pages), 1)

    def test_functions_exist(self):
        """Test that required functions are defined"""
        self.assertTrue(callable(fm_vision_extraction.extract_content))
        self.assertTrue(callable(fm_vision_extraction._process_image))
        self.assertTrue(callable(fm_vision_extraction._process_pdf))
        self.assertTrue(callable(fm_vision_extraction.process_pages_concurrent))
        self.assertTrue(callable(fm_vision_extraction.pdf_to_images))
        self.assertTrue(callable(fm_vision_extraction._compress_image))
        self.assertTrue(callable(fm_vision_extraction.cleanup_s3_files))
        self.assertTrue(callable(fm_vision_extraction._create_document))


if __name__ == "__main__":
    unittest.main()
