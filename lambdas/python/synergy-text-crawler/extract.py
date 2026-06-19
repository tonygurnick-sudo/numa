"""Text extraction for the Synergy KB crawler worker.

Only text-bearing document types are extracted — CAD/binary geometry (where the
terabytes live) is skipped. Each extractor is best-effort: a corrupt or
password-protected file raises and the caller records an error rather than
killing the whole job.

This is ported from ``tools/synergy_text_crawler.py`` and trimmed for the Lambda
runtime. The optional extractor libraries (pdfplumber, python-docx, openpyxl,
python-pptx) are baked into the container image, so the ImportError fallbacks in
the original script are unnecessary here — but we keep PyPDF2 as a PDF fallback.
"""

from __future__ import annotations

import io
import re

# Only these are downloaded + text-extracted. Everything else (CAD, models,
# point clouds, images, archives) is skipped — that's where the terabytes are
# and there are no words in them.
TEXT_EXTS = {
    "pdf",
    "docx",
    "xlsx",
    "xlsm",
    "pptx",
    "txt",
    "csv",
    "tsv",
    "md",
    "rtf",
    "xml",
    "json",
    "htm",
    "html",
    "log",
    # Emails are text-like but never a .txt extension — index them too.
    "eml",
    "msg",
}

# Legacy binary Office (need LibreOffice/textract) — skipped but counted so we
# know how much is being left on the table.
LEGACY_EXTS = {"doc", "xls", "ppt"}


class SkipType(Exception):
    """Raised when a file's type cannot be text-extracted."""


def file_ext(name: "str | None") -> str:
    name = (name or "").lower()
    return name.rsplit(".", 1)[-1] if "." in name else ""


def extract_text(data: bytes, ext: str) -> str:
    """Extract plain text from a document's bytes. Raises SkipType if unsupported."""
    if ext in ("txt", "csv", "tsv", "md", "log", "xml", "json"):
        return data.decode("utf-8", errors="replace")
    if ext in ("htm", "html"):
        try:
            from bs4 import BeautifulSoup

            return BeautifulSoup(data, "html.parser").get_text(" ", strip=True)
        except ImportError:
            return re.sub(r"<[^>]+>", " ", data.decode("utf-8", errors="replace"))
    if ext == "pdf":
        return _pdf(data)
    if ext == "docx":
        return _docx(data)
    if ext in ("xlsx", "xlsm"):
        return _xlsx(data)
    if ext == "pptx":
        return _pptx(data)
    if ext == "eml":
        return _eml(data)
    if ext == "msg":
        return _msg(data)
    if ext == "rtf":
        # Crude RTF strip; good enough for indexing.
        txt = data.decode("latin-1", errors="replace")
        txt = re.sub(r"\\'[0-9a-fA-F]{2}", " ", txt)
        txt = re.sub(r"\\[a-zA-Z]+-?\d* ?", " ", txt)
        return re.sub(r"[{}]", " ", txt)
    raise SkipType(ext)


def _pdf(data: bytes) -> str:
    try:
        import pdfplumber

        out = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                out.append(page.extract_text() or "")
        return "\n".join(out)
    except ImportError:
        pass
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except ImportError as exc:
        raise SkipType("pdf (no extractor available)") from exc


def _docx(data: bytes) -> str:
    try:
        import docx
    except ImportError as exc:
        raise SkipType("docx (python-docx not available)") from exc
    document = docx.Document(io.BytesIO(data))
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.append("\t".join(c.text for c in row.cells))
    return "\n".join(parts)


def _xlsx(data: bytes) -> str:
    try:
        import openpyxl
    except ImportError as exc:
        raise SkipType("xlsx (openpyxl not available)") from exc
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f"# Sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None]
            if cells:
                out.append("\t".join(cells))
    return "\n".join(out)


def _eml(data: bytes) -> str:
    """RFC-822 email (.eml) — headers + the plain-text body (HTML stripped).
    Pure stdlib, no dependency."""
    from email import policy
    from email.parser import BytesParser

    msg = BytesParser(policy=policy.default).parsebytes(data)
    parts = [
        f"Subject: {msg.get('subject', '')}",
        f"From: {msg.get('from', '')}",
        f"To: {msg.get('to', '')}",
        f"Date: {msg.get('date', '')}",
        "",
    ]
    try:
        body = msg.get_body(preferencelist=("plain", "html"))
    except Exception:  # noqa: BLE001 — malformed MIME; fall back to raw decode
        body = None
    if body is not None:
        content = body.get_content()
        if body.get_content_type() == "text/html":
            try:
                from bs4 import BeautifulSoup

                content = BeautifulSoup(content, "html.parser").get_text(
                    " ", strip=True
                )
            except ImportError:
                content = re.sub(r"<[^>]+>", " ", content)
        parts.append(content)
    else:
        parts.append(data.decode("utf-8", errors="replace"))
    return "\n".join(parts)


def _msg(data: bytes) -> str:
    """Outlook email (.msg) — headers + body via extract-msg."""
    try:
        import extract_msg
    except ImportError as exc:
        raise SkipType("msg (extract-msg not available)") from exc
    message = extract_msg.openMsg(io.BytesIO(data))

    # openMsg's declared return type is the base MSGFile; the header/body
    # attributes live on the concrete subclass, so read them via getattr.
    def _f(attr: str) -> str:
        return str(getattr(message, attr, "") or "")

    parts = [
        f"Subject: {_f('subject')}",
        f"From: {_f('sender')}",
        f"To: {_f('to')}",
        f"Date: {_f('date')}",
        "",
        _f("body"),
    ]
    return "\n".join(parts)


def _pptx(data: bytes) -> str:
    try:
        from pptx import Presentation
    except ImportError as exc:
        raise SkipType("pptx (python-pptx not available)") from exc
    prs = Presentation(io.BytesIO(data))
    out = []
    for slide in prs.slides:
        for shape in slide.shapes:
            # has_text_frame guards access, but the pptx stubs don't narrow it.
            text_frame = (
                getattr(shape, "text_frame", None) if shape.has_text_frame else None
            )
            if text_frame is not None:
                out.append(text_frame.text)
    return "\n".join(out)
