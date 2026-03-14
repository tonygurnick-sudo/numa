"""LibreOffice-based conversion for legacy Office formats.

Converts .doc, .xls, .ppt, .pptx, .rtf, .odt, .ods, .odp, .pages, .key, .numbers
to PDF using LibreOffice headless, then extracts text via PyMuPDF.
"""

import os
import subprocess
import tempfile

import structlog

logger = structlog.get_logger(__name__)


def extract_via_libreoffice(file_path: str, ext: str) -> list[dict]:
    """Convert a document to PDF via LibreOffice, then extract text with PyMuPDF."""
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            result = subprocess.run(
                [
                    "libreoffice",
                    "--headless",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmpdir,
                    file_path,
                ],
                capture_output=True,
                timeout=300,
            )

            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")[:500]
                logger.error(
                    "LibreOffice conversion failed",
                    returncode=result.returncode,
                    stderr=stderr,
                )
                return [
                    {
                        "page_number": 1,
                        "num_words": 0,
                        "text": f"(LibreOffice conversion failed: {stderr})",
                    }
                ]

        except subprocess.TimeoutExpired:
            return [
                {
                    "page_number": 1,
                    "num_words": 0,
                    "text": "(LibreOffice conversion timed out)",
                }
            ]
        except FileNotFoundError:
            return [
                {
                    "page_number": 1,
                    "num_words": 0,
                    "text": "(LibreOffice not installed)",
                }
            ]

        # Find the output PDF
        pdf_files = [f for f in os.listdir(tmpdir) if f.lower().endswith(".pdf")]
        if not pdf_files:
            return [
                {
                    "page_number": 1,
                    "num_words": 0,
                    "text": "(LibreOffice produced no PDF output)",
                }
            ]

        pdf_path = os.path.join(tmpdir, pdf_files[0])

        # Extract text from the converted PDF using PyMuPDF
        from handlers.pdf import extract_pdf

        return extract_pdf(pdf_path)
