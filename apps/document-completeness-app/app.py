import json
import os
from dataclasses import asdict
from typing import List

import structlog
from dca import (
    Document,
    DocumentPage,
    document_completeness_agent,
    document_summary_agent,
    requirement_enrichment,
)
from dotenv import load_dotenv
from services.s3_service import check_s3_object, upload_to_s3
from services.textract_service import (
    extract_page_count_from_textract_response,
    extract_text_from_textract_response,
    get_response_using_textract,
)
from utils.file_utils import determine_file_type

BUCKET_NAME = "document-completeness-app"
LOCAL_FILE_DIR = "docs"
MAX_FILES = 10
MAX_TOTAL_PDF_PAGES = 30

logger = structlog.get_logger(__name__)
load_dotenv()


def load_config(config_file_path: str) -> dict:
    try:
        with open(config_file_path, "r") as config_file:
            config = json.load(config_file)
        logger.info("Loaded configuration", config=config)
        return config
    except FileNotFoundError:
        logger.exception("Configuration file not found", file_path=config_file_path)
        exit(1)
    except json.JSONDecodeError:
        logger.exception(
            "Error parsing JSON configuration file", file_path=config_file_path
        )
        exit(1)


def create_document_from_textract_response(response: dict, file_name: str) -> Document:
    document = Document()
    pages = extract_text_from_textract_response(response)
    document_pages: List[DocumentPage] = []
    for page, text in pages.items():
        page_info = DocumentPage()
        page_info.page_number = page
        page_info.num_words = len(text.split())
        page_info.text = text
        document_pages.append(page_info)

    num_pages = extract_page_count_from_textract_response(response)
    document.name = file_name
    document.num_pages = num_pages
    document.total_num_words = sum([page.num_words for page in document_pages])
    document.text = document_pages
    return document


def temp_check_local_file_dir(file_path: str) -> Document | None:
    file_name = os.path.basename(file_path)
    # Check if the extracted text exists in LOCAL_FILE_DIR dir
    # Caching for local development
    if f"{file_name}.json" in os.listdir(LOCAL_FILE_DIR):
        with open(f"{LOCAL_FILE_DIR}/{file_name}.json", "r") as file:
            document_dict = json.load(file)
            document_text = [DocumentPage(**page) for page in document_dict["text"]]
            document = Document(**document_dict)
            document.text = document_text
            return document
    return None


def temp_upload_file_paths_to_s3(file_paths: list[str]) -> tuple[list[str], list[str]]:
    uploaded_files = []
    failed_files = []
    for file_path in file_paths:
        file_name = os.path.basename(file_path)
        try:
            with open(file_path, "rb") as file:
                # Upload to S3
                upload_message = upload_to_s3(file, BUCKET_NAME, object_name=file_name)
                logger.info("File uploaded to S3", message=upload_message)
                uploaded_files.append(file_name)
        except FileNotFoundError:
            failed_files.append(file_name)
            logger.exception("File not found", file_path=file_path)
    return uploaded_files, failed_files


def get_document(file_path: str) -> Document:
    """Nick has a smarter document rebuilder."""
    file_name = os.path.basename(file_path)

    # Check if the object exists in S3
    object_exists = check_s3_object(BUCKET_NAME, file_name)
    if object_exists:
        logger.info("S3 object exists, starting Textract job")

        # Determine file type
        file_type = determine_file_type(file_path)

        if file_type == "requires_textract":  # [".pdf", ".jpg", ".jpeg", ".png"]
            # Send to Textract
            # TODO: refactor to use Nicks Document Rebuilder
            textract_response = get_response_using_textract(BUCKET_NAME, file_name)
            if not textract_response:
                logger.exception("Textract job failed", file_name=file_name)
                raise Exception("Textract job failed")
            document = create_document_from_textract_response(
                textract_response, file_name
            )
            return document

        elif file_type == "docx":
            # TODO: Implement DOCX processing using package such as langchain or llamaindex
            logger.exception("DOCX processing not yet implemented", file_type=file_type)
            raise Exception("DOCX processing not yet implemented")

        else:
            logger.exception("Unsupported file type", file_type=file_type)
            raise Exception("Unsupported file type")

    else:
        logger.exception(
            "S3 object does not exist or is not accessible", file_name=file_path
        )
        raise Exception("S3 object does not exist or is not accessible")

    return None


def main():
    # NOTE: In prodution, this function could assume inputs of a s3 paths."""
    config = load_config("config.json")
    file_paths = config["file_path"]
    requirements = config["requirements"]

    # Check files not above max files
    # TODO: Support RAG when number of files exceed limit
    if len(file_paths) > 10:  # Arbitrary limit (untested)
        logger.exception(
            "Number of files exceeds the limit of 10", num_files=len(file_paths)
        )
        exit(1)
    logger.info("Starting analysis")

    # Upload files to s3
    uploaded_files, failed_files = temp_upload_file_paths_to_s3(file_paths)
    logger.info(
        "Uploaded files to S3", uploaded_files=uploaded_files, failed_files=failed_files
    )

    # Gather Documents
    documents: List[Document] = []
    for file_path in uploaded_files:
        # Check if the extracted text exists in LOCAL_FILE_DIR dir
        document = temp_check_local_file_dir(file_path)
        if document:
            logger.info("Extracted text found in local cache", file_path=file_path)
            documents.append(document)
            continue

        document = get_document(file_path)
        documents.append(document)
        # Save Document text to a local file
        with open(f"{LOCAL_FILE_DIR}/{file_path}.json", "w") as file:
            json.dump(asdict(document), file, indent=4)

    files_preview = [
        {"file_name": doc.name, "num_pages": doc.num_pages} for doc in documents
    ]
    logger.info("Extracted text from files", documents=files_preview)

    documents = document_summary_agent(documents)
    logger.info("Generated summaries for documents")

    # Check total pages not above max pages
    # TODO: Support RAG when total pages exceed limit
    total_pages = sum([doc.num_pages for doc in documents])
    if total_pages > 100:  # Arbitrary limit (untested)
        logger.exception(
            "Total number of pages exceeds the limit of 100", total_pages=total_pages
        )
        exit(1)

    # Enrich the requirements with additional context
    enriched_requirements = requirement_enrichment(requirements, documents)
    logger.info("Enriched Requirements", enriched_requirements=enriched_requirements)

    # Pass extracted text to the DCA for analysis
    dca_result = document_completeness_agent("extracted_text")
    logger.info("Document Completeness Analysis Result", dca_result=dca_result)


if __name__ == "__main__":
    main()
