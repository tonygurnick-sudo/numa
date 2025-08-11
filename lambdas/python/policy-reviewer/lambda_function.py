import io
import json
import os
import re
import urllib.parse
from typing import Dict, List, Optional

import requests
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from bs4 import BeautifulSoup, Tag
from pdfminer.high_level import extract_text

import bedrock
import helpers
import s3_helpers
from prompts import POLICY_REVIEW_PROMPT, UPDATED_POLICY_PROMPT

# Constants
MAX_TOKENS = 16000
MAX_PDF_LENGTH = 100000
HTTP_TIMEOUT = 60

logger = structlog.get_logger()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36"
}


def process_legislation_url(
    url: str, document_index: int, total_docs: int
) -> Optional[Dict[str, str]]:
    """
    Process a single legislation URL and create a formatted document entry.

    Args:
        url: The legislation URL to process
        document_index: The index of this document (1-based)
        total_docs: Total number of documents being processed

    Returns:
        A dictionary with document metadata and content, or None if unsupported
    """
    try:
        # Step 1: Determine URL type and get PDF URL if needed
        pdf_url = url
        source_url = url

        # Handle NZ legislation HTML pages
        if "legislation.govt.nz" in url and not url.lower().endswith(".pdf"):
            logger.info(
                f"Processing NZ legislation HTML URL {document_index}/{total_docs}: {url}"
            )
            source_url = url
            pdf_url = get_nz_legislation_pdf_url(url)
        elif not url.lower().endswith(".pdf"):
            logger.info(
                f"URL {document_index}/{total_docs} is not a PDF or recognized legislation page: {url}"
            )
            return {
                "entry": f"""
                ### LEGISLATIVE DOCUMENT {document_index}
                **Source URL:** {url}
                **Status:** Unsupported format (only PDF or NZ legislation pages are supported)
                """
            }
        else:
            logger.info(f"Processing PDF URL {document_index}/{total_docs}: {url}")

        # Step 2: Extract text from PDF
        pdf_text = scrape_pdf_text(pdf_url)

        # Step 3: Truncate if needed
        if len(pdf_text) > MAX_PDF_LENGTH:
            pdf_text = pdf_text[:MAX_PDF_LENGTH] + "...[truncated due to length]"

        # Step 4: Format the document entry
        return {
            "entry": f"""
            ### LEGISLATIVE DOCUMENT {document_index}
            **Source URL:** {source_url}
            **PDF URL:** {pdf_url if source_url != pdf_url else 'Same as source'}
            **Document Type:** PDF Legislation
            **Content Summary:** This appears to be legislative content that must be compared with the policy document.

            **FULL TEXT:**
            {pdf_text}
            """
        }

    except Exception as e:
        logger.error(
            f"Error processing URL {document_index}/{total_docs} - {url}: {str(e)}"
        )
        return {
            "entry": f"""
            ### LEGISLATIVE DOCUMENT {document_index}
            **Source URL:** {url}
            **Status:** Error processing URL - {str(e)}
            """
        }


def get_nz_legislation_pdf_url(html_url: str) -> str:
    """
    Extract PDF URL from New Zealand legislation HTML page.

    Args:
        html_url: URL to the HTML legislation page

    Returns:
        URL to the PDF version of the legislation
    """
    logger.info(f"Finding PDF link from NZ legislation page: {html_url}")
    try:
        # Get the HTML content
        html = requests.get(html_url, headers=HEADERS, timeout=HTTP_TIMEOUT).text
        soup = BeautifulSoup(html, "lxml")

        # Try primary selector for download PDF link
        pdf_link_elem = soup.select_one("li.downloadPdf a[href$='.pdf']")

        pdf_link: Optional[Tag] = None
        if isinstance(pdf_link_elem, Tag):
            pdf_link = pdf_link_elem

        # Try fallback if primary selector fails
        if not pdf_link:
            logger.info("Primary PDF link selector failed, trying fallback")
            for link_elem in soup.find_all("a", href=True):
                if not isinstance(link_elem, Tag):
                    continue

                link_text = link_elem.get_text(" ", strip=True)
                href = link_elem.get("href", "")
                if (
                    isinstance(href, str)
                    and re.search(r"print/download", link_text, re.I)
                    and href.endswith(".pdf")
                ):
                    pdf_link = link_elem
                    break

        if not pdf_link:
            raise RuntimeError("PDF link not found on NZ legislation page")

        # Get absolute URL - we now know pdf_link is a Tag
        href_str = pdf_link.get("href", "")
        # Ensure href is a string for urljoin
        if not isinstance(href_str, str):
            href_str = str(href_str)

        pdf_url = urllib.parse.urljoin(html_url, href_str)
        logger.info(f"Found PDF URL: {pdf_url}")
        return str(pdf_url)

    except Exception as e:
        logger.error(f"Error extracting PDF URL from NZ legislation page: {str(e)}")
        raise


def scrape_pdf_text(pdf_url: str) -> str:
    """
    Scrape text content from a PDF URL.

    Args:
        pdf_url: URL to the PDF file

    Returns:
        Extracted text content from the PDF
    """
    logger.info(f"Downloading PDF content from: {pdf_url}")
    try:
        # Get the PDF content
        response = requests.get(
            pdf_url, headers=HEADERS, stream=True, timeout=HTTP_TIMEOUT
        )
        response.raise_for_status()

        # Read PDF into buffer
        buffer = io.BytesIO()
        for chunk in response.iter_content(chunk_size=8192):
            buffer.write(chunk)
        buffer.seek(0)

        # Extract text from PDF
        text = extract_text(buffer)
        logger.info(f"Successfully extracted {len(text)} characters from PDF")
        return text

    except Exception as e:
        logger.error(f"Error scraping PDF from {pdf_url}: {str(e)}")
        return f"Error scraping PDF: {str(e)}"


def format_legislation_content(legislation_entries: List[Dict[str, str]]) -> str:
    """
    Format the combined legislation content with clear markers.

    Args:
        legislation_entries: List of formatted legislation entries

    Returns:
        Formatted legislation content ready for the prompt
    """
    if not legislation_entries:
        return "No legislation content available"

    entries_text = "\n\n".join(entry["entry"] for entry in legislation_entries)

    return f"""
    ---------------------------------------------------------------------------------
    LEGISLATIVE CONTENT - BEGIN
    ---------------------------------------------------------------------------------

    {entries_text}

    ---------------------------------------------------------------------------------
    LEGISLATIVE CONTENT - END
    ---------------------------------------------------------------------------------
    """


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    """Main lambda handler function."""
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        # Step 1: Extract event parameters
        input_key = event["input_key"]
        legislation_content = event["legislation_content"]
        policy_context = event["policy_context"]
        output_path = event["output_path"]

        # Step 2: Read the policy content
        logger.info("Reading policy content")
        policy_content = s3_helpers.read(input_key)

        # Step 3: Parse legislation URLs from JSON string
        try:
            legislation_urls = json.loads(legislation_content)
            logger.info(f"Found {len(legislation_urls)} legislation URLs to process")
        except json.JSONDecodeError:
            logger.warning(
                "Failed to parse legislation_content as JSON, treating as raw content"
            )
            legislation_urls = []

        # Step 4: Process each legislation URL
        legislation_entries = []
        for i, url in enumerate(legislation_urls, 1):
            entry = process_legislation_url(url, i, len(legislation_urls))
            if entry:
                legislation_entries.append(entry)

        # Step 5: Format the combined legislation content
        combined_legislation = format_legislation_content(legislation_entries)

        # Step 6: Generate policy review using Bedrock
        logger.info("Generating policy review with scraped legislation")
        policy_review = get_model_response(
            prompt=POLICY_REVIEW_PROMPT,
            input_data={
                "policy_content": policy_content,
                "initial_analysis": f"Policy context: {policy_context}",
                "legislation_content": combined_legislation,
            },
        )

        # Step 7: Generate updated policy document
        logger.info("Generating updated policy document")
        updated_policy = get_model_response(
            prompt=UPDATED_POLICY_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_review": policy_review,
            },
        )

        # Step 8: Save both documents as markdown and prepare output
        policy_review_key = f"{output_path}/policy_review.md"
        updated_policy_key = f"{output_path}/updated_policy.md"

        s3_helpers.write(
            policy_review_key,
            policy_review.encode("utf-8"),
            content_type="text/markdown",
        )

        s3_helpers.write(
            updated_policy_key,
            updated_policy.encode("utf-8"),
            content_type="text/markdown",
        )

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": policy_review_key,
                            },
                            "location": "S3",
                            "title": "Policy Review",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": updated_policy_key,
                            },
                            "location": "S3",
                            "title": "Updated Policy",
                        },
                    ],
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def get_model_response(prompt: str, input_data: dict) -> str:
    """Get formatted response from the Bedrock model."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(query=formatted_prompt, name_for_logging="policy_review")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            markdown_text = response.response[0].get("text", "")
            return markdown_text.replace("`", "")

    return str(response.response).replace("`", "")
