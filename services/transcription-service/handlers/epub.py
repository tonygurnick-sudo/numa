"""EPUB extraction via ebooklib — extract HTML chapters and strip tags."""

import re
from html import unescape

import ebooklib
from ebooklib import epub


def extract_epub(file_path: str) -> list[dict]:
    """Extract text from EPUB file, returning a list of page dicts."""
    book = epub.read_epub(file_path, options={"ignore_ncx": True})
    pages: list[dict] = []

    for idx, item in enumerate(book.get_items_of_type(ebooklib.ITEM_DOCUMENT)):
        html_content = item.get_content().decode("utf-8", errors="replace")
        text = _strip_html(html_content).strip()
        if not text:
            continue
        pages.append(
            {
                "page_number": idx + 1,
                "num_words": len(text.split()),
                "text": text,
            }
        )

    return pages


_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(html: str) -> str:
    """Remove HTML tags and unescape entities."""
    return unescape(_TAG_RE.sub("", html))
