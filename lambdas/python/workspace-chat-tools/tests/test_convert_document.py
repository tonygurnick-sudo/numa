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
        """PowerPoint templates: `.pot` (97-2003 legacy binary) and
        `.potx` (modern). Common enterprise/government formats —
        LibreOffice handles both transparently."""
        self.assertIn("pot", VALID_INPUT_FORMATS)
        self.assertIn("potx", VALID_INPUT_FORMATS)

    def test_word_template_formats(self):
        """Word templates: `.dot` (97-2003 legacy binary) and `.dotx` (modern)."""
        self.assertIn("dot", VALID_INPUT_FORMATS)
        self.assertIn("dotx", VALID_INPUT_FORMATS)

    def test_excel_template_formats(self):
        """Excel templates: `.xlt` (97-2003 legacy binary) and `.xltx` (modern)."""
        self.assertIn("xlt", VALID_INPUT_FORMATS)
        self.assertIn("xltx", VALID_INPUT_FORMATS)

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
