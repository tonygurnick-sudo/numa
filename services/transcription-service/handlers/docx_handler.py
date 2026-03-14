"""Native DOCX extraction using python-docx."""

import structlog
from docx import Document

logger = structlog.get_logger(__name__)


def extract_docx(file_path: str) -> list[dict]:
    """Extract text from a DOCX file, splitting on page breaks."""
    try:
        doc = Document(file_path)
    except Exception as e:
        logger.error("Failed to open DOCX", error=str(e))
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to open DOCX: {e})"}
        ]

    pages: list[dict] = []
    current_text: list[str] = []
    page_num = 1

    for element in doc.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            # Check for page break
            has_break = False
            for run in element.findall(
                ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}br"
            ):
                if (
                    run.get(
                        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type"
                    )
                    == "page"
                ):
                    has_break = True
                    break

            if has_break and current_text:
                text = "\n".join(current_text)
                pages.append(
                    {
                        "page_number": page_num,
                        "num_words": len(text.split()),
                        "text": text,
                    }
                )
                current_text = []
                page_num += 1

            # Extract paragraph text
            texts = element.itertext()
            para_text = "".join(texts).strip()
            if para_text:
                current_text.append(para_text)

        elif tag == "tbl":
            # Extract table
            rows: list[str] = []
            for tr in element.findall(
                ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tr"
            ):
                cells = []
                for tc in tr.findall(
                    ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tc"
                ):
                    cell_text = "".join(tc.itertext()).strip()
                    cells.append(cell_text)
                if cells:
                    rows.append("| " + " | ".join(cells) + " |")
            if rows:
                current_text.append("\n".join(rows))

    # Last page
    if current_text:
        text = "\n".join(current_text)
        pages.append(
            {"page_number": page_num, "num_words": len(text.split()), "text": text}
        )

    if not pages:
        pages = [{"page_number": 1, "num_words": 0, "text": "(Empty DOCX document)"}]

    logger.info("DOCX extraction complete", pages=len(pages))
    return pages
