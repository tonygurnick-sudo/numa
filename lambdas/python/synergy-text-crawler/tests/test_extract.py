"""Unit tests for the worker's text extraction + file-type policy."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract import (  # noqa: E402
    LEGACY_EXTS,
    TEXT_EXTS,
    SkipType,
    extract_text,
    file_ext,
)


class TestFileExt(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(file_ext("Drawing Register.PDF"), "pdf")
        self.assertEqual(file_ext("notes.txt"), "txt")
        self.assertEqual(file_ext("archive.tar.gz"), "gz")

    def test_no_extension(self):
        self.assertEqual(file_ext("README"), "")
        self.assertEqual(file_ext(""), "")
        self.assertEqual(file_ext(None), "")


class TestTypePolicy(unittest.TestCase):
    def test_text_and_legacy_disjoint(self):
        self.assertFalse(TEXT_EXTS & LEGACY_EXTS)

    def test_cad_not_text(self):
        for ext in ("dwg", "dgn", "12da", "xml4d", "las", "zip", "png"):
            self.assertNotIn(ext, TEXT_EXTS)


class TestExtractText(unittest.TestCase):
    def test_plain_text(self):
        self.assertEqual(extract_text(b"hello world", "txt"), "hello world")

    def test_csv(self):
        self.assertIn("a,b,c", extract_text(b"a,b,c\n1,2,3", "csv"))

    def test_unicode_replacement(self):
        # Invalid UTF-8 must not raise — indexing is best-effort.
        out = extract_text(b"\xff\xfe broken", "txt")
        self.assertIn("broken", out)

    def test_rtf_strip(self):
        rtf = rb"{\rtf1\ansi Hello \b World\b0 }"
        out = extract_text(rtf, "rtf")
        self.assertIn("Hello", out)
        self.assertIn("World", out)
        self.assertNotIn("\\rtf1", out)

    def test_html_strip(self):
        out = extract_text(b"<html><body><p>Pipe spec</p></body></html>", "html")
        self.assertIn("Pipe spec", out)
        self.assertNotIn("<p>", out)

    def test_unknown_type_skips(self):
        with self.assertRaises(SkipType):
            extract_text(b"\x00\x01", "dwg")

    def test_eml_headers_and_body(self):
        # Emails are text-like but never .txt — must be indexed (stdlib path).
        eml = (
            b"Subject: Pipe order\r\nFrom: a@x.com\r\nTo: b@y.com\r\n"
            b"Content-Type: text/plain\r\n\r\nPlease supply 50m of DN100."
        )
        out = extract_text(eml, "eml")
        self.assertIn("Pipe order", out)
        self.assertIn("DN100", out)

    def test_eml_in_allowlist(self):
        self.assertIn("eml", TEXT_EXTS)
        self.assertIn("msg", TEXT_EXTS)


class TestPerTypeSizeCap(unittest.TestCase):
    """Junk (CAD-heavy PDFs) is excluded from the LISTING by a tight per-type
    cap — never downloaded — so 8TB of graphics is never pulled."""

    def test_pdf_cap_tighter_than_default(self):
        import lambda_function as lf

        self.assertLess(lf._max_bytes_for("pdf"), lf._max_bytes_for("docx"))
        self.assertEqual(lf._max_bytes_for("docx"), lf.DEFAULT_MAX_BYTES)
        self.assertEqual(lf._max_bytes_for("pdf"), lf.PDF_MAX_BYTES)


if __name__ == "__main__":
    unittest.main()
