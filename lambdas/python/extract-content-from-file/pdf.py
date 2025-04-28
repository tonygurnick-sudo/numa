"""Module to handle PDF-specific processing for content extraction."""

import io
from typing import Dict, Tuple

import boto3
import structlog
from pypdf import PdfReader

import textract

logger = structlog.get_logger(__name__)

# Configuration for PDF extraction
MIN_TEXT_LENGTH = 50  # Minimum text length before considering image extraction

# Initialize S3 client
s3_client = boto3.client("s3")


def extract_images_from_page(page) -> list:
    """
    Extract image objects from a PDF page by inspecting /XObject resources.
    Returns a list of image objects that can be processed.
    """
    images: list[object] = []
    try:
        resources = page.get("/Resources")
        if resources is None:
            return images

        xobject = resources.get("/XObject")
        if xobject is None:
            return images

        for obj_name in xobject:
            obj = xobject[obj_name]
            if obj.get("/Subtype") == "/Image":
                images.append(obj)
    except Exception:
        logger.exception("Failed to extract image references")

    return images


def analyse_pdf_content(pdf_bytes: bytes) -> Tuple[Dict[int, str], bool, bool]:
    """
    Analyze PDF to extract text and determine if images are present.

    Returns:
        Tuple containing:
        - Dict mapping page numbers to extracted text
        - Boolean indicating if sufficient text was found (above MIN_TEXT_LENGTH average)
        - Boolean indicating if images were found
    """
    pdf_stream = io.BytesIO(pdf_bytes)
    page_text = {}
    total_images = 0

    try:
        reader = PdfReader(pdf_stream)
        total_pages = len(reader.pages)

        if total_pages == 0:
            return {}, False, False

        total_text_length = 0

        for i, page in enumerate(reader.pages, start=1):
            # Extract text
            text = page.extract_text() or ""
            text = text.strip()
            page_text[i] = text
            total_text_length += len(text)

            # Count images
            images = extract_images_from_page(page)
            total_images += len(images)

        # Determine if there's enough text
        avg_text_per_page = total_text_length / total_pages
        has_sufficient_text = avg_text_per_page >= MIN_TEXT_LENGTH
        has_images = total_images > 0

        logger.info(
            f"PDF analysis: {total_pages} pages, avg {avg_text_per_page:.1f} chars/page, {total_images} total images"
        )

        return page_text, has_sufficient_text, has_images

    except Exception:
        logger.exception("Error in PDF analysis")
        return {}, False, False


def process_pdf_document(input_bucket: str, input_key: str) -> Dict[int, str]:
    """
    Process a PDF document and extract its text content.
    Uses a simplified approach:
    1. Try pypdf for text extraction first
    2. If sufficient text and no images, return that text
    3. If sufficient text but images present, return that text (but can be improved)
    4. If insufficient text, use Textract

    Args:
        input_bucket: The S3 bucket containing the PDF
        input_key: The S3 key of the PDF
        file_content: The raw bytes of the PDF file

    Returns:
        Dict[int, str]: A dictionary mapping page numbers to extracted text
    """
    try:
        # First pass: Extract text and analyze content
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        file_content = s3_file_object["Body"].read()
        page_text, has_sufficient_text, has_images = analyse_pdf_content(file_content)

        # Case 1: Enough text, no images - return pypdf results
        if has_sufficient_text and not has_images:
            logger.info("PDF has sufficient text and no images, using pypdf extraction")
            return page_text

        # Case 2: Enough text, but images present - don't process images but can in the future
        elif has_sufficient_text and has_images:
            logger.info(
                "PDF has sufficient text and images, using pypdf extraction without image extraction"
            )
            # TODO: Implement image processing logic here if required
            return page_text

        # Case 3: Not enough text - use Textract
        else:
            logger.info("PDF has insufficient text, using Textract")
            return textract.get_pages_from_document(input_bucket, input_key)

    except Exception:
        # Fall back to Textract if any processing fails
        logger.exception("PDF processing failed, falling back to Textract")
        return textract.get_pages_from_document(input_bucket, input_key)
