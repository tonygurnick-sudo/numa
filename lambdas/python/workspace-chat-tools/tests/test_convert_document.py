"""Tests for convert_document tool's input-format allowlist.

The Python-side allowlist in `tools/convert_document.py` must stay in sync with
the Node Lambda's `LIBREOFFICE_EXTENSIONS` in `lambdas/node/document-converter/
index.ts`. These tests guard against drift between the two lists.
"""

import unittest

from tools.convert_document import VALID_INPUT_FORMATS


class TestValidInputFormats(unittest.TestCase):
    """Assert all supported file formats appear in the input allowlist."""

    def test_powerpoint_template_formats(self):
        """`.pot` and `.potx` PowerPoint templates are common
        enterprise/government formats. LibreOffice handles them transparently."""
        self.assertIn("pot", VALID_INPUT_FORMATS)
        self.assertIn("potx", VALID_INPUT_FORMATS)

    def test_word_template_format(self):
        """`.dotx` Word templates — same as `.pot`/`.potx` but for Word."""
        self.assertIn("dotx", VALID_INPUT_FORMATS)

    def test_html_input(self):
        """HTML→PDF: LibreOffice converts HTML natively via
        `soffice --convert-to pdf foo.html`. Saves an `execute_script`
        weasyprint fallback that the model was reaching for."""
        self.assertIn("html", VALID_INPUT_FORMATS)
        self.assertIn("htm", VALID_INPUT_FORMATS)

    def test_existing_formats_preserved(self):
        """Regression guard: the formats we already supported must still be here."""
        for fmt in (
            "pdf",
            "docx",
            "doc",
            "pptx",
            "ppt",
            "xlsx",
            "xls",
            "odp",
            "ods",
            "odt",
            "rtf",
        ):
            self.assertIn(fmt, VALID_INPUT_FORMATS, f"Lost support for .{fmt}")


if __name__ == "__main__":
    unittest.main()
