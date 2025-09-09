"""Lambda to extract text from a file in S3"""

import argparse
import dataclasses
import io
import json
import os
import pathlib
import time
from typing import List, Sequence, TypeVar

import boto3
import docx
import structlog
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from opentelemetry import trace

import aws_transcribe
import fm_vision_extraction
import helpers
from fm_vision_extraction import Document, DocumentPage

s3_client = boto3.client("s3")
logger = structlog.get_logger(__name__)
tracer = trace.get_tracer(__name__)


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
    rows: List[str] = dataclasses.field(default_factory=list)


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

    input_bucket = payload.get("input_bucket")
    input_key = payload.get("input_key")

    if not input_bucket or not input_key:
        raise ValueError("input_bucket and input_key are required")

    output_bucket = payload.get("output_bucket", input_bucket)
    output_key = payload.get("output_key", f"{input_key}.json")
    file_name = payload.get("file_name", None)

    # only set this to true when it's certain this will be less than 256KB
    return_content = event.get("return_content", False)
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

    try:
        document = _extract_content(input_bucket, input_key, file_name)

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


@tracer.start_as_current_span("_extract_content")
def _extract_content(
    input_bucket: str, input_key: str, file_name: str | None
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
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        with tracer.start_as_current_span("read_file_content"):
            file_content = s3_file_object["Body"].read()
        pages = extract_docx_pages(file_content)
        return _textract_pages_to_document(pages, input_key, file_name)

    elif suffix in [".xlsx"]:
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()
        excel_structure = extract_excel_structure(file_content)
        return _excel_structure_to_document(excel_structure, input_key, file_name)

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


def _document_to_string(document: Document) -> str:
    """Convert Document to string"""
    return "\n".join(page.text for page in document.pages) + "\n"


@tracer.start_as_current_span("extract_docx_pages")
def extract_docx_pages(file_content: bytes) -> dict[int, str]:
    """
    Extracts text from a DOCX file.
    Splits the document into pages based on manual page breaks.
    If no page breaks are found, the document is treated as a single page.
    """
    doc = docx.Document(io.BytesIO(file_content))
    pages = []
    current_page = []

    for para in doc.paragraphs:
        # Look for a page break element: <w:br w:type="page"/>
        # pylint: disable=protected-access
        if (
            para._element.find('.//w:br[@w:type="page"]', para._element.nsmap)
            is not None
        ):
            current_page.append(para.text)
            pages.append("\n".join(current_page))
            current_page = []
        else:
            current_page.append(para.text)

    if current_page:
        pages.append("\n".join(current_page))

    # If no manual page breaks were found, treat the entire document as one page.
    if not pages:
        pages = ["\n".join([p.text for p in doc.paragraphs if p.text.strip()])]

    # Create a dictionary mapping page numbers to page text.
    docx_pages = dict(enumerate(pages, start=1))
    return docx_pages


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
                rows=sheet_data["rows"],
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
