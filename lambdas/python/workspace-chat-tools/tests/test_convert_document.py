"""Tests for convert_document tool's input-format allowlist.

The Python-side allowlist in `tools/convert_document.py` must stay in sync with
the Node Lambda's `LIBREOFFICE_EXTENSIONS` in `lambdas/node/document-converter/
index.ts`. These tests guard against drift between the two lists.
"""

import unittest

from tools.convert_document import VALID_INPUT_FORMATS, _resolve_mode


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


class TestResolveMode(unittest.TestCase):
    """`_resolve_mode` auto-routes binary inputs to direct ('file') conversion.

    Regression guard for the "convert the .pptx I just made to PDF" failure:
    markdown mode utf-8-decodes the file as text and dies on binary Office formats
    with a cryptic ``'utf-8' codec can't decode`` error.
    """

    def test_office_binaries_force_file_mode(self):
        """A binary Office/PDF input is routed to 'file' even when 'markdown' is asked."""
        for path in (
            "/workdir/outputs/deck.pptx",
            "/workdir/outputs/report.docx",
            "/workdir/uploads/data.xlsx",
            "/workdir/outputs/paper.pdf",
            "/workdir/outputs/slides.odp",
            "/workdir/outputs/legacy.ppt",
        ):
            self.assertEqual(
                _resolve_mode(path, "markdown"),
                "file",
                f"{path} should route to file mode",
            )

    def test_extension_is_case_insensitive(self):
        self.assertEqual(
            _resolve_mode("/workdir/outputs/DECK.PPTX", "markdown"), "file"
        )

    def test_text_inputs_keep_requested_markdown(self):
        """Plain text/markdown inputs stay in markdown mode (Pandoc path)."""
        for path in (
            "/workdir/outputs/notes.md",
            "/workdir/outputs/readme.txt",
            "/workdir/outputs/doc.markdown",
            "/workdir/outputs/no_extension",
        ):
            self.assertEqual(_resolve_mode(path, "markdown"), "markdown")

    def test_explicit_file_mode_is_preserved(self):
        """An explicit file-mode request is never downgraded, even for text."""
        self.assertEqual(_resolve_mode("/workdir/outputs/notes.md", "file"), "file")


if __name__ == "__main__":
    unittest.main()
