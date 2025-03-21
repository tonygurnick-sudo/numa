"""Lambda to extract text from a file in S3"""

import argparse
import dataclasses
import io
import json
import os
import pathlib
import time
from typing import Generic, List, TypeVar

import boto3
import docx
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet

import aws_transcribe
import bedrock
import helpers
import textract

s3_client = boto3.client("s3")


class UnsupportedFileFormat(Exception):
    pass


# Define a type variable for document pages.
PageT = TypeVar("PageT", bound="DocumentPage")


@dataclasses.dataclass
class Document(Generic[PageT]):
    name: str = ""
    num_pages: int = 0
    total_num_words: int = 0
    pages: List[PageT] = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class DocumentPage:
    page_number: int = 0
    num_words: int = 0
    text: str = ""


# Excel-specific dataclasses extend the base ones.
@dataclasses.dataclass
class ExcelDocumentPage(DocumentPage):
    sheet_name: str = ""
    structure: dict = dataclasses.field(default_factory=dict)
    rows: List[str] = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class ExcelDocument(Document[ExcelDocumentPage]):
    pages: List[ExcelDocumentPage] = dataclasses.field(default_factory=list)


def handler(event: dict, _context) -> dict:
    helpers.setup_logging()

    input_bucket = event["input_bucket"]
    output_bucket = event.get("output_bucket", input_bucket)
    input_key = event["input_key"]
    output_key = event.get("output_key", f"{input_key}.json")
    # only set this to true when it's certain this will be less than 256KB
    return_content = event.get("return_content", False)

    document = __generate_document(input_bucket, input_key)

    content = json.dumps(dataclasses.asdict(document), indent=4).encode("utf-8")
    s3_client.put_object(Body=content, Bucket=output_bucket, Key=output_key)

    result = {
        "input_bucket": input_bucket,
        "input_key": input_key,
        "output_bucket": output_bucket,
        "output_key": output_key,
    }
    if return_content:
        result["content"] = __document_to_string(document)
    return result


def __generate_document(input_bucket: str, input_key: str) -> Document:
    suffix = pathlib.PurePosixPath(input_key.lower()).suffix

    if not suffix:
        raise UnsupportedFileFormat(f"{input_key} has an unsupported file format")

    if suffix in [
        ".csv",
        ".txt",
    ]:
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        extracted_text = s3_file_object["Body"].read().decode("utf-8")
        return __text_to_document(extracted_text, input_key)
    elif suffix in [
        ".docx",
    ]:
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()
        pages = extract_docx_pages(file_content)
        return _textract_pages_to_document(pages, input_key)
    elif suffix in [
        ".xlsx",
    ]:
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()
        excel_structure = extract_excel_structure(file_content)
        return _excel_structure_to_document(excel_structure, input_key)
    elif suffix in [
        ".png",
        ".jpg",
        ".jpeg",
    ]:
        extracted_text = bedrock.get_text_from_image(input_bucket, input_key)
        return __text_to_document(extracted_text, input_key)
    elif suffix in [
        ".pdf",
        ".tiff",
    ]:
        pages = textract.get_pages_from_document(input_bucket, input_key)
        return _textract_pages_to_document(pages, input_key)
    elif suffix in [
        ".mp3",
        ".mp4",
        ".wav",
        ".flac",
        ".ogg",
        ".amr",
        ".webm",
        ".m4a",
    ]:
        response = aws_transcribe.transcribe(
            input_bucket=input_bucket,
            input_key=input_key,
            job_name=f"transcribe-{int(time.time())}",
            output_bucket=input_bucket,
            output_key=f"{input_key}.transcription.json",
            name_for_logging=input_key,
        )
        return __text_to_document(response.text, input_key)
    else:
        raise UnsupportedFileFormat(f"{input_key} has an unsupported file format")


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


def _textract_pages_to_document(pages: dict[int, str], key: str) -> Document:
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
        name=os.path.basename(key),
        num_pages=max([0, *pages.keys()]),
        pages=document_pages,
        total_num_words=sum(page.num_words for page in document_pages),
    )
    return document


def __text_to_document(text: str, key: str) -> Document:
    page = DocumentPage(
        num_words=len(text.split()),
        page_number=1,
        text=text,
    )

    document = Document(
        name=os.path.basename(key),
        num_pages=1,
        pages=[page],
        total_num_words=page.num_words,
    )
    return document


def __document_to_string(document: Document) -> str:
    document_string = ""
    for page in document.pages:
        document_string += f"{page.text}\n"
    return document_string


def _excel_structure_to_document(structured: dict, key: str) -> ExcelDocument:
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
            )
        )
    return ExcelDocument(
        name=os.path.basename(key),
        num_pages=len(pages),
        total_num_words=total_num_words,
        pages=pages,
    )


def _write_text_to_s3(text: str, bucket_name: str, key: str):
    file_obj = io.BytesIO(text.encode("utf-8"))
    s3_client.upload_fileobj(file_obj, bucket_name, key)


def main():
    """Main function for testing the lambda handler."""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--key", required=True, help="S3 key for the file")
    args = parser.parse_args()

    test_event = {
        "input_bucket": args.bucket,
        "input_key": args.key,
    }
    test_context = {}
    result = handler(test_event, test_context)
    print(result)


if __name__ == "__main__":
    main()
