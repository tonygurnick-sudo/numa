"""Lambda to extract text from a file in S3"""

import argparse
import dataclasses
import io
import json
import math
import os
import pathlib
import re
import tempfile
import time
import urllib.request
import uuid
from html import unescape
from typing import Any, Dict, Iterator, List, Sequence, TypeVar

import docx
import extract_msg
import structlog
from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.table import Table, _Cell, _Row  # pylint: disable=protected-access
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from opentelemetry import trace

import aws_transcribe
import fm_vision_extraction
import helpers
from fm_vision_extraction import Document, DocumentPage
from prm import client as prm_client

s3_client = prm_client("s3")
logger = structlog.get_logger(__name__)
tracer = trace.get_tracer(__name__)


def _try_append_event(
    event_msg: str,
    stream_events: bool,
    job_id: str | None,
    user_id: str | None,
    app_id: str | None,
    table_name: str | None,
    bucket: str | None,
) -> None:
    """Attempt to append an event if stream_events is enabled and context is available."""
    if not stream_events:
        return

    # All three IDs are required for event appending
    if not (job_id and user_id and app_id):
        return

    try:
        helpers.append_event(
            message=event_msg,
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=bool(table_name),
            table_name=table_name,
            bucket=bucket,
        )
    except Exception:
        logger.warning("Failed to append event", msg=event_msg)


# File extension constants
TEXT_FILE_EXTENSIONS = [
    ".bash",
    ".cfg",
    ".conf",
    ".css",
    ".csv",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".less",
    ".log",
    ".markdown",
    ".md",
    ".py",
    ".scss",
    ".sh",
    ".sql",
    ".tex",
    ".ts",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
]

# Vision extraction supported file formats
VISION_SUPPORTED_FORMATS = [
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
]

# Audio/video formats for transcription
AUDIO_VIDEO_FORMATS = [
    ".mp3",
    ".mp4",
    ".wav",
    ".flac",
    ".ogg",
    ".amr",
    ".webm",
    ".m4a",
]


class UnsupportedFileFormat(Exception):
    pass


# Define a type variable for document pages.
PageT = TypeVar("PageT", bound="DocumentPage")


# Excel-specific dataclasses extend the base ones.
@dataclasses.dataclass
class ExcelDocumentPage(DocumentPage):
    sheet_name: str = ""
    structure: dict = dataclasses.field(default_factory=dict)


@dataclasses.dataclass(frozen=True)
class ExcelDocument(Document):
    pages: Sequence[ExcelDocumentPage] = dataclasses.field(default_factory=list)


def _status_payload(
    *,
    status: str,
    input_bucket: str,
    input_key: str,
    output_bucket: str,
    output_key: str,
    file_name: str | None,
    started_at: int,
    request_id: str | None,
    include_completion: bool = False,
    error_message: str | None = None,
) -> dict:
    """Build a consistent status JSON payload."""
    payload: dict = {
        "version": 1,
        "status": status,
        "input_bucket": input_bucket,
        "input_key": input_key,
        "output_bucket": output_bucket,
        "output_key": output_key,
        "file_name": file_name,
        "started_at": started_at,
        "request_id": request_id,
    }
    if include_completion:
        now = int(time.time())
        payload["updated_at"] = now
        payload["duration_ms"] = int((now - started_at) * 1000)
    if error_message:
        payload["error_message"] = error_message
    return payload


def _write_status_json(bucket: str, key: str, payload: dict) -> None:
    """Write the status file to S3; log warnings on failure."""
    try:
        s3_client.put_object(
            Body=json.dumps(payload).encode("utf-8"),
            Bucket=bucket,
            Key=key,
            ContentType="application/json",
        )
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.warning(
            "Failed to write status file",
            error=str(e),
            status=payload.get("status"),
            key=key,
        )


def handler(event: dict, context) -> dict:
    helpers.setup_logging()

    if "body" in event:
        payload = json.loads(event["body"])
    else:
        payload = event

    # Dispatch based on action for chunked processing
    action = payload.get("action")
    if action == "prepare_chunks":
        return _handle_prepare_chunks(payload, context)
    elif action == "extract_chunk":
        return _handle_extract_chunk(payload, context)
    elif action == "merge_chunks":
        return _handle_merge_chunks(payload, context)

    # Default: standard extraction flow
    input_bucket = payload.get("input_bucket")
    input_key = payload.get("input_key")

    if not input_bucket or not input_key:
        raise ValueError("input_bucket and input_key are required")

    output_bucket = payload.get("output_bucket", input_bucket)
    output_key = payload.get("output_key", f"{input_key}.json")
    file_name = payload.get("file_name", None)

    # only set this to true when it's certain this will be less than 256KB
    return_content = event.get("return_content", False)

    # Event streaming parameters
    stream_events = payload.get("stream_events", False)
    job_id = payload.get("job_id")
    user_id = payload.get("user_id")
    app_id = payload.get("app_id")
    table_name = payload.get("table_name")
    # Derive a status file key alongside the output
    if output_key.endswith(".json"):
        status_key = output_key[: -len(".json")] + ".status.json"
    else:
        status_key = f"{output_key}.status.json"

    started_at = int(time.time())
    request_id = getattr(context, "aws_request_id", None)

    # Write initial IN_PROGRESS status (Numa chat polls for updates)
    _write_status_json(
        output_bucket,
        status_key,
        _status_payload(
            status="IN_PROGRESS",
            input_bucket=input_bucket,
            input_key=input_key,
            output_bucket=output_bucket,
            output_key=output_key,
            file_name=file_name,
            started_at=started_at,
            request_id=request_id,
        ),
    )

    # Determine display name for events
    file_display_name = file_name or os.path.basename(input_key)

    # Emit event before extraction
    _try_append_event(
        f"Extracting content from {file_display_name}",
        stream_events=stream_events,
        job_id=job_id,
        user_id=user_id,
        app_id=app_id,
        table_name=table_name,
        bucket=input_bucket,
    )

    try:
        # Pass payload to extraction for Excel processing options
        document = _extract_content(input_bucket, input_key, file_name, payload)

        content = json.dumps(dataclasses.asdict(document), indent=4).encode("utf-8")
        s3_client.put_object(Body=content, Bucket=output_bucket, Key=output_key)

        # Write SUCCEEDED status (Numa chat polls for updates)
        _write_status_json(
            output_bucket,
            status_key,
            _status_payload(
                status="SUCCEEDED",
                input_bucket=input_bucket,
                input_key=input_key,
                output_bucket=output_bucket,
                output_key=output_key,
                file_name=file_name,
                started_at=started_at,
                request_id=request_id,
                include_completion=True,
            ),
        )

        # Emit event after successful extraction
        _try_append_event(
            f"Successfully extracted content from {file_display_name}",
            stream_events=stream_events,
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            table_name=table_name,
            bucket=input_bucket,
        )

        result = {
            "input_bucket": input_bucket,
            "input_key": input_key,
            "output_bucket": output_bucket,
            "output_key": output_key,
        }
        if return_content:
            result["content"] = _document_to_string(document)

        logger.info(
            f"Document processed successfully: {input_key} -> {output_bucket}/{output_key}"
        )
        return result
    except Exception as e:
        # Write FAILED status (Numa chat polls for updates)
        _write_status_json(
            output_bucket,
            status_key,
            _status_payload(
                status="FAILED",
                input_bucket=input_bucket,
                input_key=input_key,
                output_bucket=output_bucket,
                output_key=output_key,
                file_name=file_name,
                started_at=started_at,
                request_id=request_id,
                include_completion=True,
                error_message=str(e),
            ),
        )
        raise


@tracer.start_as_current_span("_extract_docx_via_pdf")
def _extract_docx_via_pdf(
    input_bucket: str, input_key: str, file_name: str | None
) -> Document:
    """Convert DOCX to PDF via the document-converter Lambda, then extract
    content using the high-quality vision pipeline (PyMuPDF + Bedrock Vision).

    This produces much richer output than plain python-docx text extraction
    because the vision model can see embedded images, complex tables, and
    formatting that python-docx would miss entirely.

    Falls back to the legacy text-only extraction if the conversion fails.
    """
    converter_name = os.environ["DOCUMENT_CONVERTER_LAMBDA_NAME"]
    lambda_client = prm_client("lambda")
    temp_pdf_key = f"temp-docx-conversion/{input_key}.pdf"

    try:
        # 1. Invoke document-converter Lambda (DOCX → PDF via LibreOffice)
        logger.info(
            "Converting DOCX to PDF via document-converter",
            input_key=input_key,
            converter=converter_name,
        )
        converter_payload = json.dumps(
            {
                "body": json.dumps(
                    {
                        "action": "file",
                        "format": "pdf",
                        "sourceBucket": input_bucket,
                        "sourceKey": input_key,
                    }
                )
            }
        ).encode("utf-8")

        response = lambda_client.invoke(
            FunctionName=converter_name,
            InvocationType="RequestResponse",
            Payload=converter_payload,
        )

        response_payload = json.loads(response["Payload"].read())

        # The converter wraps its JSON in an API Gateway-style response
        if "body" in response_payload:
            body = json.loads(response_payload["body"])
        else:
            body = response_payload

        if not body.get("success"):
            raise RuntimeError(
                f"Document converter failed: {body.get('error', 'unknown error')}"
            )

        download_url = body["downloadUrl"]

        # 2. Download the converted PDF from the presigned URL
        logger.info("Downloading converted PDF", url_length=len(download_url))
        with urllib.request.urlopen(download_url) as resp:  # noqa: S310
            pdf_bytes = resp.read()

        # 3. Upload to a temp S3 key so fm_vision_extraction can read it
        s3_client.put_object(
            Body=pdf_bytes,
            Bucket=input_bucket,
            Key=temp_pdf_key,
            ContentType="application/pdf",
        )

        # 4. Run the high-quality vision extraction pipeline on the PDF
        logger.info(
            "Extracting content from converted PDF via vision pipeline",
            temp_pdf_key=temp_pdf_key,
        )
        document = fm_vision_extraction.extract_content(
            input_bucket, temp_pdf_key, file_name
        )
        logger.info(
            "DOCX vision extraction complete",
            pages=document.num_pages,
            words=document.total_num_words,
        )
        return document

    except Exception:
        logger.warning(
            "DOCX-to-PDF conversion failed, falling back to text extraction",
            input_key=input_key,
            exc_info=True,
        )
        # Graceful degradation: fall back to the legacy text-only path
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()
        pages = extract_docx_pages(file_content)
        return _textract_pages_to_document(pages, input_key, file_name)

    finally:
        # 5. Clean up the temp PDF from S3 (best-effort)
        try:
            s3_client.delete_object(Bucket=input_bucket, Key=temp_pdf_key)
        except Exception:
            logger.warning("Failed to clean up temp PDF", key=temp_pdf_key)


@tracer.start_as_current_span("_extract_content")
def _extract_content(
    input_bucket: str, input_key: str, file_name: str | None, payload: dict
) -> Document:
    suffix = pathlib.PurePosixPath(input_key.lower()).suffix

    if not suffix:
        raise UnsupportedFileFormat(f"{input_key} file type cannot be determined")

    if suffix in TEXT_FILE_EXTENSIONS:
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        extracted_text = s3_file_object["Body"].read().decode("utf-8")
        return _text_to_document(extracted_text, input_key, file_name)

    elif suffix in [
        ".docx",
    ]:
        # When the document-converter Lambda is wired up, convert DOCX→PDF
        # first so we get the high-quality vision extraction (images, tables,
        # formatting). Otherwise fall back to plain text extraction.
        if os.environ.get("DOCUMENT_CONVERTER_LAMBDA_NAME"):
            return _extract_docx_via_pdf(input_bucket, input_key, file_name)

        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        with tracer.start_as_current_span("read_file_content"):
            file_content = s3_file_object["Body"].read()
        pages = extract_docx_pages(file_content)
        return _textract_pages_to_document(pages, input_key, file_name)

    elif suffix in [".xlsx"]:
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()

        # Check if simple processing is requested (default to True)
        simple_processing = payload.get("simple_excel_processing", True)

        if simple_processing:
            excel_structure = extract_excel_structure_simple(file_content)
        else:
            excel_structure = extract_excel_structure(file_content)

        return _excel_structure_to_document(excel_structure, input_key, file_name)

    elif suffix == ".msg":
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()
        extracted_text = _extract_msg_text(file_content)
        return _text_to_document(extracted_text, input_key, file_name)

    # Vision extraction supported formats - direct processing
    elif suffix in VISION_SUPPORTED_FORMATS:
        return fm_vision_extraction.extract_content(input_bucket, input_key, file_name)

    # Audio/video files - transcription
    elif suffix in AUDIO_VIDEO_FORMATS:
        response = aws_transcribe.transcribe(
            input_bucket=input_bucket,
            input_key=input_key,
            job_name=f"transcribe-{int(time.time())}",
            output_bucket=input_bucket,
            output_key=f"{input_key}.transcription.json",
            name_for_logging=input_key,
        )
        return _text_to_document(response.text, input_key, file_name)

    else:
        raise UnsupportedFileFormat(f"{input_key} has an unsupported file format")


def _text_to_document(text: str, key: str, file_name: str | None) -> Document:
    """Convert text to Document structure"""
    page = DocumentPage(
        num_words=len(text.split()),
        page_number=1,
        text=text,
    )

    return Document(
        name=file_name or os.path.basename(key),
        num_pages=1,
        pages=[page],
        total_num_words=page.num_words,
    )


def _extract_msg_text(file_content: bytes) -> str:
    """Extract plain text content from an Outlook .msg file."""
    temp_path: str | None = None
    message = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".msg", delete=False) as temp_file:
            temp_file.write(file_content)
            temp_path = temp_file.name

        message = extract_msg.Message(temp_path)

        raw_body = message.body
        body_text = ""
        if isinstance(raw_body, bytes):
            body_text = raw_body.decode("utf-8", errors="ignore")
        elif isinstance(raw_body, str):
            body_text = raw_body
        if body_text.strip():
            return body_text

        raw_html_body = message.htmlBody
        html_text = ""
        if isinstance(raw_html_body, bytes):
            html_text = raw_html_body.decode("utf-8", errors="ignore")
        elif isinstance(raw_html_body, str):
            html_text = raw_html_body
        if html_text:
            return _html_to_text(html_text)

        return ""
    finally:
        if message is not None:
            close_method = getattr(message, "close", None)
            if callable(close_method):
                close_method()
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def _html_to_text(html_content: str) -> str:
    """Convert basic HTML into readable plain text."""
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", html_content)
    text = re.sub(r"(?i)</\s*(p|div|li|tr|h[1-6])\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _document_to_string(document: Document) -> str:
    """Convert Document to string"""
    return "\n".join(page.text for page in document.pages) + "\n"


def _iter_block_items(parent: DocxDocument | _Cell) -> Iterator[Paragraph | Table]:
    """
    Yield paragraphs and tables from a document or table cell in the order
    they appear. This lets us walk the document body while also capturing
    table content.
    """
    if isinstance(parent, DocxDocument):
        parent_element = parent.element.body
    else:
        parent_element = parent._tc  # pylint: disable=protected-access

    for child in parent_element.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def _append_to_segment(segments: list[str], text: str) -> None:
    """Append text to the current segment, inserting a newline when needed."""
    if not text:
        return
    if segments[-1]:
        segments[-1] += "\n" + text
    else:
        segments[-1] = text


def _paragraph_text_segments(paragraph: Paragraph) -> list[str]:
    """
    Split a paragraph into segments around page breaks so we can keep text
    after the break with the following page.
    """
    segments = [""]
    for element in paragraph._element.iter():  # pylint: disable=protected-access
        if element.tag == qn("w:t"):
            text = element.text or ""
            if text:
                segments[-1] += text
        elif element.tag == qn("w:br") and element.get(qn("w:type")) == "page":
            segments.append("")
        elif element.tag == qn("w:lastRenderedPageBreak"):
            segments.append("")
    return segments


def _collect_cell_segments(cell: _Cell) -> list[str]:
    """Collect text segments from a table cell while respecting page breaks."""
    segments = [""]
    for block in _iter_block_items(cell):
        if isinstance(block, Paragraph):
            paragraph_segments = _paragraph_text_segments(block)
            for index, segment in enumerate(paragraph_segments):
                _append_to_segment(segments, segment)
                if index < len(paragraph_segments) - 1:
                    segments.append("")
        elif isinstance(block, Table):
            table_segments = _collect_table_segments(block)
            for index, segment in enumerate(table_segments):
                _append_to_segment(segments, segment)
                if index < len(table_segments) - 1:
                    segments.append("")
    return segments


def _collect_row_segments(row: _Row) -> list[str]:
    """Combine the segments from each cell in a row."""
    cell_segments = [_collect_cell_segments(cell) for cell in row.cells]
    if not cell_segments:
        return [""]

    max_segments = max(len(segments) for segments in cell_segments)
    row_segments: list[str] = []
    for segment_index in range(max_segments):
        row_cells: list[str] = []
        for segments in cell_segments:
            if segment_index < len(segments):
                text = segments[segment_index]
                if text:
                    row_cells.append(text)
            else:
                row_cells.append("")
        joined = " | ".join(cell_text for cell_text in row_cells if cell_text)
        row_segments.append(joined)
    return row_segments


def _collect_table_segments(table: Table) -> list[str]:
    """Collect segments for an entire table based on row/cell segments."""
    segments = [""]
    for row in table.rows:
        row_segments = _collect_row_segments(row)
        for index, segment in enumerate(row_segments):
            _append_to_segment(segments, segment)
            if index < len(row_segments) - 1:
                segments.append("")
    return segments


@tracer.start_as_current_span("extract_docx_pages")
def extract_docx_pages(file_content: bytes) -> dict[int, str]:
    """
    Extracts text from a DOCX file.
    Splits the document into pages based on manual page breaks.
    If no page breaks are found, the document is treated as a single page.
    """
    doc = docx.Document(io.BytesIO(file_content))
    pages: list[str] = []
    current_lines: list[str] = []

    def flush_page(force: bool = False) -> None:
        if not current_lines:
            if force:
                pages.append("")
            return

        if not force and not any(line.strip() for line in current_lines):
            current_lines.clear()
            return

        pages.append("\n".join(current_lines))
        current_lines.clear()

    for block in _iter_block_items(doc):
        if isinstance(block, Paragraph):
            segments = _paragraph_text_segments(block)
            for index, segment in enumerate(segments):
                current_lines.append(segment)
                if index < len(segments) - 1:
                    flush_page()
        elif isinstance(block, Table):
            segments = _collect_table_segments(block)
            for index, segment in enumerate(segments):
                if segment:
                    current_lines.append(segment)
                if index < len(segments) - 1:
                    flush_page()

    if current_lines or not pages:
        flush_page(force=not pages)

    return dict(enumerate(pages, start=1))


def _get_excel_column_name(col_index: int) -> str:
    """
    Given a 1-based column index (e.g., 1 for A, 2 for B, 27 for AA),
    return the corresponding Excel column name.
    """
    col_name = ""
    while col_index > 0:
        remainder = (col_index - 1) % 26
        col_name = chr(ord("A") + remainder) + col_name
        col_index = (col_index - 1) // 26
    return col_name


def extract_excel_structure_simple(file_content: bytes) -> dict:
    """
    Extracts simplified text from an XLSX file.
    Each sheet is processed as a separate page.
    Rows are converted to tab-separated values without cell coordinates or formulas.
    Returns a dictionary where each key (sheet number) maps to simplified text content.
    """
    file_io = io.BytesIO(file_content)
    wb = load_workbook(file_io, data_only=True)

    result = {}
    sheet_index = 1

    for sheet_name in wb.sheetnames:
        sheet: Worksheet = wb[sheet_name]  # type: ignore

        rows = []
        for row in sheet.iter_rows(values_only=True):
            # Skip completely empty rows
            if all(cell is None or str(cell).strip() == "" for cell in row):
                continue

            # Convert each cell to string, handling None values
            row_values = [str(cell) if cell is not None else "" for cell in row]

            # Remove trailing empty cells
            while row_values and row_values[-1] == "":
                row_values.pop()

            if row_values:  # Only add non-empty rows
                rows.append("\t".join(row_values))

        # Create clean text representation
        sheet_text = (
            f"Sheet: {sheet_name}\n" + "\n".join(rows)
            if rows
            else f"Sheet: {sheet_name}\n"
        )

        result[sheet_index] = {
            "sheet_name": sheet_name,
            "structure": {
                "rows_count": len(rows),
            },
            "rows": [sheet_text],  # Single clean text block
        }
        sheet_index += 1

    return result


def extract_excel_structure(file_content: bytes) -> dict:
    """
    Extracts structured text from an XLSX file.
    Each sheet is processed as a separate page.
    For cells with formulas, both the formula and computed value are extracted.
    Returns a dictionary where each key (sheet number) maps to a structured object
    containing sheet name, metadata, and rows as text lines.
    """
    # Load workbook twice: one to get formulas, one for computed values.
    file_io = io.BytesIO(file_content)
    wb_formula = load_workbook(file_io, data_only=False)
    file_io.seek(0)
    wb_value = load_workbook(file_io, data_only=True)

    result = {}
    sheet_index = 1

    for sheet_name in wb_formula.sheetnames:
        sheet_formula: Worksheet = wb_formula[sheet_name]  # type: ignore
        sheet_value: Worksheet = wb_value[sheet_name]  # type: ignore

        rows = []
        headers = []
        # Iterate over rows (all populated rows)
        for i, (row_formula, row_value) in enumerate(
            zip(sheet_formula.iter_rows(), sheet_value.iter_rows())
        ):
            row_cells = []
            for cell_formula, cell_value in zip(row_formula, row_value):
                if cell_formula.data_type == "f" and cell_formula.value is not None:
                    cell_str = f"{cell_formula.coordinate}: {cell_formula.value} (computed: {cell_value.value})"
                else:
                    cell_str = f"{cell_formula.coordinate}: {cell_formula.value}"
                row_cells.append(cell_str)
            row_text = " | ".join(row_cells)
            if i == 0:
                # Treat the first row as headers if possible.
                headers = [cell.strip() for cell in row_text.split(" | ")]
            rows.append(row_text)

        # Determine column labels based on number of cells in header row (or first row)
        num_columns = len(headers) if headers else 0
        columns = [_get_excel_column_name(i + 1) for i in range(num_columns)]

        result[sheet_index] = {
            "sheet_name": sheet_name,
            "structure": {
                "columns": columns,
                "headers": headers,
                "rows_count": len(rows),
            },
            "rows": rows,
        }
        sheet_index += 1

    return result


@tracer.start_as_current_span("_textract_pages_to_document")
def _textract_pages_to_document(
    pages: dict[int, str], key: str, file_name: str | None
) -> Document:
    document_pages: list[DocumentPage] = []
    for page, text in pages.items():
        document_pages.append(
            DocumentPage(
                num_words=len(text.split()),
                page_number=page,
                text=text,
            )
        )

    document = Document(
        name=file_name or os.path.basename(key),
        num_pages=max([0, *pages.keys()]),
        pages=document_pages,
        total_num_words=sum(page.num_words for page in document_pages),
    )
    return document


def _excel_structure_to_document(
    structured: dict, key: str, file_name: str | None
) -> ExcelDocument:
    total_num_words = 0
    pages: List[ExcelDocumentPage] = []
    for sheet_num, sheet_data in structured.items():
        # Combine the rows to estimate word count.
        sheet_text = " ".join(sheet_data["rows"])
        num_words = len(sheet_text.split())
        total_num_words += num_words
        pages.append(
            ExcelDocumentPage(
                sheet_name=sheet_data["sheet_name"],
                structure=sheet_data["structure"],
                num_words=num_words,
                page_number=sheet_num,
                text=sheet_text,
            )
        )
    return ExcelDocument(
        name=file_name or os.path.basename(key),
        num_pages=len(pages),
        total_num_words=total_num_words,
        pages=pages,
    )


# =============================================================================
# CHUNK PROCESSING HANDLERS (for parallel large PDF extraction)
# =============================================================================

DEFAULT_CHUNK_SIZE = 100  # Pages per chunk for parallel processing


@tracer.start_as_current_span("_handle_prepare_chunks")
def _handle_prepare_chunks(payload: Dict[str, Any], _context) -> Dict[str, Any]:
    """
    Split a PDF into chunks for parallel processing.

    Downloads the PDF, converts all pages to images in S3, and returns
    chunk definitions that can be processed in parallel.

    Args:
        payload: Must contain:
            - input_bucket: S3 bucket containing the PDF
            - input_key: S3 key of the PDF file
            - chunk_size: (optional) Pages per chunk, default 150
            - output_bucket: (optional) Bucket for temp files, defaults to input_bucket

    Returns:
        {
            "batch_id": "uuid",
            "total_pages": 1500,
            "temp_prefix": "temp-pdf/uuid",
            "chunks": [
                {"chunk_id": 0, "start_page": 1, "end_page": 150},
                {"chunk_id": 1, "start_page": 151, "end_page": 300},
                ...
            ]
        }
    """
    import fitz  # type: ignore[import-untyped]  # pylint: disable=import-outside-toplevel

    input_bucket = payload["input_bucket"]
    input_key = payload["input_key"]
    chunk_size = payload.get("chunk_size", DEFAULT_CHUNK_SIZE)
    output_bucket = payload.get("output_bucket", input_bucket)

    # Event streaming params
    stream_events = payload.get("stream_events", False)
    job_id = payload.get("job_id")
    user_id = payload.get("user_id")
    app_id = payload.get("app_id")
    table_name = os.environ.get("DYNAMODB_TABLE")

    # Generate unique batch ID for this extraction job
    batch_id = str(uuid.uuid4())
    temp_prefix = f"temp-pdf/{batch_id}"

    logger.info(
        "Preparing PDF chunks",
        input_key=input_key,
        chunk_size=chunk_size,
        batch_id=batch_id,
    )

    _try_append_event(
        "Reading document...",
        stream_events=stream_events,
        job_id=job_id,
        user_id=user_id,
        app_id=app_id,
        table_name=table_name,
        bucket=input_bucket,
    )

    # Download PDF and get page count
    s3_response = s3_client.get_object(Bucket=input_bucket, Key=input_key)
    file_content = s3_response["Body"].read()

    # Convert all pages to images and upload to S3
    pdf = fitz.open(stream=file_content, filetype="pdf")
    total_pages = pdf.page_count

    _try_append_event(
        f"Preparing document for analysis ({total_pages} pages)...",
        stream_events=stream_events,
        job_id=job_id,
        user_id=user_id,
        app_id=app_id,
        table_name=table_name,
        bucket=input_bucket,
    )

    try:
        # Use the existing image conversion from fm_vision_extraction
        image_uris = fm_vision_extraction.pdf_to_images(
            file_content, output_bucket, temp_prefix
        )
        logger.info(f"Created {len(image_uris)} page images for batch {batch_id}")
    finally:
        pdf.close()

    # Calculate chunk definitions
    num_chunks = math.ceil(total_pages / chunk_size)
    chunks = []

    for i in range(num_chunks):
        start_page = i * chunk_size + 1  # 1-indexed
        end_page = min((i + 1) * chunk_size, total_pages)
        chunks.append(
            {
                "chunk_id": i,
                "start_page": start_page,
                "end_page": end_page,
                "temp_prefix": temp_prefix,
                "input_bucket": output_bucket,
            }
        )

    logger.info(
        f"Prepared {num_chunks} chunks for {total_pages} pages",
        batch_id=batch_id,
        chunks=len(chunks),
    )

    return {
        "batch_id": batch_id,
        "total_pages": total_pages,
        "temp_prefix": temp_prefix,
        "input_bucket": output_bucket,
        "chunks": chunks,
    }


@tracer.start_as_current_span("_handle_extract_chunk")
def _handle_extract_chunk(payload: Dict[str, Any], _context) -> Dict[str, Any]:
    """
    Extract content from a specific page range using pre-uploaded images.

    Args:
        payload: Must contain:
            - chunk_id: Identifier for this chunk
            - start_page: First page number (1-indexed)
            - end_page: Last page number (1-indexed)
            - temp_prefix: S3 prefix where page images are stored
            - input_bucket: S3 bucket containing temp images
            - translate_to_english: (optional) If True, translate content to English

    Returns:
        {
            "chunk_id": 0,
            "pages": [
                {"page_number": 1, "text": "## Page 1\n...", "num_words": 300},
                {"page_number": 2, "text": "## Page 2\n...", "num_words": 285},
                ...
            ]
        }
    """
    chunk_id = payload["chunk_id"]
    start_page = payload["start_page"]
    end_page = payload["end_page"]
    temp_prefix = payload["temp_prefix"]
    input_bucket = payload["input_bucket"]
    # Translate to English if explicitly set OR if output_language is not 'english'
    output_language = payload.get("output_language", "english")
    translate_to_english = payload.get(
        "translate_to_english", output_language != "english"
    )

    logger.info(
        f"Extracting chunk {chunk_id}: pages {start_page}-{end_page}",
        chunk_id=chunk_id,
        start_page=start_page,
        end_page=end_page,
        translate_to_english=translate_to_english,
    )

    # Build list of image URIs for this chunk's pages
    # Page images are named page_0000.jpg, page_0001.jpg, etc. (0-indexed)
    image_uris = []
    for page_num in range(start_page, end_page + 1):
        page_idx = page_num - 1  # Convert to 0-indexed
        key = f"{temp_prefix}/page_{page_idx:04d}.jpg"
        image_uris.append(f"s3://{input_bucket}/{key}")

    # Process this chunk's pages - returns DocumentPage objects with correct page numbers
    page_offset = start_page - 1
    pages = fm_vision_extraction.process_pages_concurrent(
        image_uris,
        page_offset=page_offset,
        translate_to_english=translate_to_english,
    )

    # Convert DocumentPage objects to dicts for JSON serialization
    pages_data = [dataclasses.asdict(page) for page in pages]

    logger.info(
        f"Extracted {len(pages_data)} pages for chunk {chunk_id}",
        chunk_id=chunk_id,
        pages_extracted=len(pages_data),
    )

    # Write chunk results to S3 to avoid Step Functions payload size limits
    chunk_output_key = f"{temp_prefix}/chunk_{chunk_id:04d}.json"
    s3_client.put_object(
        Body=json.dumps(pages_data).encode("utf-8"),
        Bucket=input_bucket,
        Key=chunk_output_key,
        ContentType="application/json",
    )

    logger.info(
        f"Wrote chunk {chunk_id} results to S3",
        chunk_id=chunk_id,
        output_key=chunk_output_key,
    )

    return {
        "chunk_id": chunk_id,
        "pages_key": chunk_output_key,
        "pages_bucket": input_bucket,
    }


@tracer.start_as_current_span("_handle_merge_chunks")
def _handle_merge_chunks(payload: Dict[str, Any], _context) -> Dict[str, Any]:
    """
    Merge extracted chunks into a final Document and write to S3.

    Args:
        payload: Must contain:
            - chunks: List of chunk results from extract_chunk calls
            - output_bucket: S3 bucket for final output
            - output_key: S3 key for final JSON output
            - file_name: (optional) Original file name
            - temp_prefix: S3 prefix to clean up
            - input_bucket: Bucket containing temp files

    Returns:
        {
            "output_bucket": "bucket",
            "output_key": "path/to/output.json"
        }
    """
    chunks = payload["chunks"]
    output_bucket = payload["output_bucket"]
    output_key = payload["output_key"]
    file_name = payload.get("file_name", "document.pdf")
    temp_prefix = payload.get("temp_prefix")
    input_bucket = payload.get("input_bucket")

    # Event streaming params
    stream_events = payload.get("stream_events", False)
    job_id = payload.get("job_id")
    user_id = payload.get("user_id")
    app_id = payload.get("app_id")
    table_name = os.environ.get("DYNAMODB_TABLE")

    logger.info(
        f"Merging {len(chunks)} chunks",
        output_key=output_key,
        chunks=len(chunks),
    )

    _try_append_event(
        "Finalizing document extraction...",
        stream_events=stream_events,
        job_id=job_id,
        user_id=user_id,
        app_id=app_id,
        table_name=table_name,
        bucket=input_bucket,
    )

    # Collect all pages from all chunks (read from S3)
    all_pages: List[DocumentPage] = []

    for chunk in chunks:
        # Read chunk data from S3
        chunk_key = chunk.get("pages_key")
        chunk_bucket = chunk.get("pages_bucket")

        if chunk_key and chunk_bucket:
            # New format: read from S3
            response = s3_client.get_object(Bucket=chunk_bucket, Key=chunk_key)
            chunk_pages = json.loads(response["Body"].read().decode("utf-8"))
        else:
            # Fallback for backward compatibility (inline pages)
            chunk_pages = chunk.get("pages", [])

        for page_data in chunk_pages:
            all_pages.append(
                DocumentPage(
                    page_number=page_data["page_number"],
                    text=page_data["text"],
                    num_words=page_data["num_words"],
                )
            )

    # Sort pages by page number
    all_pages.sort(key=lambda p: p.page_number)

    # Create final Document
    document = Document(
        name=file_name,
        num_pages=len(all_pages),
        pages=all_pages,
        total_num_words=sum(p.num_words for p in all_pages),
    )

    # Write to S3
    content = json.dumps(dataclasses.asdict(document), indent=2).encode("utf-8")
    s3_client.put_object(
        Body=content,
        Bucket=output_bucket,
        Key=output_key,
        ContentType="application/json",
    )

    logger.info(
        f"Merged document written to {output_bucket}/{output_key}",
        total_pages=len(all_pages),
        total_words=document.total_num_words,
    )

    _try_append_event(
        "Document ready for analysis",
        stream_events=stream_events,
        job_id=job_id,
        user_id=user_id,
        app_id=app_id,
        table_name=table_name,
        bucket=input_bucket,
    )

    # Clean up temp files if prefix provided
    if temp_prefix and input_bucket:
        try:
            fm_vision_extraction.cleanup_s3_files(input_bucket, temp_prefix)
            logger.info(f"Cleaned up temp files at {temp_prefix}")
        except Exception as e:
            logger.warning(f"Failed to clean up temp files: {e}")

    return {
        "output_bucket": output_bucket,
        "output_key": output_key,
    }


def main():
    """Main function for testing the lambda handler"""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--key", required=True, help="S3 key for the file")
    args = parser.parse_args()

    test_event = {
        "input_bucket": args.bucket,
        "input_key": args.key,
    }
    result = handler(test_event, {})
    print(result)


if __name__ == "__main__":
    main()
