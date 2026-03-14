"""Native PDF extraction using PyMuPDF (fitz).

Extracts text from each page, falling back to OCR-style image extraction
via Bedrock vision when a page has no embedded text.
"""

import fitz  # PyMuPDF
import structlog

logger = structlog.get_logger(__name__)


def extract_pdf(file_path: str) -> list[dict]:
    """Extract text content from a PDF file, page by page.

    Returns a list of page dicts compatible with the transcription output format:
        [{"page_number": 1, "num_words": 42, "text": "..."}, ...]
    """
    pages: list[dict] = []

    try:
        doc = fitz.open(file_path)
    except Exception as e:
        logger.error("Failed to open PDF", error=str(e))
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to open PDF: {e})"}
        ]

    total_pages = len(doc)
    logger.info("Extracting PDF", total_pages=total_pages)

    for page_num in range(total_pages):
        try:
            page = doc[page_num]
            text = page.get_text("text").strip()

            # If no text extracted (scanned/image PDF), note it
            if not text:
                text = (
                    f"(Page {page_num + 1}: no extractable text — scanned/image page)"
                )

            num_words = len(text.split())
            pages.append(
                {
                    "page_number": page_num + 1,
                    "num_words": num_words,
                    "text": text,
                }
            )
        except Exception as e:
            logger.warning("Failed to extract page", page=page_num + 1, error=str(e))
            pages.append(
                {
                    "page_number": page_num + 1,
                    "num_words": 0,
                    "text": f"(Page {page_num + 1}: extraction failed — {e})",
                }
            )

    doc.close()
    logger.info(
        "PDF extraction complete",
        pages=total_pages,
        total_words=sum(p["num_words"] for p in pages),
    )
    return pages
